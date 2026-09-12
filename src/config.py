"""Application configuration loaded exclusively from environment variables."""

import os
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    app_env: str = "development"
    log_level: str = "INFO"
    max_request_body_bytes: int = 65_536
    ai_provider: str = "deterministic"
    openai_api_key: str | None = field(default=None, repr=False)
    openai_model: str | None = None
    anthropic_api_key: str | None = field(default=None, repr=False)
    anthropic_model: str | None = None
    ai_timeout_seconds: float = 20.0
    ai_max_retries: int = 2
    cors_allowed_origins: tuple[str, ...] = ()
    public_chat_rate_limit_requests: int = 20
    public_chat_rate_limit_window_seconds: int = 60
    public_conversation_token_ttl_hours: int = 720
    public_chat_message_max_chars: int = 2_000
    # Billing runs through Lemon Squeezy (a Merchant of Record), not Stripe --
    # Stripe doesn't support Vietnam-based sellers, which this business is.
    # See BillingService for why an MoR changes the integration shape (no
    # direct card handling, custom_data instead of arbitrary metadata,
    # trial length configured on the product/variant in their dashboard
    # rather than per-checkout).
    lemonsqueezy_api_key: str | None = field(default=None, repr=False)
    lemonsqueezy_webhook_secret: str | None = field(default=None, repr=False)
    lemonsqueezy_store_id: str | None = None
    lemonsqueezy_variant_starter: str | None = None
    lemonsqueezy_variant_pro: str | None = None
    billing_trial_days: int = 7
    frontend_base_url: str | None = None
    # SMS delivery runs through Twilio. The account itself is opened and
    # funded by the user from Vietnam (same situation as Lemon Squeezy) --
    # verified before building against it that Twilio accepts billing from
    # 230+ countries with no Vietnam exclusion. The traffic itself is 100%
    # US-market: US phone numbers, US leads texting US attorneys. None of
    # Twilio's Vietnam-market SMS guidelines (sender ID pre-registration,
    # content rules) apply here -- those govern messages *to* Vietnamese
    # numbers, which this product never sends.
    twilio_account_sid: str | None = field(default=None, repr=False)
    twilio_auth_token: str | None = field(default=None, repr=False)
    # The backend's own public URL, used only to tell Twilio where to POST
    # inbound SMS when a number is purchased for a business (see
    # TwilioClient.purchase_phone_number). Distinct from frontend_base_url.
    public_api_base_url: str | None = None
    # Shared secret gating POST /api/v1/internal/follow-up/run (see
    # src/api/routes/internal.py) -- this endpoint has no per-user auth (it's
    # meant to be hit by a Railway Cron Job, not a signed-in staff account),
    # so a bearer secret is the only thing standing between it and anyone
    # who finds the URL. None (the default) means the endpoint is disabled
    # entirely, not "open" -- see that route for the check.
    internal_task_secret: str | None = field(default=None, repr=False)
    evorove_base_url: str | None = None
    # Required only when the owner enables authenticator-app 2FA. It has no
    # development default: an operator must provide high-entropy key material
    # before the server may retain an encrypted TOTP seed.
    account_security_encryption_key: str | None = field(default=None, repr=False)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = field(default=None, repr=False)
    smtp_password: str | None = field(default=None, repr=False)
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    @property
    def smtp_configured(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_from_email))

    @property
    def sms_configured(self) -> bool:
        """Whether Twilio SMS delivery is wired up. Optional at the Settings
        level, same reasoning as billing_configured -- SmsService raises a
        clear, specific error per-request instead of failing app startup."""
        return self.twilio_account_sid is not None

    @property
    def billing_configured(self) -> bool:
        """Whether Lemon Squeezy billing is wired up. Deliberately optional at the
        Settings level (unlike ai_provider) so local dev and early deploys can boot
        without a billing account -- BillingService raises a clear, specific error
        per-request instead of failing the whole app at startup."""
        return self.lemonsqueezy_api_key is not None

    def __post_init__(self) -> None:
        if not self.database_url.strip():
            raise ValueError("database_url must not be empty")
        if not 1_024 <= self.max_request_body_bytes <= 10_485_760:
            raise ValueError("max_request_body_bytes must be between 1024 and 10485760")
        if self.ai_provider not in {"deterministic", "openai", "anthropic"}:
            raise ValueError("ai_provider must be 'deterministic', 'openai', or 'anthropic'")
        if not 0 < self.ai_timeout_seconds <= 120:
            raise ValueError("ai_timeout_seconds must be greater than 0 and at most 120")
        if not 0 <= self.ai_max_retries <= 3:
            raise ValueError("ai_max_retries must be between 0 and 3")
        if self.ai_provider == "openai":
            if self.openai_api_key is None or not self.openai_api_key.strip():
                raise ValueError("OPENAI_API_KEY is required when AI_PROVIDER=openai")
            if self.openai_model is None or not self.openai_model.strip():
                raise ValueError("OPENAI_MODEL is required when AI_PROVIDER=openai")
        if self.ai_provider == "anthropic":
            if self.anthropic_api_key is None or not self.anthropic_api_key.strip():
                raise ValueError("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic")
            if self.anthropic_model is None or not self.anthropic_model.strip():
                raise ValueError("ANTHROPIC_MODEL is required when AI_PROVIDER=anthropic")
        if self.app_env.casefold() in {"production", "prod"} and "*" in self.cors_allowed_origins:
            raise ValueError("wildcard CORS origins are not allowed in production")
        if not 1 <= self.public_chat_rate_limit_requests <= 10_000:
            raise ValueError("public chat rate limit must be between 1 and 10000")
        if not 1 <= self.public_chat_rate_limit_window_seconds <= 3_600:
            raise ValueError("public chat rate limit window must be between 1 and 3600 seconds")
        if not 1 <= self.public_conversation_token_ttl_hours <= 8_760:
            raise ValueError("public conversation token TTL must be between 1 and 8760 hours")
        if not 100 <= self.public_chat_message_max_chars <= 10_000:
            raise ValueError("public chat message maximum must be between 100 and 10000")
        if not 0 <= self.billing_trial_days <= 90:
            raise ValueError("billing_trial_days must be between 0 and 90")
        if self.billing_configured:
            missing = [
                name
                for name, value in (
                    ("LEMONSQUEEZY_WEBHOOK_SECRET", self.lemonsqueezy_webhook_secret),
                    ("LEMONSQUEEZY_STORE_ID", self.lemonsqueezy_store_id),
                    ("LEMONSQUEEZY_VARIANT_STARTER", self.lemonsqueezy_variant_starter),
                    ("LEMONSQUEEZY_VARIANT_PRO", self.lemonsqueezy_variant_pro),
                    ("FRONTEND_BASE_URL", self.frontend_base_url),
                )
                if not value or not value.strip()
            ]
            if missing:
                raise ValueError(
                    "LEMONSQUEEZY_API_KEY is set, so billing is enabled -- also required: "
                    + ", ".join(missing)
                )
        if self.sms_configured:
            sms_missing = [
                name
                for name, value in (
                    ("TWILIO_AUTH_TOKEN", self.twilio_auth_token),
                    ("PUBLIC_API_BASE_URL", self.public_api_base_url),
                )
                if not value or not value.strip()
            ]
            if sms_missing:
                raise ValueError(
                    "TWILIO_ACCOUNT_SID is set, so SMS delivery is enabled -- also required: "
                    + ", ".join(sms_missing)
                )
        if any((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_from_email)) and not self.smtp_configured:
            raise ValueError("SMTP reset delivery requires SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL")
        if not 1 <= self.smtp_port <= 65535:
            raise ValueError("SMTP_PORT must be between 1 and 65535")

    @classmethod
    def from_environment(cls) -> "Settings":
        database_url = cls.database_url_from_environment()
        app_env = os.getenv("APP_ENV", "development").strip()
        if not app_env:
            raise RuntimeError("APP_ENV must not be empty")
        log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
        if log_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise RuntimeError("LOG_LEVEL must be a standard Python logging level")
        ai_provider_value = os.getenv("AI_PROVIDER")
        if ai_provider_value is None or not ai_provider_value.strip():
            raise RuntimeError("AI_PROVIDER is required and must be explicitly configured")
        ai_provider = ai_provider_value.strip().casefold()
        try:
            ai_timeout_seconds = float(os.getenv("AI_TIMEOUT_SECONDS", "20"))
            ai_max_retries = int(os.getenv("AI_MAX_RETRIES", "2"))
            max_request_body_bytes = int(os.getenv("MAX_REQUEST_BODY_BYTES", "65536"))
            rate_limit_requests = int(os.getenv("PUBLIC_CHAT_RATE_LIMIT_REQUESTS", "20"))
            rate_limit_window = int(os.getenv("PUBLIC_CHAT_RATE_LIMIT_WINDOW_SECONDS", "60"))
            token_ttl = int(os.getenv("PUBLIC_CONVERSATION_TOKEN_TTL_HOURS", "720"))
            message_max = int(os.getenv("PUBLIC_CHAT_MESSAGE_MAX_CHARS", "2000"))
            billing_trial_days = int(os.getenv("BILLING_TRIAL_DAYS", "7"))
            smtp_port = int(os.getenv("SMTP_PORT", "587"))
        except ValueError as exc:
            raise RuntimeError("numeric application settings contain an invalid value") from exc
        origins = tuple(
            value.strip()
            for value in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        )
        frontend_base_url = os.getenv("FRONTEND_BASE_URL")
        public_api_base_url = os.getenv("PUBLIC_API_BASE_URL")
        try:
            return cls(
                database_url=database_url,
                app_env=app_env,
                log_level=log_level,
                ai_provider=ai_provider,
                openai_api_key=os.getenv("OPENAI_API_KEY"),
                openai_model=os.getenv("OPENAI_MODEL"),
                anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
                anthropic_model=os.getenv("ANTHROPIC_MODEL"),
                ai_timeout_seconds=ai_timeout_seconds,
                ai_max_retries=ai_max_retries,
                max_request_body_bytes=max_request_body_bytes,
                cors_allowed_origins=origins,
                public_chat_rate_limit_requests=rate_limit_requests,
                public_chat_rate_limit_window_seconds=rate_limit_window,
                public_conversation_token_ttl_hours=token_ttl,
                public_chat_message_max_chars=message_max,
                lemonsqueezy_api_key=os.getenv("LEMONSQUEEZY_API_KEY"),
                lemonsqueezy_webhook_secret=os.getenv("LEMONSQUEEZY_WEBHOOK_SECRET"),
                lemonsqueezy_store_id=os.getenv("LEMONSQUEEZY_STORE_ID"),
                lemonsqueezy_variant_starter=os.getenv("LEMONSQUEEZY_VARIANT_STARTER"),
                lemonsqueezy_variant_pro=os.getenv("LEMONSQUEEZY_VARIANT_PRO"),
                billing_trial_days=billing_trial_days,
                frontend_base_url=frontend_base_url.rstrip("/") if frontend_base_url else None,
                twilio_account_sid=os.getenv("TWILIO_ACCOUNT_SID"),
                twilio_auth_token=os.getenv("TWILIO_AUTH_TOKEN"),
                public_api_base_url=(
                    public_api_base_url.rstrip("/") if public_api_base_url else None
                ),
                internal_task_secret=os.getenv("INTERNAL_TASK_SECRET"),
                evorove_base_url=(
                    os.getenv("EVOROVE_BASE_URL").rstrip("/")
                    if os.getenv("EVOROVE_BASE_URL")
                    else None
                ),
                account_security_encryption_key=os.getenv("ACCOUNT_SECURITY_ENCRYPTION_KEY"),
                smtp_host=os.getenv("SMTP_HOST"), smtp_port=smtp_port,
                smtp_username=os.getenv("SMTP_USERNAME"), smtp_password=os.getenv("SMTP_PASSWORD"),
                smtp_from_email=os.getenv("SMTP_FROM_EMAIL"), smtp_use_tls=os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes"},
            )
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc

    @staticmethod
    def database_url_from_environment() -> str:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is required")
        return database_url
