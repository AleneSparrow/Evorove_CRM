# Evorove CRM

Copied on 6 September 2026 from the main engine at `main` (`bc6f38a`).

GitHub: https://github.com/AleneSparrow/Evorove_CRM  
Local: `/Users/alenakulish/dev/evorove-crm`

This repository is the CRM board (Cold → Done) plus close. North star revised
12 September 2026: `/Users/alenakulish/dev/evorove/FOUNDATION.md`. A CRM without
Cold is not a CRM. Booking machinery remains for the Done tab.

`ProcessState` is the case pipeline, not a sales conversation method:

`NEW_LEAD → CONTACTED → QUALIFYING → QUALIFIED → BOOKED/QUOTED → FOLLOW_UP → WON → PAID → COMPLETED`

Handoff contract: [`docs/hot-lead-handoff.md`](docs/hot-lead-handoff.md).

## Sister projects

- `/Users/alenakulish/dev/evorove_lead` — cycle 1, open-web find with a reason → Cold. Not search code here.
- `/Users/alenakulish/dev/evorove` — cycle 2, cold write and sale. Do not retarget this CRM at that sales-stage engine.

## Foundation alignment — slice C, 7 September 2026

The public site from the split still exists as cabinet chrome, legal pages, and
auth. It is no longer a selling landing for inquiry → qualify → book, a lawyers
GTM page, or a sales playbook desk.

- Receive path: `POST /api/v1/businesses/{business_id}/hot-leads`
- Evening screen: `/app` lists tomorrow's confirmed hours
- `/lawyers` redirects home; sales playbook is not a Settings tab

Widget/SMS remain operational channels for collecting fields and confirming an
hour. They are not lead generation.

Live handoff from Evorove reports every sales touch to CRM and POSTs a hot lead
when the person is ready to book. Set `CRM_BASE_URL` and `INTERNAL_TASK_SECRET`
in Evorove; set `EVOROVE_BASE_URL` in CRM for owner commands back. The People
board is the owner window; Tomorrow remains booked hours.
