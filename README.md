# Evorove CRM

Evorove CRM is cycle 3 of one product: accept an already-hot person, collect what the service needs, and put a specific hour on the calendar. The evening screen is tomorrow's appointments — not a funnel to close. Sales conversation lives in the sister repo [Evorove](https://github.com/AleneSparrow/Evorove). Finding people lives in `evorove_lead`. Do not add either here.

See [SNAPSHOT.md](SNAPSHOT.md) for the split date and what was copied.

The product captures the reusable shape of lead-to-cash operations—qualification, booking or quoting, follow-up, payment, service, reviews, and reactivation—while each tenant supplies its own rules through **Business DNA**.

The website chat is a controlled workflow surface, not an unconstrained chatbot. A provider-backed AI layer extracts intent and drafts customer wording, while process state, qualification, permissions, side effects, escalation, and audit history remain explicit and deterministic. AI output is validated and cannot bypass workflow or risk controls.

## What this foundation contains

The MVP provides:

- typed domain models for leads, cases, events, decisions, actions, and results;
- an explicit state machine with terminal, escalation, and recovery paths;
- an event-driven process engine with idempotency and append-only audit history in memory or durable storage;
- a decision router for rule, AI, and human decisions;
- a reusable Lead-to-Cash workflow definition;
- a generic, validated Business DNA example and JSON Schema;
- executable Lead Intake and Qualification driven by Business DNA;
- provider-neutral structured AI boundaries with OpenAI and deterministic implementations;
- AI-generated intent, clarification, and approved response wording with safe audit metadata;
- SQLAlchemy repositories with tenant-scoped persistence and optimistic concurrency;
- database-backed, concurrency-safe incoming-message idempotency;
- versioned Business DNA and reproducible Alembic migrations;
- a versioned FastAPI boundary with validated tenant routes and safe error responses;
- durable, tenant-scoped conversations with ordered message history and opaque browser tokens;
- a public multi-turn chat API plus a lightweight embeddable JavaScript widget;
- bounded conversation context, deterministic fact merging, question tracking, and human handoff states;
- deterministic commercial-path selection, timezone-safe availability, transactional bookings, Decimal quotes, and provider-neutral payment requests;
- explicit CORS configuration, request limits, and a PostgreSQL-backed abuse-control boundary;
- tests for transitions, rejection, audit history, escalation, idempotency, and end-to-end progression.

Qualified website conversations continue through booking or quoting. Business DNA—not AI—selects the commercial path, availability and price authority remain deterministic, PostgreSQL coordinates capacity and optimistic updates, and payment requests prepare state without collecting money. The product includes staff authentication, the React staff UI, Lemon Squeezy subscription billing, CRM webhooks, and optional Twilio delivery. Real customer payment collection and calendar synchronization remain deferred.

## Architecture

Each step follows:

`Trigger -> Context -> Decision -> Action -> Result -> Next trigger`

`ProcessEngine` coordinates the step. `StateMachine` owns allowed transitions. `DecisionRouter` separates deterministic rules, constrained AI judgment, and human approval. Every received trigger and resulting decision/state change is appended to the case history. See [the architecture guide](docs/architecture.md) and [product specification](docs/product-spec.md).

## Repository structure

```text
config/       Business DNA example and schema
docs/         Product and architecture documentation
migrations/   Reproducible Alembic database migrations
src/api/      FastAPI application, contracts, dependencies, and routes
src/ai/       Provider-neutral AI contracts, prompts, adapters, and providers
src/domain/   Domain types and state-transition rules
src/engine/   Decision routing and process orchestration
src/persistence/ Repository protocols and SQLAlchemy adapters
tests/        Executable behavior specifications
workflows/    Reusable workflow definitions
examples/     Local executable workflow demonstrations
web/widget/   Framework-free embeddable chat widget and demo page
```

## Run the tests

Python 3.11 or newer is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
pytest
```

## Lead Intake and Qualification

Milestone 2 executes the first real workflow:

`Incoming message -> Lead/case lookup -> Intent extraction -> Missing-information detection -> Qualification -> State transition -> Customer response`

The intake service scopes message idempotency by business, channel, and external message ID. Existing cases can be continued using an explicit case ID or a normalized phone/email match. Business DNA defines service aliases, required fields and their prompts, service areas, service-specific questions, confidence thresholds, booking eligibility, and escalation policy. No message is sent; the service returns a structured `CustomerResponse` for a future delivery adapter.

Run the local demonstration:

```bash
python examples/lead_qualification_demo.py
```

## Local PostgreSQL, migrations, and API

Copy the environment template, start PostgreSQL, migrate the database, and explicitly seed the non-production example tenant:

```bash
cp .env.example .env
docker compose up -d postgres
export DATABASE_URL='postgresql+psycopg://ai_process_engine:local_development_only@localhost:5433/ai_process_engine'
export APP_ENV=development
export AI_PROVIDER=deterministic
alembic upgrade head
python examples/seed_example_business.py
uvicorn src.api.app:app --reload --no-access-log
```

The API is available at `http://localhost:8000`, Swagger UI at `http://localhost:8000/docs`, liveness at `/health`, and database/configuration readiness at `/ready`. `DATABASE_URL` and `AI_PROVIDER` are mandatory; runtime startup never falls back to in-memory persistence or from OpenAI to a deterministic provider. Create schema revisions with `alembic revision --autogenerate -m "description"`, inspect them, and apply them with `alembic upgrade head`. Production schema creation must use Alembic, not `Base.metadata.create_all()`.

To run PostgreSQL and the API together, use `docker compose up --build`. The app waits for healthy PostgreSQL and runs `alembic upgrade head` before Uvicorn. Seed explicitly with `docker compose exec app python examples/seed_example_business.py`. The seed helper is idempotent and refuses to run unless `APP_ENV` is explicitly `development` or `local`. `POSTGRES_PORT` and `APP_PORT` control host ports; container-to-container database traffic always uses port 5432.

Submit a message after seeding:

```bash
curl -X POST http://localhost:8000/api/v1/businesses/acme-home-services/messages \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <staff-bearer-token>' \
  -H 'X-Request-ID: manual-check-1' \
  -d '{"channel":"sms","external_message_id":"manual-1","message":"I need a diagnostic visit in 60601","timestamp":"2026-08-11T08:00:00Z","customer_name":"Ada","phone":"+13125550100"}'
```

This is the staff-authenticated direct intake endpoint: the bearer-token user must belong to `acme-home-services`. Create a staff account through `/api/v1/auth/signup` or log in through `/api/v1/auth/login` to obtain the token. Anonymous website chat uses the separate opaque conversation-token routes below, and inbound SMS uses its signature-verified Twilio webhook; neither uses this direct endpoint. The response includes `business_id`, stable case and lead IDs, `current_state`, a replay indicator, any customer question, `requires_human`, and a qualification summary. Reusing the same message identity and content returns the stored result; changing its fingerprint returns HTTP 409.

## Deploying to production

See [`DEPLOY.md`](DEPLOY.md) for the actual steps (Railway for the backend +
Postgres, Vercel/Cloudflare Pages for the `web/app` frontend). The
`Dockerfile` already runs migrations on startup and exposes `/health`, so
most of what's left is account setup and environment variables.

## Website conversations and widget

Milestones 6 and 7 provide these anonymous public routes:

- `GET /api/v1/public/businesses/{business_id}/chat-config`
- `POST /api/v1/public/businesses/{business_id}/conversations`
- `POST /api/v1/public/businesses/{business_id}/conversations/{conversation_token}/messages`
- `GET /api/v1/public/businesses/{business_id}/conversations/{conversation_token}`
- `GET /api/v1/public/businesses/{business_id}/conversations/{conversation_token}/commercial`

The create route accepts `{}` or an initial `{message, external_message_id}` pair. The widget also supplies a cryptographically random 256-bit `conversation_token` candidate, allowing simultaneous or lost-response retries of the first request to converge on the same conversation; the server generates one when non-browser callers omit it. Every message ID is generated by the browser and scoped to its conversation, so a network retry returns the existing logical result without another AI invocation, message pair, lead/case update, or audit effect. PostgreSQL transaction-scoped advisory locking coordinates first creation when no row exists yet, and row locking serializes follow-ups; distinct rapid messages receive contiguous sequence numbers and cannot overwrite newer case state.

The continuation token is 256 bits of URL-safe randomness. Only its SHA-256 hash is stored. Lookup always includes `business_id`; tokens expire after `PUBLIC_CONVERSATION_TOKEN_TTL_HOURS` and support server-side revocation. Conversation responses expose only the token, public state, handoff flag, and rendered history. The token-bound commercial route exposes only that conversation's booking, quote, and payment-request summary. Neither route exposes lead/case IDs, Business DNA, audit events, prompts, provider metadata, pricing formulas, or internal notes.

Embed the same-origin widget after seeding and starting the app:

```html
<script
  src="http://localhost:8000/widget/widget.js"
  data-business-id="acme-home-services">
</script>
```

For a widget hosted on another origin, add `data-api-base="https://api.example.com"` and list the website origin in `CORS_ALLOWED_ORIGINS`. Open `http://localhost:8000/widget/demo.html` for the local demo page. The widget stores only the opaque token in tenant-specific `localStorage`; a pending first request is retained only in tab-scoped `sessionStorage` until it succeeds. It restores history after refresh, renders all message content with `textContent`, and never interprets customer or AI text as HTML.

Run the deterministic persisted conversation demo after migration and seeding:

```bash
python examples/conversation_demo.py
```

The AI receives at most eight recent redacted customer/assistant messages, selected structured facts, unresolved field/question identifiers, current case state, and the existing minimal Business DNA subset. Phone and email values are redacted from prior-message context. Strong existing service, location, time, identity, and qualification-answer facts are preserved; contradictory follow-up facts request human review instead of silently overwriting them. `QUALIFIED`, `QUOTED`, `BOOKED`, and `WON` continue through deterministic commercial handling; `NEEDS_HUMAN` pauses automation, while lost, cancelled, paid, and completed cases close the autonomous conversation.

## Booking, quoting, and payment preparation

For each service, `fulfillment_type` selects `bookable`, `quote_required`, `direct_sale`, or `human_review`. Bookable services receive at most ten real slots derived from business hours, service duration, configured booking windows, notice, buffers, capacity, existing active bookings, and an IANA timezone. Proposed slots expire and a customer's natural-language preference can select only a persisted proposal. Final capacity is rechecked transactionally; PostgreSQL uses a tenant/service advisory lock so overlapping buffered appointments cannot both consume capacity one.

Quote-required services collect configured numeric inputs and calculate fixed or formula prices with `Decimal`. Starting-price and range rules require an explicit automatic amount or human review; configured approval thresholds route to `NEEDS_HUMAN`. Quotes are persisted with lines and validity, then accepted, rejected, or lazily expired. Booking confirmation or quote acceptance can prepare a deposit/final `PaymentRequest`; it is only an internal `READY` record and never charges a customer.

Run the provider-free booking and quote demonstration:

```bash
PYTHONPATH=. python examples/commercial_workflow_demo.py
```

Anonymous chat has no cookie or authenticated browser session, so conventional CSRF does not grant tenant authority; the opaque token is still bearer material and must not be shared. XSS remains relevant on the embedding site, so the widget uses DOM text nodes only. Production forbids wildcard CORS configuration. The sliding-window limiter covers an IP/business create key and IP/conversation message key and is shared across workers via PostgreSQL (`rate_limit_hits`).

Uvicorn raw-path access logs are disabled because conversation tokens appear in route paths; structured application logs use route templates and internal conversation IDs instead. Any upstream proxy or CDN must apply equivalent URL redaction.

## AI runtime and safety

Use deterministic mode for tests, the offline demo, and local work without an API key:

```bash
export AI_PROVIDER=deterministic
```

Use a real provider explicitly — Anthropic:

```bash
export AI_PROVIDER=anthropic
export ANTHROPIC_API_KEY='set-locally-never-commit'
export ANTHROPIC_MODEL='claude-sonnet-5'
export AI_TIMEOUT_SECONDS=20
export AI_MAX_RETRIES=2
```

or OpenAI:

```bash
export AI_PROVIDER=openai
export OPENAI_API_KEY='set-locally-never-commit'
export OPENAI_MODEL='gpt-4.1-mini'
export AI_TIMEOUT_SECONDS=20
export AI_MAX_RETRIES=2
```

Both adapters share the exact same prompts, Pydantic output schemas, and post-hoc unsafe-commitment filtering — swapping `AI_PROVIDER` changes only which model executes an already-constrained request, not what it's allowed to say. The OpenAI adapter uses the official SDK's typed structured-output parsing; the Anthropic adapter forces a single tool call shaped by the same Pydantic schema. Both have an explicit timeout and retry only transient network, timeout, rate-limit, and provider-internal failures, with a maximum of three configured retries. Authentication and invalid-output failures are not retried. Startup and `/ready` validate configuration without making a paid model call. If an AI provider becomes unavailable at runtime, the corresponding customer-facing operation is explicitly logged and uses the existing deterministic implementation so an outage does not surface as a raw widget error.

Only the current raw customer message, bounded/redacted conversation context, and a task-specific Business DNA subset leave the application: service IDs, names, intake aliases, relevant qualification prompts, and—when drafting wording—configured language, tone, channel, and the already approved response meaning. Explicit phone/email fields, tenant/database IDs, pricing, integration configuration, and secrets are not added to prompts. Customer text is delimited as untrusted content and cannot change rules. Structured output is validated again against current or already validated customer evidence, the supplied service catalog, question set, response type, and unsafe-commitment checks before use.

The audit trail records safe per-call metadata: provider, model, prompt ID/version, decision type, confidence, latency, outcome category, attempt count, and token usage when supplied. It does not store API keys, provider response bodies, hidden reasoning, or a second copy of the customer message in AI metadata. At runtime, provider failures and invalid provider output use the logged deterministic fallback; non-provider application failures still roll back the intake transaction.

An optional live check is the normal curl example above with OpenAI mode enabled. It is never part of automated tests; use a disposable message ID and development database.

Fast tests use isolated file-backed SQLite databases through the same PostgreSQL-compatible repository code. PostgreSQL concurrency tests require a dedicated migrated test database:

```bash
export TEST_DATABASE_URL="$DATABASE_URL"
pytest -m postgresql
```

Do not point `TEST_DATABASE_URL` at production. The current integration tests create uniquely named tenant records but are intended for a disposable development/test database.

## Persistence guarantees

Every tenant-owned repository lookup requires `business_id`, and composite foreign keys prevent cases, conversations, messages, events, bookings, quotes, quote lines, and payment requests from crossing tenant ownership. Website intake and commercial handling run inside one Unit of Work: the conversation messages, lead/case and commercial writes, audit events, state transitions, question/commercial tracking, and stored result commit or roll back together.

`processed_messages` has a composite primary key over business, channel, and external message ID. On PostgreSQL, a transaction-scoped advisory lock derived from that full identity serializes competing claims across workers until the winning transaction commits or rolls back. The composite primary key remains the authoritative uniqueness constraint, and `INSERT ... ON CONFLICT DO NOTHING RETURNING` identifies the claim owner. An identical fingerprint returns the stored result; a different fingerprint raises an explicit collision. Transaction-scoped locks are released automatically on commit, rollback, or connection loss, so an abandoned worker cannot leave a permanent process-local lock. Case updates use an integer version in the `UPDATE` predicate, so a stale worker receives `StaleCaseError` and its transaction—including candidate events—rolls back.

## Next milestone

Cycle 3 receive and the evening screen are in place: `POST /hot-leads` accepts a
ready-to-book person without setting an hour; `/app` lists tomorrow's appointments.
Live glue from Evorove, real calendar synchronization, and collection of a
customer's payment remain deferred. Do not delete booking from the sales repo
until the handoff is live.

The public rate limiter is shared across workers via PostgreSQL (`rate_limit_hits`). CRM webhook delivery and conversational SMS replies use a durable `integration_outbox` row plus `POST /api/v1/internal/integrations/deliver`. Inbound SMS threads show up on Conversations; a staff reply on an `sms` conversation is delivered through the same outbox.

SMS follow-up already has its own attempt table. Twilio's Messages API has no client-supplied idempotency key, so a crash between Twilio confirming dispatch and the outbox mark can still duplicate one message.
