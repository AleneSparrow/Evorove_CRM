# Flywheel web app

The real, buildable frontend for the AI Business Process Engine — a Vite + React +
TypeScript app that talks to the actual backend in `src/api` (not a mockup).

## What's really wired up

- **Sign up / log in / log out** — `POST /api/v1/auth/signup`, `POST /api/v1/auth/login`,
  `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- **Self-serve onboarding** — the six-step wizard submits `POST /api/v1/businesses` on
  "Launch engine" and creates a real, schema-valid Business DNA (every service starts on
  `human_review`, nothing auto-books until you change that later).
- **Sidebar business name** — reads the real business via `GET /api/v1/businesses/{id}`.
- **Dashboard (leads & cases)** — real cases for your business via
  `GET /api/v1/businesses/{id}/cases`, mapped from the engine's actual `ProcessState`.
- **Conversation view** — real conversation list and message thread via
  `GET /api/v1/businesses/{id}/conversations` and `GET .../conversations/{conversation_id}`,
  plus the real audit trail (`ProcessEvent` history) for the linked case via
  `GET /api/v1/businesses/{id}/cases/{case_id}`.
- **Replying to a customer** — `POST .../conversations/{conversation_id}/reply` sends a
  real outbound message (role `human`), stored and shown in the thread immediately. Moves
  the conversation to `human_takeover_active` if it was only `_requested`.
- **Mark resolved** — `POST .../conversations/{conversation_id}/resolve` approves the
  case's pending transition (the state the engine wanted to move to before it escalated to
  `NEEDS_HUMAN` — see `StaffActionService` in `src/persistence/staff_action_service.py`)
  and closes the conversation. Only enabled while the case is actually `NEEDS_HUMAN`.
- **Business DNA (Settings)** — `GET`/`PUT /api/v1/businesses/{id}/dna` reads and edits the
  real, active Business DNA: name/industry, communication tone, the service list with each
  service's qualification questions, service-area zip codes, and which customer-urgency
  signals (`high`/`emergency` — real `Urgency` values the engine extracts per message, see
  `QualificationService.evaluate`) escalate a case to a human. Every save creates a new,
  versioned Business DNA record (`BusinessDNASettingsService` in
  `src/persistence/business_dna_settings_service.py`) rather than overwriting history, and
  only touches those fields — pricing, booking hours, payment, and everything else already
  configured carries over unchanged. The old mock UI's radius slider and its three
  illustrative escalation checkboxes are gone: they didn't correspond to anything the engine
  actually reads (only postal-code matching and the two urgency values above are real).

All of the above (Milestone 8 slice 2 and its reply/resolve/Business-DNA-settings
follow-ups) are staff-authenticated and scoped to your own `business_id` server-side — a
session token for one business cannot read or act on another's data.

## What's still not wired

- Rich quote pricing (anything other than a fixed amount) and payment collection from
  the end customer are not editable from the UI. Booking hours, timezone, services,
  matching phrases, and service descriptions are on Settings.

## Running it

```bash
cd web/app
npm install
npm run dev
```

Vite proxies `/api`, `/health`, `/ready`, and `/widget` to `http://localhost:8000`.
Leave `VITE_API_BASE` empty. In production the API serves this app from the
same host, so the browser also calls `/api` on that origin.

The API must still list `http://localhost:5173` in `CORS_ALLOWED_ORIGINS` if
you set `VITE_API_BASE` to a different host. With the proxy, same-origin
calls skip CORS.
## Structure

```
src/
  api/client.ts       fetch wrapper + typed calls for every real endpoint
  auth/AuthContext.tsx session state, token persisted in localStorage
  components/          Sidebar, route guards, shared design-system pieces
  pages/                Landing, Signup, Login, Onboarding (all real),
                         Dashboard, Conversation, Settings (preview data)
```
