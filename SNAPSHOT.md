# Evorove CRM

Copied on 6 September 2026 from the main engine at `main` (`bc6f38a`).

GitHub: https://github.com/AleneSparrow/Evorove_CRM  
Local: `/Users/alenakulish/dev/evorove-crm`

This is the operational CRM: cases, leads, qualification as configured fields and policy checks, booking, quoting, follow-up SMS, staff conversations, Business DNA, billing, and audit.

`ProcessState` is the case pipeline, not a sales conversation method:

`NEW_LEAD → CONTACTED → QUALIFYING → QUALIFIED → BOOKED/QUOTED → FOLLOW_UP → WON → PAID → COMPLETED`

## Sister project

Sales-process automation stays in `/Users/alenakulish/dev/evorove` (`AleneSparrow/Evorove`). That repo owns greeting, discovery, needs, presentation, objections, commitment, and then an allowed booking or quote. Do not retarget this CRM repo at that sales-stage engine.

## Website copy — 7 September 2026

The public Pulse site from `/Users/alenakulish/dev/evorove` was copied here so CRM keeps the current marketing surface (intake → qualify → book, audit, Business DNA). Sales-engine copy will be rewritten in the sister repo; this snapshot stays the CRM site.

Copied:

- landing, lawyers landing, FAQ, legal pages (`/privacy`, `/terms`, `/dpa`, `/subprocessors`)
- Pulse brand (`web/app/src/brand`, `web/app/src/index.css`, `tailwind.config.js`, `index.html`)
- public brand assets and Cloudflare Pages `_redirects`
- auth chrome (signup / login / forgot / reset)
- staff cabinet Pulse chrome (sidebar, dashboard, conversations, settings, onboarding, account, billing, FAQ)
- embeddable chat widget
- Three.js landing dependencies in `web/app/package.json`

Not copied: `.env` / `.env.local`, `wrangler.web.toml` (production `evorove.com` routes stay on the sales-engine deploy), sales-knowledge import / shadow-eval API client and the newer sales-playbook UI from the sales-engine branch.

## Not copied (original snapshot)

- Secrets and `.env`
- Uncommitted working-tree files from the sales-engine branch
- Commits after `main` on `feature/sales-prompts-claude`
