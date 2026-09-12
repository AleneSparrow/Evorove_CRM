# Architecture

## Runtime model

The engine represents each customer journey as a `ProcessCase`, scoped by `business_id`. A case owns its lead, current state, timestamps, metadata, optimistic version, and append-only event history. A `Conversation` is the delivery/session aggregate: it links to one lead/case, owns anonymous-token and handoff status, and orders persisted inbound/outbound `ConversationMessage` records. Repository protocols isolate the domain and engine from SQLAlchemy; synchronous SQLAlchemy adapters persist the model to PostgreSQL-compatible SQL.

## Business DNA

Business DNA is tenant-owned configuration describing facts and policies: identity, catalog and pricing, service area and hours, qualification and scheduling constraints, sales and payment policy, communication style, AI permissions, escalation, and integration placeholders. The JSON Schema provides a versioned contract that is generic across industries. It must never contain API keys, passwords, tokens, or other secrets; integration entries reference separately secured connections.

## Processing cycle

1. **Event (trigger):** an immutable `ProcessEvent` announces something that happened and carries a unique idempotency ID.
2. **Context:** the engine reads the case state, tenant identity, lead details, event payload, and validated Business DNA supplied to the intake service.
3. **Decision:** `DecisionRouter` routes a `RULE`, `AI`, or `HUMAN` request. Rule decisions are deterministic. Provider-backed AI supplies validated understanding or wording but not state authority. Human decisions explicitly pause automation.
4. **Action:** an `Action` describes a side effect separately from reasoning. This milestone models actions but does not execute integrations.
5. **Result:** `ActionResult` records whether an eventual executor succeeded and any returned data. A result can become the next trigger.
6. **State transition:** `StateMachine` is the sole authority on whether the chosen target is reachable from the current state.
7. **Audit trail:** the engine appends the incoming trigger, decision, and state change. It also appends rejected transitions and ignored duplicate deliveries.

This preserves the conceptual loop:

`Trigger -> Context -> Decision -> Action -> Result -> Next trigger`

## Decision and safety boundaries

`DecisionRouter` depends on an `AIDecisionProvider` protocol, so a real provider can be injected without changing orchestration. Provider output is untrusted: its decision type, target, approval, and confidence are checked before use. AI recommendations below the confidence threshold become human escalations. Explicitly high-risk actions and protected action types also escalate, even when presented as rules. Escalation stores one pending target; only a `HUMAN` decision with an identified approver can resume the case, and only to that target. A future authenticated boundary must establish that approver identity. Future action executors must independently enforce permissions and idempotency before side effects; a decision is not permission to bypass that boundary.

## Idempotency and failure semantics

Each case tracks processed trigger IDs independently from user metadata. Re-delivery appends `DUPLICATE_IGNORED` but neither re-decides nor changes state. Invalid transitions append `TRANSITION_REJECTED`, mark the trigger processed, and raise `InvalidTransition`, allowing an API or worker to report failure without silently corrupting state. Generated audit records carry the incoming trigger ID as their `causation_id`; event payloads and exposed history are immutable.

Persistent intake commits processed-message results, audit events, and case state atomically. Commercial booking, quote, and payment-request records join the same transaction. Follow-up SMS uses `follow_up_delivery_attempts`; CRM webhooks and conversational SMS replies use `integration_outbox`. Provider APIs still lack client idempotency keys, so delivery is at-least-once around a crash between the provider confirming and the outbox row being marked sent.

## Executable lead intake

`LeadIntakeService` accepts a validated `IncomingMessage`, checks its tenant and enabled channel, and claims an idempotency key scoped to `(business_id, channel, external_message_id)`. It resolves an active case by explicit case ID or normalized phone/email, records intake and extracted intent, merges new facts with prior lead context, and asks `QualificationService` for a structured outcome. State changes still pass through `ProcessEngine`; qualification code cannot mutate process state.

`IntentExtractor`, `QuestionGenerator`, and `CustomerResponseGenerator` are engine protocols. Their AI adapters depend on `StructuredAIProvider`; the first production adapter uses the official OpenAI SDK and typed Responses API parsing. Deterministic implementations are selected explicitly for tests, offline demos, or local development and also wrap production providers as the logged runtime fallback. The returned `CustomerResponse` is a value object; the website conversation service persists it as an outbound message but does not invoke an external delivery provider.

Prompts are centralized and versioned. Intent prompts contain the current raw customer message, service IDs/names/aliases, relevant qualification prompts, and bounded conversation context. That context contains at most eight recent customer/assistant messages with phone/email patterns redacted, selected validated facts, unresolved item identifiers, and current case state. It never contains unlimited history, internal IDs, notes, pricing, integration configuration, or secrets. Wording prompts contain only allowed missing items or approved outcome wording plus configured language, tone, and channel. Customer content is delimited and declared untrusted; it cannot redefine Business DNA or grant discounts, refunds, payments, bookings, legal commitments, or policy exceptions.

Provider output is validated twice: Pydantic rejects a structurally invalid response, then the adapter verifies catalog aliases, unsupported-service evidence, qualification-answer IDs, the exact missing-item set, response type, and unsafe commitments. Runtime provider failures and invalid provider output are logged and use deterministic fallback implementations; non-provider application failures still abort intake, allowing the database transaction and idempotency claim to roll back.

`LeadIntakeService` remains the lightweight in-memory implementation for fast domain tests and the local demo. `PersistentLeadIntakeService` executes the equivalent orchestration through a Unit of Work. Explicit case IDs are preferred for follow-up messages; phone/email matching is tenant-scoped, and conflicting identities are rejected rather than silently merging customers.

## Repository and transaction boundary

Repository protocols cover businesses, Business DNA, leads, cases, events, conversations, ordered messages, idempotency records, bookings, quotes/lines, and payment requests. SQLAlchemy implementations require `business_id` on every tenant-owned read or update. Composite tenant foreign keys ensure every commercial aggregate can reference only a case, lead, quote, or booking from the same business.

Persistent intake is one database transaction:

1. load the tenant and active Business DNA;
2. claim the incoming message identity;
3. load or construct the tenant lead and case;
4. call the configured AI provider for understanding, then qualify deterministically;
5. execute state transitions through `ProcessEngine`;
6. save the lead/case and append new audit events;
7. attach the serialized logical result to the message claim;
8. commit everything together.

Any exception rolls back the entire Unit of Work. A stored message claim is never intentionally committed without its case and result.

Website intake extends that transaction. The conversation row is locked, the client message ID/fingerprint is checked, an inbound message receives the next sequence, and `PersistentLeadIntakeService` executes inside the already-active Unit of Work. The conversation is linked to the returned lead/case, unresolved and asked question state is updated, and an outbound message receives the following sequence before commit. Failure removes every candidate effect. A duplicate browser retry returns persisted history before invoking AI.

After qualification, `CommercialPathSelector` reads the service `fulfillment_type`; AI cannot change the selected path. `DeterministicAvailabilityEngine` builds a bounded set of UTC slots from Business DNA and persisted bookings while retaining the IANA business timezone for display and DST conversion. Customer preference interpretation is constrained to those proposal IDs. Booking creation rechecks buffers/capacity after acquiring a PostgreSQL transaction advisory lock for the tenant/service schedule, then uses `ProcessEngine` for `QUALIFIED -> BOOKED`. Quote calculations use `Decimal`, persist line items and validity, and use guarded transitions through `QUOTED`, `FOLLOW_UP`, `WON`, or `LOST`. Unsupported discounts and configured approval thresholds enter `NEEDS_HUMAN` before any commitment.

`PaymentRequest` is a provider-neutral aggregate for deposits or final payments. It records amount, currency, status, expiry, and its quote/booking reference, but contains no gateway secret or payment method and performs no charge. Quote and payment expiration are evaluated lazily until a background worker exists. Booking, quote, and payment status changes produce safe commercial audit events without customer payloads or hidden AI reasoning.

## Conversation continuation and fact merging

The widget generates 256 bits of URL-safe randomness before its first request, allowing a lost or simultaneous create retry to reuse the same token; the server generates equivalent randomness when a caller omits it. PostgreSQL stores only its SHA-256 hash. Lookup is always qualified by `business_id`, checks expiry and revocation, and never treats a raw lead/case/conversation ID as authority. Conversation status supports `ai_active`, `human_takeover_requested`, `human_takeover_active`, and `closed`. A staff reply from Conversations moves `ai_active` or `human_takeover_requested` to `human_takeover_active`, which pauses autonomous SMS intake and widget engine turns for that session and skips stalled-lead follow-up SMS while any linked conversation is human-owned. `QUALIFIED`, `QUOTED`, `BOOKED`, and `WON` remain autonomous commercial states when the conversation is still `ai_active`; `NEEDS_HUMAN` pauses all autonomous commitment and terminal states do not restart qualification.

Lead facts merge deterministically. Missing facts can be filled from evidence in later customer messages. An explicitly restated service, location, or preferred time is treated as a customer correction and replaces the earlier case fact; silence preserves the earlier fact. Conflicting identity fields (phone, email, or name) and conflicting answers to configured qualification questions remain protected and force human review. Answered question IDs remain on the lead and conversation tracking marks them answered, so only unresolved configured prompts can be asked again.

## HTTP boundary

FastAPI owns transport validation and exposes `/health`, `/ready`, staff routes, and public conversation routes under `/api/v1`. `POST /api/v1/businesses/{business_id}/messages` is staff-authenticated direct intake and requires the bearer-token caller to belong to that business. Public create/send/get routes instead accept only an opaque conversation token. A token-scoped commercial status route returns only that conversation's safe booking, quote, and payment-request fields. No public route exposes Business DNA, lead/case IDs, audit data, prompt/provider metadata, question tracking, pricing formulas, or internal notes.

Application startup requires `DATABASE_URL` and an explicit `AI_PROVIDER`, verifies database connectivity and AI configuration, creates one SQLAlchemy engine, and stores immutable dependency wiring on the FastAPI application. `AI_PROVIDER=openai` additionally requires `OPENAI_API_KEY` and `OPENAI_MODEL`; `AI_PROVIDER=anthropic` additionally requires `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. No paid provider call occurs during startup or readiness. Each repository operation still runs in a fresh Unit of Work whose session closes on success or failure. Alembic remains the only runtime schema authority.

Middleware accepts a constrained `X-Request-ID` or generates one, enforces the request-size ceiling against both declared and actually streamed bytes, returns the correlation ID, and logs only safe routing metadata. Route logs use templates rather than raw token-bearing URLs and may include tenant, internal conversation ID, and resulting state; they never include raw messages, contact details, credentials, or tokens. Validation and known domain conflicts use explicit public responses; unexpected errors return a correlation-bearing 500 without internal exception or database details.

Uvicorn raw-path access logging is disabled because public bearer tokens are part of route paths. Deployment proxies and CDNs must also redact those paths; the structured application log is the supported request log.

Public CORS origins are an explicit environment allowlist; wildcard configuration is rejected in production. Same-origin development needs no CORS grant. The widget renders customer and assistant strings with `textContent`, not HTML. Anonymous routes do not use cookies, but token secrecy and embedding-site XSS controls still matter. A sliding-window limiter applies per-IP/business creation and per-IP/conversation message limits, persisted in `rate_limit_hits` so multiple workers share the same budget.

The tenant path value is used for every repository lookup and for the domain `IncomingMessage`. An explicit case ID is queried together with that tenant ID, so another tenant's case is indistinguishable from a missing case. Staff routes authenticate a bearer session whose raw token is returned only once and whose SHA-256 hash is persisted; route dependencies then verify that the user belongs to the requested business. The public token authorizes only one anonymous conversation and must not be treated as staff authority. Actor identities, retention rules, and redaction policy remain future audit-hardening work.

## Database idempotency and concurrency

The `processed_messages` primary key is `(business_id, channel, external_message_id)`. A SHA-256 fingerprint covers normalized identity details and the original message content. On PostgreSQL, the repository first takes a transaction-scoped advisory lock derived from the full message identity. Contenders for the same identity therefore wait across processes until the current transaction commits, rolls back, or loses its connection. The database then uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` to identify the claim owner while the composite primary key remains the authoritative uniqueness check. An identical fingerprint returns the completed stored result; a different fingerprint raises `IdempotencyCollisionError`. Because the lock is transaction-scoped and the claim is written in the intake transaction, failure releases the lock and rolls back an incomplete claim rather than permanently blocking retries. A committed claim without a result is treated as an invariant violation, not as normal in-progress processing.

Cases use optimistic concurrency. Each update includes the version that was loaded and atomically increments it. A zero-row update means another worker won; `StaleCaseError` aborts the losing transaction, so its state and candidate events never become visible. This protects distinct concurrent messages as well as direct competing transitions.

Conversation follow-ups additionally use `SELECT ... FOR UPDATE` on the tenant/token-qualified conversation row. This serializes distinct rapid messages across PostgreSQL workers before allocating sequence numbers or loading the case. `(business_id, conversation_id, sequence_number)` and `(business_id, conversation_id, external_message_id)` are database uniqueness backstops. The existing case version and processed-message advisory lock remain authoritative within each serialized intake.

Bookings serialize the whole tenant/service schedule rather than only an exact start, because different starts can overlap through duration and buffers. Capacity is re-read after lock acquisition. One booking per tenant/case and one payment type per tenant/case are database uniqueness backstops. Booking, quote, and payment records also use optimistic versions; quote row locking makes simultaneous acceptance converge on one accepted quote, one case progression, and one payment request.

The advisory lock is acquired before any AI call. Concurrent identical HTTP messages therefore converge on one stored result and trigger one provider call where PostgreSQL coordination is available. A timeout or other exception releases the transaction-scoped lock and rolls back the claim, lead, case, and events together.

## AI failures and observability

The OpenAI client has an explicit configurable timeout and SDK retries disabled. A provider-neutral wrapper applies bounded exponential backoff only to typed timeout, rate-limit, network, and provider-internal failures. Invalid credentials, permissions, request/configuration errors, and invalid structured output are not retried. Public HTTP errors expose only stable application codes and correlation IDs, never provider response bodies or stack traces.

AI audit payloads contain provider, model, prompt ID/version, decision type, confidence, latency, success/failure category, attempt count, and input/output/total token counts when available. They exclude credentials, provider debug payloads, hidden reasoning, and duplicate customer-message text. Token metadata is observability for future cost accounting, not billing.

## Business DNA history

Business DNA uses `(business_id, version)` as its primary key. Adding a version locks the tenant business row, deactivates the prior version, allocates the next integer version, and activates the new record in one transaction. A partial unique index permits only one active version per tenant while retaining all prior versions.

## Migrations and configuration

`DATABASE_URL` and `AI_PROVIDER` are required and read from the environment. OpenAI and Anthropic mode each additionally require their own API key and model; deterministic mode requires no provider credentials, while production providers are wrapped with an explicit deterministic runtime fallback. Alembic owns production schema changes through revision `0023`: `0001`–`0004` establish workflow, conversations, integrity, and commercial storage; `0005`–`0010` add staff auth, billing, CRM webhooks, SMS delivery, billing-customer handling, and business memberships; `0011`–`0015` add SMS consent, urgency/out-of-area policy, billing webhook idempotency, and follow-up delivery attempts; `0016`–`0021` add reporting controls, timezone backfill, account security, staff names, a shared rate-limit table, the CRM/SMS delivery outbox, and SMS STOP suppressions; `0022` adds the sales conversation layer; `0023` adds the owner board (people, lead touches, commands). Docker Compose starts PostgreSQL and the API, waits for database health, and applies migrations before Uvicorn starts. Credentials in `.env.example` are local-development placeholders and no secrets are stored in Business DNA.

## Tenant isolation and persistence

`business_id` is mandatory on every case, repository method, and tenant API route, establishing the storage boundary. Private route dependencies authenticate the staff caller and authorize their membership of that tenant before repository access; anonymous public conversation routes instead authorize only with a scoped opaque conversation token. Actor identities, retention rules, and redaction policy remain future audit-hardening work.

## Dependency direction

The domain package has no framework dependencies. The engine depends on domain abstractions. The persistence, API, and AI adapters depend inward on these packages. Engine protocols do not import the OpenAI SDK, keeping vendor and transport details outside core policy.
