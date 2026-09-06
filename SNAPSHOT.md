# Evorove CRM

Copied on 6 September 2026 from `ai-business-process-engine` at `main` (`bc6f38a`).

GitHub: https://github.com/AleneSparrow/Evorove_CRM  
Local: `/Users/alenakulish/dev/evorove`

This is the operational CRM: cases, leads, qualification as configured fields and policy checks, booking, quoting, follow-up SMS, staff conversations, Business DNA, billing, and audit.

`ProcessState` is the case pipeline, not a sales conversation method:

`NEW_LEAD → CONTACTED → QUALIFYING → QUALIFIED → BOOKED/QUOTED → FOLLOW_UP → WON → PAID → COMPLETED`

## Sister project

Sales-process automation stays in `/Users/alenakulish/dev/ai-business-process-engine` (`AleneSparrow/ai-business-process-engine`). That repo owns greeting, discovery, needs, presentation, objections, commitment, and then an allowed booking or quote. Do not retarget Evorove at that sales-stage engine.

## Not copied

- Secrets and `.env`
- Uncommitted working-tree files from the sales-engine branch
- Commits after `main` on `feature/sales-prompts-claude`
