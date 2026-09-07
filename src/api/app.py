"""FastAPI application factory and production entry point."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.engine import Engine

from src.config import Settings
from src.ai.runtime import build_ai_runtime
from src.engine.customer_response_generator import CustomerResponseGenerator
from src.engine.intent_extractor import IntentExtractor
from src.engine.question_generator import QuestionGenerator
from src.engine.reassurance_response_generator import (
    ReassuranceResponseGenerator,
    UniversalReassuranceResponseGenerator,
)
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine
from src.persistence.password_reset_email import (
    DisabledPasswordResetEmailSender,
    InMemoryPasswordResetEmailSender,
    SmtpPasswordResetEmailSender,
)

from .dependencies import ApplicationContainer
from .errors import install_error_handlers
from .middleware import RequestContextMiddleware
from .cors import ConfiguredCORSMiddleware
from .rate_limit import SqlSlidingWindowRateLimiter
from .observability import configure_logging, log_event
from .routes import (
    auth,
    billing,
    business_dna,
    businesses,
    dashboard,
    health,
    hot_leads,
    integrations,
    internal,
    lead_intake,
    onboarding,
    public_conversations,
    sales,
    sms,
)


def _maybe_run_migrations_on_startup(runtime_settings: Settings) -> None:
    """Auto-apply Alembic migrations for local development only.

    Local dev servers are commonly started against a Postgres instance whose
    schema has drifted behind the latest migration in the repo (a new
    milestone adds tables the running database doesn't have yet), which
    otherwise surfaces as an opaque 500 on the first request that touches
    the missing table. Running `alembic upgrade head` is a no-op when the
    schema is already current, so this is safe to attempt on every startup.

    Deliberately restricted to app_env == "development": test fixtures build
    their own schema directly via `Base.metadata.create_all` against an
    isolated database and must not have this reach for `DATABASE_URL` from
    the environment instead, and production schema changes should be a
    reviewed, explicit deploy step rather than an implicit side effect of
    process startup.
    """
    if runtime_settings.app_env.casefold() != "development":
        return
    try:
        from alembic import command
        from alembic.config import Config as AlembicConfig

        repo_root = Path(__file__).parents[2]
        alembic_cfg = AlembicConfig(str(repo_root / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(repo_root / "migrations"))
        command.upgrade(alembic_cfg, "head")
        log_event(logging.INFO, "startup_migrations_applied", app_env=runtime_settings.app_env)
    except Exception as exc:
        # Never block startup on this — worst case the pre-existing "opaque
        # 500 on missing table" behavior is unchanged, just not auto-fixed.
        log_event(
            logging.WARNING,
            "startup_migrations_failed",
            app_env=runtime_settings.app_env,
            error_type=type(exc).__name__,
        )


def create_app(
    *,
    settings: Settings | None = None,
    intent_extractor: IntentExtractor | None = None,
    question_generator: QuestionGenerator | None = None,
    customer_response_generator: CustomerResponseGenerator | None = None,
    reassurance_response_generator: ReassuranceResponseGenerator | None = None,
    universal_reassurance_response_generator: UniversalReassuranceResponseGenerator | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        runtime_settings = settings or Settings.from_environment()
        configure_logging(runtime_settings.log_level)
        ai_runtime = build_ai_runtime(runtime_settings)
        configured_intent_extractor = intent_extractor or ai_runtime.intent_extractor
        configured_question_generator = question_generator or ai_runtime.question_generator
        configured_response_generator = (
            customer_response_generator or ai_runtime.customer_response_generator
        )
        configured_reassurance_generator = (
            reassurance_response_generator or ai_runtime.reassurance_response_generator
        )
        configured_universal_reassurance_generator = (
            universal_reassurance_response_generator
            or ai_runtime.universal_reassurance_response_generator
        )
        engine: Engine | None = None
        try:
            engine = create_database_engine(runtime_settings.database_url)
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception as exc:
            if engine is not None:
                engine.dispose()
            log_event(
                logging.CRITICAL,
                "application_startup_failed",
                app_env=runtime_settings.app_env,
                error_type=type(exc).__name__,
            )
            raise RuntimeError("API startup failed: database connection is unavailable") from exc

        if engine is None:  # Defensive narrowing; the successful connection path always assigns it.
            raise RuntimeError("API startup failed: database engine was not initialized")
        _maybe_run_migrations_on_startup(runtime_settings)
        application.state.container = ApplicationContainer(
            settings=runtime_settings,
            engine=engine,
            unit_of_work_factory=SQLAlchemyUnitOfWork.factory_for_engine(engine),
            intent_extractor=configured_intent_extractor,
            question_generator=configured_question_generator,
            customer_response_generator=configured_response_generator,
            reassurance_response_generator=configured_reassurance_generator,
            universal_reassurance_response_generator=configured_universal_reassurance_generator,
            ai_provider_name=ai_runtime.provider_name,
            ai_model_name=ai_runtime.model_name,
            public_chat_rate_limiter=SqlSlidingWindowRateLimiter(
                engine,
                runtime_settings.public_chat_rate_limit_requests,
                runtime_settings.public_chat_rate_limit_window_seconds,
            ),
            account_security_rate_limiter=SqlSlidingWindowRateLimiter(engine, 5, 900),
            # Development/test never deliver real account-recovery mail. The
            # in-memory outbox is intentionally not an HTTP endpoint.
            password_reset_email_sender=(
                InMemoryPasswordResetEmailSender()
                if runtime_settings.app_env.casefold() in {"development", "test"}
                else SmtpPasswordResetEmailSender(
                    host=runtime_settings.smtp_host or "", port=runtime_settings.smtp_port,
                    username=runtime_settings.smtp_username or "", password=runtime_settings.smtp_password or "",
                    from_email=runtime_settings.smtp_from_email or "", use_tls=runtime_settings.smtp_use_tls,
                ) if runtime_settings.smtp_configured else DisabledPasswordResetEmailSender()
            ),
        )
        log_event(
            logging.INFO,
            "application_started",
            app_env=runtime_settings.app_env,
            ai_provider=ai_runtime.provider_name,
            ai_model=ai_runtime.model_name,
        )
        try:
            yield
        finally:
            engine.dispose()
            application.state.container = None
            log_event(logging.INFO, "application_stopped", app_env=runtime_settings.app_env)

    application = FastAPI(
        title="AI Business Process Engine API",
        description=(
            "Tenant-scoped HTTP API for durable lead intake, qualification, website conversations, "
            "and deterministic booking/quoting. "
            "Understanding and response wording use the explicitly configured AI provider; "
            "business decisions remain deterministic and policy-bound."
        ),
        version="0.7.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        RequestContextMiddleware,
        max_request_body_bytes=(settings.max_request_body_bytes if settings else 65_536),
    )
    application.add_middleware(ConfiguredCORSMiddleware)
    install_error_handlers(application)
    application.include_router(health.router)
    application.include_router(auth.router)
    application.include_router(businesses.router)
    application.include_router(onboarding.router)
    application.include_router(dashboard.router)
    application.include_router(business_dna.router)
    application.include_router(integrations.router)
    application.include_router(billing.router)
    application.include_router(billing.webhook_router)
    application.include_router(lead_intake.router)
    application.include_router(hot_leads.router)
    application.include_router(hot_leads.internal_router)
    application.include_router(public_conversations.router)
    application.include_router(sales.router)
    application.include_router(sms.router)
    application.include_router(sms.public_router)
    application.include_router(internal.router)
    application.mount(
        "/widget",
        StaticFiles(directory=Path(__file__).parents[2] / "web" / "widget", html=True),
        name="widget",
    )
    return application


app = create_app()
