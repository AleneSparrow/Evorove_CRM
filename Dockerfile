FROM node:22-bookworm-slim AS frontend
WORKDIR /web
COPY web/app/package.json web/app/package-lock.json ./
RUN npm ci
COPY web/app/ ./
ENV VITE_API_BASE=
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

# Run as a non-root user. The image had no USER directive, so the container
# ran everything as root -- a remote-code-execution bug anywhere in the app
# would have started with root inside the container instead of an account
# that owns nothing. Port 8000 is above 1024, so binding it needs no
# privilege.
#
# The user is created BEFORE the source is copied, and the copy is chowned to
# it, so that `docker compose run --rm app python -m pytest` can still write
# /app/.pytest_cache. Under root that was free; under appuser a root-owned
# /app would make pytest warn on every run about a cache it cannot create.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --chown=appuser:appuser . .
COPY --from=frontend --chown=appuser:appuser /web/dist /app/web/app/dist

USER appuser

EXPOSE 8000

# ${PORT:-8000} instead of a hardcoded port: hosting platforms that assign
# ports dynamically (Railway, Render, Fly.io) inject PORT and expect the
# process to bind to it; local `docker compose up` doesn't set PORT, so it
# falls back to 8000 exactly as before.
#
# `alembic upgrade head` here is the LOCAL-DEV mechanism: docker-compose.yml
# overrides no command, so this is what migrates a fresh local database. On
# Railway it is a no-op, because railway.toml's preDeployCommand has already
# brought the database to head once, before any container starts -- see the
# comment there. That ordering is what makes more than one replica safe:
# without it, every replica would race to run the same migration on boot,
# and with restartPolicyMaxRetries = 3 a replica that lost the race could
# fall out of the deploy. An upgrade with nothing left to apply only reads
# alembic_version, so running it in both places costs nothing.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn src.api.app:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log"]
