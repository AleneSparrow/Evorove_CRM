# Hot-lead handoff (cycle 2 → cycle 3)

This is the only legal entry into CRM booking. The payload is a person who
already agreed to a service and is ready to book. It is not a search result,
not a ZIP card, and not a calendar slot.

Sale exit lives in Evorove. The hour is set here through `ProcessEngine`.

`POST /api/v1/businesses/{business_id}/hot-leads` — staff session.

`POST /api/v1/internal/businesses/{business_id}/hot-leads` — same body,
`X-Internal-Task-Secret`. Disabled when the secret is unset.

Live callers in Evorove report every sales touch to
`POST /api/v1/internal/businesses/{id}/lead-touches` and POST a ready person to
this hot-lead route. The hour is still booked here, not in cycle 2.
See [`docs/lead-touch-contract.md`](lead-touch-contract.md).

## Required fields

| Field | Meaning |
| --- | --- |
| `handoff_id` | Idempotency key from Evorove. Replay of the same business + id + payload returns the stored case. |
| `source` | Must be `evorove`. |
| `channel` | `sms`, `web_chat`, or `email` — the channel where the person waits. |
| `identity.phone` or `identity.email` | Already addressable. A name alone is not enough. |
| `service_id` | Agreed service already in this tenant's Business DNA catalog. |
| `readiness.signal` | Must be `ready_to_book`. |
| `readiness.evidence_excerpt` | Exact customer evidence of readiness. |

Optional: `sales_profile_snapshot` (conversation evidence, not a live `SalesStage`),
`customer_location` (operational, not a substitute for readiness).

Forbidden on the payload and inside the snapshot: `slot_start_at`, `start_at`,
`booking_id`, `end_at`. CRM books the hour after accept.

## What accept does

1. Validates the contract in `src/domain/hot_lead.py`.
2. Creates or reuses a tenant-scoped lead.
3. Walks `ProcessEngine` to `QUALIFIED`. Does not run a sales conversation.
4. Leaves `booking_id` empty. Zone, forms, the specific slot, and any quote
   stay with existing commercial machinery.

Rejected: missing readiness, unknown service, identity conflict, human hold,
a person already on the calendar, a case past intake.

## What this is not

- Not lead generation.
- Not a second sales pitch.
- Not `commercial.initialize` in the same request as accept.
