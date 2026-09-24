# Deploying Flywheel to production

This is a precise, minimal path to get the real app (not `localhost`) live on
the internet. The backend already has everything it needs (`Dockerfile`,
Alembic migrations run automatically before each deploy, a `/health`
endpoint) — this
guide is mostly account setup and environment variables, most of which only
you can do (creating accounts and entering secrets/payment isn't something
Claude does on your behalf).

One public site: the Docker image builds the React staff app and the API
serves it from the **same origin**. People (Cold → Done), Tomorrow, login,
and `/api/v1` all live on one host. `evorove.com` stays the marketing site
in the sister repo; this CRM belongs on a product host such as
`app.evorove.com`.

- **App + Postgres** → [Railway](https://railway.com). Deploys this repo's
  `Dockerfile` (Node builds `web/app`, Python serves it). Hobby plan is
  enough to start.
- A separate Vercel/Pages frontend is optional. Only use it if you
  deliberately split the UI onto another origin and set `VITE_API_BASE`.

(Render is a fine alternative to Railway if you'd rather use it — same
`Dockerfile`-based deploy — but its free Postgres tier expires after 30 days
and its free web service tier sleeps when idle, which is a bad first
impression on a prospect visiting your own signup funnel. Not recommended for
launch, only mentioned in case you already have a Render account.)

## 1. Backend on Railway

1. Sign up at railway.com (GitHub login is the fastest option) and create a
   **New Project → Deploy from GitHub repo**, pointing at
   `AleneSparrow/Evorove_CRM`. Railway will detect the
   `Dockerfile` automatically.
2. In the same project, click **+ New → Database → PostgreSQL**. Railway
   provisions it and exposes a `DATABASE_URL`-shaped set of variables
   automatically inside the project.
3. On the backend service, open **Variables** and set:
   - `DATABASE_URL` — reference the Postgres plugin's connection string
     (Railway lets you paste a variable reference like
     `${{Postgres.DATABASE_URL}}`, but the value must be in this app's
     expected driver format: `postgresql+psycopg://...` — if Railway's
     Postgres plugin variable comes as a plain `postgresql://...` URL,
     change the scheme prefix to `postgresql+psycopg://` before saving).
   - `APP_ENV` = `production`
   - `AI_PROVIDER` = `deterministic` to launch without any AI dependency at
     all (qualification and booking are deterministic either way; this only
     turns off AI-assisted intake wording), or `anthropic`/`openai` if you
     want AI-assisted wording — if `anthropic`, also set `ANTHROPIC_API_KEY`
     and `ANTHROPIC_MODEL`; if `openai`, set `OPENAI_API_KEY` and
     `OPENAI_MODEL` instead — either way, set the key **directly in
     Railway's Variables tab**, not by giving it to Claude.
   - `CORS_ALLOWED_ORIGINS` — public origin of this app (e.g.
     `https://app.evorove.com`). Same-origin staff UI does not need CORS;
     customer-site widgets do. Production refuses a wildcard (`*`).
   - `FRONTEND_BASE_URL` — the same public origin, no trailing slash.
   - `INTERNAL_TASK_SECRET` — long random value, **the same** as Evorove
     and cycle 1 (`evorove_lead`).
   - `EVOROVE_BASE_URL` — public origin of cycle 2, no trailing slash.
   - `EVOROVE_LEAD_BASE_URL` — public origin of cycle 1's own API, no
     trailing slash. Needed for the board's **Find people** button (the
     owner pastes her site, cycle 1 searches, people land on Cold). Unset:
     the button says search is not connected, and the hypothesis_id ->
     outcome report on Done/drop (phase 3) is silently skipped.
   - `LOG_LEVEL` = `INFO` (optional, this is already the default)
4. Deploy. Railway builds the Docker image (including the staff UI), runs
   `alembic upgrade head` once as a pre-deploy step, then starts the app
   (see `railway.toml`). Once it's live, Railway shows a public URL like
   `https://your-service.up.railway.app` — login and `/app/board` must work
   there before you attach a custom domain.

## 2. Custom domain

After Railway shows `https://your-service.up.railway.app`, open that URL:
login and `/app/board` must load from the same host.

Then **Settings → Networking → Custom domain** (e.g. `app.evorove.com`).
In Cloudflare DNS for `evorove.com`, CNAME that hostname to Railway. Set
`FRONTEND_BASE_URL` and `CORS_ALLOWED_ORIGINS` to `https://app.evorove.com`
and redeploy.

Evorove (cycle 2) needs `CRM_BASE_URL=https://app.evorove.com` (or the
Railway URL until the domain is live) and the same `INTERNAL_TASK_SECRET`.

## 3. Split frontend (optional)

Only if the UI must stay on Cloudflare/Vercel instead of inside Docker:
root `web/app`, build `npm run build`, `VITE_API_BASE` = the Railway API
origin. Then list that UI origin in `CORS_ALLOWED_ORIGINS`.

## 4. Billing (Lemon Squeezy) — required before a real customer can subscribe

Self-serve billing (`src/persistence/billing_service.py`) is fully built and
wired in, but it's off until you do the account-side setup below — with no
`LEMONSQUEEZY_API_KEY` set, the backend boots fine and everything else works,
but billing endpoints return a clear "not configured" error instead of a
crash. Account creation and entering the secret keys are things only you can
do.

Runs on **Lemon Squeezy**, not Stripe — Stripe's supported-country list
doesn't include Vietnam. Lemon Squeezy is a Merchant of Record (it's the
legal seller on every transaction and handles sales-tax/VAT compliance
itself), and it explicitly supports Vietnam-based sellers for payouts. The
fee is higher than Stripe's (5% + $0.50/transaction vs. Stripe's ~2.9% +
$0.30) — a deliberate tradeoff for Vietnam eligibility plus not having to
handle tax compliance yourself.

1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com) and create a
   **Store** (Settings → Stores) — this is where you'll set your payout bank
   account (Vietnamese bank account works here). New stores start in **Test
   mode** (a toggle in Store settings) so you can go through the whole flow
   below before charging real cards.
2. **Products → New product**, twice:
   - **Starter** — subscription, **$199.00/month**.
   - **Pro** — subscription, **$499.00/month**.
   For each product's variant, open **Subscription options** and set the
   **free trial** to **7 days** — this is configured here in the dashboard,
   not passed by the app per-checkout (unlike Stripe). If you ever change
   this number, also update `BILLING_TRIAL_DAYS` below and the "Start 7-day
   free trial" copy in `web/app/src/pages/Billing.tsx` — the app doesn't
   read the trial length back from Lemon Squeezy, it's copy-only there.
   Copy each variant's **Variant ID** (visible in the product's URL or via
   **Store → Products → (product) → Variants**) — you'll need both in step 3.
3. On the Railway backend service, add these Variables:
   - `LEMONSQUEEZY_API_KEY` — **Settings → API** in Lemon Squeezy → **Create
     API key**. Goes directly into Railway, same as `OPENAI_API_KEY`.
   - `LEMONSQUEEZY_STORE_ID` — **Settings → Stores**, shown next to your
     store name.
   - `LEMONSQUEEZY_VARIANT_STARTER` / `LEMONSQUEEZY_VARIANT_PRO` — the two
     Variant IDs from step 2.
   - `FRONTEND_BASE_URL` — your deployed frontend's exact origin (e.g.
     `https://your-app.vercel.app`, no trailing slash) — Lemon Squeezy
     Checkout redirects back here after payment.
   - `BILLING_TRIAL_DAYS` — optional, defaults to `7`; keep in sync with
     step 2's dashboard setting (copy-only, doesn't control anything).
   - `LEMONSQUEEZY_WEBHOOK_SECRET` — from step 4 below (you'll come back to
     this).
4. **Settings → Webhooks → Add webhook** in Lemon Squeezy:
   - Callback URL: `https://your-backend.up.railway.app/api/v1/billing/webhook`
   - Signing secret: type in your own secret string here (Lemon Squeezy
     doesn't generate one for you like Stripe does) — then set that same
     value as `LEMONSQUEEZY_WEBHOOK_SECRET` in Railway (step 3) and
     redeploy.
   - Events to send — select exactly these eight (the app ignores everything
     else, but only select what you need):
     `subscription_created`, `subscription_updated`,
     `subscription_cancelled`, `subscription_resumed`,
     `subscription_expired`, `subscription_paused`,
     `subscription_unpaused`, `subscription_payment_failed`.
5. Smoke test billing specifically: sign up a test account through your live
   frontend, go through onboarding, land on **Billing**, pick a plan, and
   complete Checkout while the store is still in **Test mode** (Lemon
   Squeezy's [testing docs](https://docs.lemonsqueezy.com/help/getting-started/test-mode)
   cover the test card to use). You should land back on `/app/billing` and
   the dashboard should unlock within a few seconds (it's waiting on the
   webhook, not the redirect, to actually flip the switch). Once you're
   confident it works, flip the store out of Test mode in Lemon Squeezy
   before sending it to real customers.

## 5. Smoke test

Once both are live:
- Visit the frontend URL, sign up a real account, run through onboarding, and
  confirm the dashboard loads — this exercises the full stack (frontend →
  backend → Postgres) in one pass.
- Check the backend URL's `/health` and `/ready` directly in a browser — both
  should return `200`.
- If signup fails with a network/CORS-looking error, the almost-certain cause
  is `CORS_ALLOWED_ORIGINS` not exactly matching the frontend's origin
  (scheme + host, no trailing slash) — check step 3.

## 6. Proactive follow-up SMS (optional)

Re-contacts a stalled lead (never replied, still `NEW_LEAD`/`CONTACTED`/
`QUALIFYING`) after the delays configured in Business DNA's
`sales.follow_up` (24h/72h/168h by default, up to 3 attempts). Requires SMS
already set up (a business has provisioned a Twilio number from Settings)
and, per lead, an explicit consent checkbox ticked in the widget -- no
consent, no follow-up, ever (see `src/domain/models.py`'s `Lead.sms_consent`
docstring). Skip this whole section if you don't want proactive follow-up
yet; nothing else in the deploy depends on it.

1. On the backend service, set `INTERNAL_TASK_SECRET` to a long random
   value (e.g. `openssl rand -hex 32`) in Railway's Variables tab. Leaving
   it unset disables the endpoint entirely -- it refuses every request
   rather than running unauthenticated.
2. In the same Railway project, **+ New → Cron Job** (or **Empty Service**
   configured as a scheduled job, depending on what your Railway plan
   offers). Point it at the backend service's public URL and have it run,
   on whatever cadence you want checked (hourly is reasonable given the
   24h/72h/168h defaults):
   ```
   curl -X POST https://your-backend.up.railway.app/api/v1/internal/follow-up/run \
     -H "X-Internal-Task-Secret: <the same value as INTERNAL_TASK_SECRET>"
   ```
   The same secret also gates two other sweeps added with migration `0020`.
   Run them on the same hourly (or slower) cadence, or by hand:
   ```
   curl -X POST https://your-backend.up.railway.app/api/v1/internal/integrations/deliver \
     -H "X-Internal-Task-Secret: <the same value as INTERNAL_TASK_SECRET>"

   curl -X POST https://your-backend.up.railway.app/api/v1/internal/commercial/expire \
     -H "X-Internal-Task-Secret: <the same value as INTERNAL_TASK_SECRET>"
   ```
   The same secret also gates `POST /api/v1/internal/businesses/{business_id}/hot-leads`
   and `POST /api/v1/internal/businesses/{business_id}/lead-touches`. Evorove POSTs
   both when `CRM_BASE_URL` is set. Set `EVOROVE_BASE_URL` on this service to the
   cycle-2 origin so owner board commands can be delivered. Use the same secret
   value in both deployments. `integrations/deliver` ships those commands.

   `integrations/deliver` retries CRM webhook outbox rows and conversational
   SMS replies. `commercial/expire`
   expires stale quotes and payment requests that nobody has messaged since
   they became due.
3. You can also just call it by hand any time (same curl command) to run a
   sweep immediately instead of waiting for the schedule.

Deliberately NOT an automatic in-process background loop -- see
`src/persistence/follow_up_service.py`'s module docstring for why (mainly:
it stays safe to trigger from more than one place, or scale to more than
one replica, without double-sending).

**Not yet done, before this should carry real customer traffic:** the
widget's consent checkbox text (`web/widget/widget.js`) is a placeholder
shape, not reviewed by a lawyer -- see the delivery notes for this feature.
Inbound SMS `STOP` / `START` / `HELP` are honored on the Twilio number.
Also, only the website chat widget captures follow-up consent right now; a
lead that only ever came in over inbound SMS or the direct API has no
follow-up consent-capture path yet and will simply never qualify for
proactive follow-up (safe by default, just incomplete coverage). Conversation
replies to a number that texted in still go out until that person sends STOP.

## Known limitation carried over from local dev

The public chat and account-security rate limiter (`src/api/rate_limit.py`)
is shared across workers via the `rate_limit_hits` table (migration `0020`).
A second Railway replica is therefore no longer blocked on abuse control.
Calendar sync for the tenant's own Google/Outlook calendar, and collection
of money from the tenant's end customer, remain deferred.
Migrations used to race when they ran inside every container's start
command. They now run once, as `preDeployCommand` in `railway.toml`.
