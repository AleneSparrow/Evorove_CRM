# Lead-touch contract (cycles 1 and 2 → CRM)

CRM is the owner’s board. Cycle 1 and cycle 2 **report every touch** with a
person. They do not merge `SalesStage` into `ProcessState`.

`POST /api/v1/internal/businesses/{business_id}/lead-touches`  
Header: `X-Internal-Task-Secret`. Disabled when the secret is unset.

Staff board (subscription-gated, same as Tomorrow):

- `GET /api/v1/businesses/{business_id}/board?tab=cold|in_work|offer_sent|done`
- `GET /api/v1/businesses/{business_id}/board/people/{person_id}`
- `POST /api/v1/businesses/{business_id}/board/people/{person_id}/commands`

## Touch

| Field | Meaning |
| --- | --- |
| `touch_id` | Idempotency key. Replay of the same business + id + fingerprint returns the stored card. |
| `person_id` | Stable id `ppl_…` from the first addressable identity. Same id in all three repos. |
| `cycle` | `1`, `2`, or `3`. |
| `kind` | What happened (see below). |
| `source` | `evorove_lead`, `evorove`, or `evorove_crm`. |
| `summary` | Short English fact for the owner timeline. |
| `identity` | `name` / `phone` / `email`. Assembled people must already be addressable. |
| `payload` | Bounded extra facts (reason, channel, move). No calendar slot, no secrets. |

## Kinds and tabs

| Kind | Tab (if it moves) |
| --- | --- |
| `assembled` | Cold |
| `dialogue_started` / `message` | In progress |
| `offer_sent` / `ready_to_book` | Offer made |
| `booked` / `paid` | Done |
| `discarded` | Off the active board |
| `reason_updated`, `stopped`, `human_takeover`, `command_applied` | Timeline only |

Automatic moves do not go backwards. An owner command may discard or pause.

## Commands back

CRM writes a durable command and delivers it to cycle 2 when `EVOROVE_BASE_URL`
is set: discard, correct identity, pause outreach, takeover. Cycle 1 has no
HTTP mouth yet; discard still holds on the board.

`person_id` is minted at the first assembled touch and reused on every later
touch, including hot-lead accept and booking/payment in this CRM.

## Turn the glue on

Same `INTERNAL_TASK_SECRET` in all three processes. Local compose defaults to
`local_development_only` (not for production).

| Process | Env |
| --- | --- |
| CRM | `INTERNAL_TASK_SECRET`, `EVOROVE_BASE_URL` (cycle 2 origin for owner commands) |
| Evorove | `INTERNAL_TASK_SECRET`, `CRM_BASE_URL` |
| Cycle 1 | `INTERNAL_TASK_SECRET`, `CRM_BASE_URL`, and `BusinessSeed.business_id` |

Commands leave CRM on `POST /api/v1/internal/integrations/deliver` (same secret).
