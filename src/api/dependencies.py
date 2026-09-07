"""Request-scoped dependency wiring for database-backed services."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Path, Request
from sqlalchemy import Engine

from src.config import Settings
from src.domain.auth import StaffUser
from src.domain.tenancy import Business
from src.engine.intent_extractor import IntentExtractor
from src.engine.customer_response_generator import CustomerResponseGenerator
from src.engine.question_generator import QuestionGenerator
from src.engine.reassurance_response_generator import (
    ReassuranceResponseGenerator,
    UniversalReassuranceResponseGenerator,
)
from src.persistence.auth_service import AuthService, SessionInvalidError
from src.persistence.password_reset_email import PasswordResetEmailSender
from src.persistence.billing_service import BillingService
from src.persistence.business_provisioning_service import BusinessProvisioningService
from src.persistence.hot_lead_handoff import PersistentHotLeadHandoffService
from src.persistence.lead_intake import PersistentLeadIntakeService
from src.persistence.conversation_service import ConversationService
from src.persistence.business_dna_settings_service import BusinessDNASettingsService
from src.persistence.crm_webhook_service import CrmWebhookService
from src.persistence.sms_service import SmsService
from src.persistence.sms_thread_service import SmsThreadService
from src.persistence.staff_action_service import StaffActionService
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork

from .errors import ForbiddenError, PaymentRequiredError, ResourceNotFoundError, UnauthorizedError
from .rate_limit import RateLimiter


BusinessIdPath = Annotated[
    str,
    Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$"),
]
UnitOfWorkFactory = Callable[[], SQLAlchemyUnitOfWork]


@dataclass(frozen=True, slots=True)
class ApplicationContainer:
    settings: Settings
    engine: Engine
    unit_of_work_factory: UnitOfWorkFactory
    intent_extractor: IntentExtractor
    question_generator: QuestionGenerator
    customer_response_generator: CustomerResponseGenerator
    reassurance_response_generator: ReassuranceResponseGenerator
    universal_reassurance_response_generator: UniversalReassuranceResponseGenerator
    ai_provider_name: str
    ai_model_name: str
    public_chat_rate_limiter: RateLimiter
    account_security_rate_limiter: RateLimiter
    password_reset_email_sender: PasswordResetEmailSender


def get_container(request: Request) -> ApplicationContainer:
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, ApplicationContainer):
        raise RuntimeError("application dependencies are not initialized")
    return container


def resolve_public_api_base(
    request: Request,
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> str:
    """Best-effort absolute origin for this deployment -- used to build
    absolute URLs (e.g. the widget embed snippet in schemas.py) that stay
    correct behind a TLS-terminating reverse proxy.

    `str(request.base_url)` alone is NOT enough here: it reports the scheme
    of the connection *to this process*, which on Railway (and most PaaS
    setups) is plain HTTP even though the public URL is HTTPS -- TLS
    terminates at the platform's edge, not at this container. A naive
    `str(request.base_url)` therefore silently produces an http:// URL,
    which a real HTTPS site refuses to load as mixed content (found live:
    the widget snippet rendered as `http://...` even though Settings itself
    is served over https).

    Preference order:
    1. `PUBLIC_API_BASE_URL` (src/config.py) -- the same explicitly
       configured public URL already used for SMS webhook URLs (see
       get_sms_service) -- set once, guaranteed correct, no proxy trust
       required.
    2. `X-Forwarded-Proto`, if the proxy set it -- the standard way a
       reverse proxy communicates the original scheme.
    3. `request.base_url` as-is, if neither is available.
    """
    configured = container.settings.public_api_base_url
    if configured:
        return configured
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        scheme = forwarded_proto.split(",")[0].strip()
        if scheme:
            return f"{scheme}://{request.url.netloc}"
    return str(request.base_url).rstrip("/")


def get_unit_of_work_factory(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> UnitOfWorkFactory:
    return container.unit_of_work_factory


def get_intake_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> PersistentLeadIntakeService:
    return PersistentLeadIntakeService(
        container.unit_of_work_factory,
        container.intent_extractor,
        container.question_generator,
        customer_response_generator=container.customer_response_generator,
        reassurance_response_generator=container.reassurance_response_generator,
        universal_reassurance_response_generator=container.universal_reassurance_response_generator,
    )


def get_hot_lead_handoff_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> PersistentHotLeadHandoffService:
    return PersistentHotLeadHandoffService(container.unit_of_work_factory)


def get_conversation_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> ConversationService:
    return ConversationService(
        container.unit_of_work_factory,
        container.intent_extractor,
        container.question_generator,
        container.customer_response_generator,
        reassurance_response_generator=container.reassurance_response_generator,
        universal_reassurance_response_generator=container.universal_reassurance_response_generator,
        token_ttl_hours=container.settings.public_conversation_token_ttl_hours,
    )


def get_public_chat_rate_limiter(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> RateLimiter:
    return container.public_chat_rate_limiter


def get_auth_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> AuthService:
    return AuthService(
        container.unit_of_work_factory,
        frontend_base_url=container.settings.frontend_base_url,
        password_reset_email_sender=container.password_reset_email_sender,
        account_security_encryption_key=container.settings.account_security_encryption_key,
        forgot_password_rate_limiter=container.account_security_rate_limiter,
    )


def get_business_provisioning_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> BusinessProvisioningService:
    return BusinessProvisioningService(container.unit_of_work_factory)


def get_business_dna_settings_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> BusinessDNASettingsService:
    return BusinessDNASettingsService(container.unit_of_work_factory)


def get_crm_webhook_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> CrmWebhookService:
    return CrmWebhookService(container.unit_of_work_factory)


def get_sms_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> SmsService:
    return SmsService(
        container.unit_of_work_factory,
        account_sid=container.settings.twilio_account_sid,
        auth_token=container.settings.twilio_auth_token,
        public_api_base_url=container.settings.public_api_base_url,
    )


def get_sms_thread_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> SmsThreadService:
    return SmsThreadService(container.unit_of_work_factory)


def get_staff_action_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
    sms_service: Annotated[SmsService, Depends(get_sms_service)],
) -> StaffActionService:
    return StaffActionService(container.unit_of_work_factory, sms_service=sms_service)


def get_billing_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> BillingService:
    return BillingService(container.unit_of_work_factory, container.settings)


def get_current_staff_user(
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    authorization: Annotated[str | None, Header()] = None,
) -> StaffUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise UnauthorizedError()
    try:
        return auth_service.authenticate(token)
    except SessionInvalidError as exc:
        raise UnauthorizedError() from exc


def require_business_owner(
    user: Annotated[StaffUser, Depends(get_current_staff_user)],
) -> StaffUser:
    if not user.business_ids:
        raise ForbiddenError("This account has not created a business yet")
    return user


def require_own_business(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(get_current_staff_user)],
) -> StaffUser:
    """Staff-facing dashboard endpoints: the caller may only see a business
    their account is linked to -- one account may be linked to several."""
    if business_id not in user.business_ids:
        raise ForbiddenError("Not permitted for this business")
    return user


def resolve_business(
    request: Request,
    business_id: BusinessIdPath,
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> Business:
    request.state.business_id = business_id
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
    if business is None:
        raise ResourceNotFoundError("business_not_found", "Business was not found")
    return business


def require_active_subscription(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> StaffUser:
    """Gates the staff dashboard (cases/conversations -- the product's actual
    delivered value) on the business having billing access (see
    `Business.has_billing_access`). Deliberately NOT applied to Settings/Business
    DNA (the owner needs to reach billing to fix a lapsed subscription) or to
    public lead-intake/widget routes (a payment problem on Flywheel's side
    shouldn't immediately break the automation a business's own customers are
    already relying on)."""
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
    if business is None:
        raise ResourceNotFoundError("business_not_found", "Business was not found")
    if not business.has_billing_access:
        raise PaymentRequiredError()
    return user
