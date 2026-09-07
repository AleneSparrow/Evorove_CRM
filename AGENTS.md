# Evorove CRM agent instructions

- Communicate with the product owner in Russian. Product UI and customer-facing copy remain English.
- This repository is cycle 3 only: collect what is needed and book an already-hot lead. Product north star: `/Users/alenakulish/dev/evorove/FOUNDATION.md`. Local product boundaries: `CLAUDE.md`.
- Do not add lead generation or cold-sale conversation here. Those belong in `evorove`.
- Keep the existing booking and hot-lead case machinery as the last step of the larger product. Do not replace it with a generic CRM.
- `docs/sales-agent-implementation-plan-ru.md` describes cycle 2 in the sibling repo; do not treat it as a license to implement sales conversation in this CRM.
- Never run `git push`; only the owner pushes.
- Do not read, request, print, or edit secrets and local `.env` files.
- Do not add a `SalesStage` or `SalesMove` without updating the sales-agent specification and transition tests in `evorove`.
- Do not merge `SalesStage` into `ProcessState`: the former describes conversation progress; the latter protects business commitments.
- AI output is untrusted. Validate enums, evidence, knowledge IDs, business facts, and allowed actions in server code.
- AI may analyze language and phrase an approved move. It may not set prices, grant discounts, book unchecked slots, make guarantees, or bypass `ProcessEngine`.
- Every sales claim must be grounded in an approved `knowledge_id`, `business_fact_id`, or exact customer evidence.
- Preserve tenant scope, consent, STOP suppression, human takeover, idempotency, concurrency controls, and durable outbox behavior.
- Keep changes inside the assigned file scope. Frontend tasks must not invent or change backend contracts.
- Run focused tests for the changed behavior before handoff. Do not weaken tests to accommodate an implementation.
