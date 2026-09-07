# Evorove CRM

Copied on 6 September 2026 from the main engine at `main` (`bc6f38a`).

GitHub: https://github.com/AleneSparrow/Evorove_CRM  
Local: `/Users/alenakulish/dev/evorove-crm`

This repository is cycle 3 of one product: accept an already-hot person, collect
what the service needs, and put a specific hour on the calendar. The evening
screen is tomorrow's appointments.

`ProcessState` is the case pipeline, not a sales conversation method:

`NEW_LEAD → CONTACTED → QUALIFYING → QUALIFIED → BOOKED/QUOTED → FOLLOW_UP → WON → PAID → COMPLETED`

Handoff contract: [`docs/hot-lead-handoff.md`](docs/hot-lead-handoff.md).

## Sister projects

- `/Users/alenakulish/dev/evorove_lead` — cycle 1, find a fitting person with a reason. Not here.
- `/Users/alenakulish/dev/evorove` — cycle 2, sell until ready to book. Do not retarget this CRM at that sales-stage engine.

## Foundation alignment — slice C, 7 September 2026

The public site from the split still exists as cabinet chrome, legal pages, and
auth. It is no longer a selling landing for inquiry → qualify → book, a lawyers
GTM page, or a sales playbook desk.

- Receive path: `POST /api/v1/businesses/{business_id}/hot-leads`
- Evening screen: `/app` lists tomorrow's confirmed hours
- `/lawyers` redirects home; sales playbook is not a Settings tab

Widget/SMS remain operational channels for collecting fields and confirming an
hour. They are not lead generation.

Live handoff from Evorove is not wired yet. Do not delete booking from the
sales repo until that glue exists.
