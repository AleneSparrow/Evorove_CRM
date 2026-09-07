"""Pydantic request and response contracts for API v1."""

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from src.domain.models import Lead, ProcessCase, ProcessEvent
from src.domain.qualification import LeadIntakeResult
from src.domain.states import ProcessState
from src.domain.tenancy import Business, BusinessDNAVersion
from src.engine.lead_intake import LeadIntakeService
from src.domain.conversations import Conversation, ConversationStatus, MessageDirection, MessageRole
from src.domain.commercial import BookingStatus, PaymentStatus, PaymentType, QuoteStatus
from src.domain.sales import (
    CustomerSalesProfile,
    SalesKnowledgeCard,
    SalesKnowledgeStatus,
    SalesMove,
    SalesObjectionRecord,
    SalesPlaybookStatus,
    SalesPlaybookVersion,
    SalesStage,
    SalesTurn,
)
from src.persistence.conversation_service import PublicCommercialSnapshot, PublicConversation


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IncomingMessageRequest(ApiModel):
    channel: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$")]
    external_message_id: Annotated[str, Field(min_length=1, max_length=255)]
    message: Annotated[str, Field(min_length=1, max_length=10_000)]
    timestamp: AwareDatetime
    customer_name: Annotated[str | None, Field(min_length=1, max_length=255)] = None
    phone: Annotated[str | None, Field(min_length=1, max_length=64)] = None
    email: Annotated[str | None, Field(min_length=1, max_length=320)] = None
    case_id: Annotated[str | None, Field(min_length=1, max_length=128)] = None

    @field_validator("channel")
    @classmethod
    def normalize_channel(cls, value: str) -> str:
        return value.casefold()

    @field_validator("external_message_id")
    @classmethod
    def validate_external_message_id(cls, value: str) -> str:
        if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("external_message_id must not contain whitespace or control characters")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if any(character not in "+-(). 0123456789" for character in value):
            raise ValueError("phone contains unsupported characters")
        LeadIntakeService._normalize_phone(value)
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return LeadIntakeService._normalize_email(value)


class HotLeadIdentityRequest(ApiModel):
    name: Annotated[str | None, Field(min_length=1, max_length=255)] = None
    phone: Annotated[str | None, Field(min_length=1, max_length=64)] = None
    email: Annotated[str | None, Field(min_length=1, max_length=320)] = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if any(character not in "+-(). 0123456789" for character in value):
            raise ValueError("phone contains unsupported characters")
        LeadIntakeService._normalize_phone(value)
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return LeadIntakeService._normalize_email(value)

    @model_validator(mode="after")
    def require_addressable_identity(self) -> "HotLeadIdentityRequest":
        if not self.phone and not self.email:
            raise ValueError("A hot lead must already be addressable by phone or email")
        return self


class HotLeadReadinessRequest(ApiModel):
    evidence_excerpt: Annotated[str, Field(min_length=1, max_length=4_000)]
    signal: Literal["ready_to_book"] = "ready_to_book"


class HotLeadHandoffRequest(ApiModel):
    """Receive contract from Evorove: a person ready to book, not a calendar slot."""

    handoff_id: Annotated[str, Field(min_length=1, max_length=255)]
    channel: Literal["sms", "web_chat", "email"]
    identity: HotLeadIdentityRequest
    service_id: Annotated[str, Field(min_length=1, max_length=128)]
    readiness: HotLeadReadinessRequest
    source: Literal["evorove"] = "evorove"
    schema_version: Literal["1"] = "1"
    sales_profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    customer_location: Annotated[str | None, Field(min_length=1, max_length=64)] = None

    @field_validator("handoff_id")
    @classmethod
    def validate_handoff_id(cls, value: str) -> str:
        if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("handoff_id must not contain whitespace or control characters")
        return value

    @model_validator(mode="after")
    def reject_calendar_fields_in_snapshot(self) -> "HotLeadHandoffRequest":
        forbidden = {"slot_start_at", "start_at", "booking_id", "end_at"}
        if forbidden.intersection(self.sales_profile_snapshot):
            raise ValueError("sales_profile_snapshot must not include a calendar slot")
        return self


class HotLeadHandoffResponse(ApiModel):
    business_id: str
    case_id: str
    lead_id: str
    current_state: ProcessState
    service_id: str
    waiting_channel: str
    duplicate: bool
    booking_id: None = None


class CustomerResponseSchema(ApiModel):
    message_text: str
    channel: str
    reason: str
    related_case_id: str
    requires_human: bool


class QualificationSummarySchema(ApiModel):
    qualified: bool
    reasons: tuple[str, ...]
    missing_fields: tuple[str, ...]
    unanswered_questions: tuple[str, ...]
    confidence: float
    recommended_next_state: ProcessState
    requires_human: bool
    booking_allowed: bool
    service_id: str | None


class LeadIntakeResponse(ApiModel):
    business_id: str
    case_id: str
    lead_id: str
    current_state: ProcessState
    duplicate: bool
    case_created: bool
    customer_response: CustomerResponseSchema | None
    requires_human: bool
    qualification: QualificationSummarySchema

    @classmethod
    def from_result(cls, business_id: str, result: LeadIntakeResult) -> "LeadIntakeResponse":
        response = result.response
        qualification = result.qualification
        return cls(
            business_id=business_id,
            case_id=result.case_id,
            lead_id=result.lead_id,
            current_state=result.current_state,
            duplicate=result.duplicate,
            case_created=result.case_created,
            customer_response=None if response is None else CustomerResponseSchema(
                message_text=response.message_text,
                channel=response.channel,
                reason=response.reason,
                related_case_id=response.related_case_id,
                requires_human=response.requires_human,
            ),
            requires_human=qualification.requires_human or bool(response and response.requires_human),
            qualification=QualificationSummarySchema(
                qualified=qualification.qualified,
                reasons=qualification.reasons,
                missing_fields=qualification.missing_fields,
                unanswered_questions=qualification.unanswered_questions,
                confidence=qualification.confidence,
                recommended_next_state=qualification.recommended_next_state,
                requires_human=qualification.requires_human,
                booking_allowed=qualification.booking_allowed,
                service_id=qualification.service_id,
            ),
        )


class BusinessResponse(ApiModel):
    business_id: str
    name: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_domain(cls, business: Business) -> "BusinessResponse":
        return cls(
            business_id=business.business_id,
            name=business.name,
            created_at=business.created_at,
            updated_at=business.updated_at,
        )


# --- CRM webhook: optional outbound sync (e.g. Clio) on QUALIFIED/WON cases --
# The URL itself is never returned by the API -- it's effectively a bearer
# secret (Zapier/Make-style catch hooks embed a token in the path).


class CrmWebhookStatusResponse(ApiModel):
    configured: bool


class CrmWebhookConfigureRequest(ApiModel):
    webhook_url: str = Field(min_length=1, max_length=2048)


class SmsStatusResponse(ApiModel):
    configured: bool
    phone_number: str | None = None


# --- Billing: self-serve Lemon Squeezy subscription for the business's own Flywheel account --


class BillingStatusResponse(ApiModel):
    plan: Literal["starter", "pro"] | None
    subscription_status: str
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    has_billing_access: bool

    @classmethod
    def from_domain(cls, business: Business) -> "BillingStatusResponse":
        return cls(
            plan=business.plan,
            subscription_status=business.subscription_status,
            trial_ends_at=business.trial_ends_at,
            current_period_end=business.current_period_end,
            has_billing_access=business.has_billing_access,
        )


class CheckoutSessionRequest(ApiModel):
    plan: Literal["starter", "pro"]


class CheckoutSessionResponse(ApiModel):
    checkout_url: str


class PortalSessionResponse(ApiModel):
    portal_url: str


class HealthResponse(ApiModel):
    status: str


class ReadinessResponse(ApiModel):
    status: str
    dependencies: dict[str, str]


class ValidationIssue(ApiModel):
    location: tuple[str | int, ...]
    message: str
    type: str


class ErrorDetail(ApiModel):
    code: str
    message: str
    request_id: str
    details: list[ValidationIssue] | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail


class PublicConversationCreateRequest(ApiModel):
    message: Annotated[str | None, Field(min_length=1, max_length=10_000)] = None
    external_message_id: Annotated[str | None, Field(min_length=1, max_length=255)] = None
    conversation_token: Annotated[
        str | None,
        Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]{43}$"),
    ] = None
    # Sticky, explicit opt-in for proactive follow-up SMS (a widget
    # checkbox) -- see Lead.sms_consent/IncomingMessage.sms_consent. Once
    # sent as True on any message in a conversation, LeadIntakeService._
    # updated_lead ORs it in permanently; sending False here never revokes
    # a prior True.
    sms_consent: bool = False
    customer_timezone: str | None = None

    @model_validator(mode="after")
    def require_complete_first_message(self) -> "PublicConversationCreateRequest":
        if (self.message is None) != (self.external_message_id is None):
            raise ValueError("message and external_message_id must be supplied together")
        return self

    @field_validator("customer_timezone")
    @classmethod
    def sanitize_optional_customer_timezone(cls, value: str | None) -> str | None:
        from src.domain.customer_timezone import sanitize_customer_timezone

        return sanitize_customer_timezone(value)
        if (self.message is None) != (self.external_message_id is None):
            raise ValueError("message and external_message_id must be supplied together")
        return self

    @field_validator("external_message_id")
    @classmethod
    def validate_external_message_id(cls, value: str | None) -> str | None:
        if value is not None and any(
            character.isspace() or ord(character) < 32 or ord(character) == 127
            for character in value
        ):
            raise ValueError("external_message_id must not contain whitespace or control characters")
        return value


class PublicConversationMessageRequest(ApiModel):
    message: Annotated[str, Field(min_length=1, max_length=10_000)]
    external_message_id: Annotated[str, Field(min_length=1, max_length=255)]
    # See PublicConversationCreateRequest.sms_consent.
    sms_consent: bool = False

    @field_validator("external_message_id")
    @classmethod
    def validate_external_message_id(cls, value: str) -> str:
        if any(
            character.isspace() or ord(character) < 32 or ord(character) == 127
            for character in value
        ):
            raise ValueError("external_message_id must not contain whitespace or control characters")
        return value


class PublicConversationMessageSchema(ApiModel):
    direction: MessageDirection
    role: MessageRole
    text: str
    created_at: datetime


class PublicConversationResponse(ApiModel):
    conversation_token: str
    status: ConversationStatus
    current_state: ProcessState | None
    requires_human: bool
    duplicate: bool
    messages: tuple[PublicConversationMessageSchema, ...]

    @classmethod
    def from_domain(cls, conversation: PublicConversation) -> "PublicConversationResponse":
        return cls(
            conversation_token=conversation.conversation_token,
            status=conversation.status,
            current_state=conversation.current_state,
            requires_human=conversation.requires_human,
            duplicate=conversation.duplicate,
            messages=tuple(
                PublicConversationMessageSchema(
                    direction=message.direction,
                    role=message.role,
                    text=message.text,
                    created_at=message.created_at,
                )
                for message in conversation.messages
            ),
        )


class PublicServiceOptionSchema(ApiModel):
    """Just enough to render a quick-reply chip in the widget's opening
    turn -- id/name only, deliberately not the full catalog entry (no
    pricing, no questions) since this is exposed on the *public,
    pre-conversation* chat-config endpoint alongside welcome_message."""

    id: str
    name: str


class PublicChatConfigResponse(ApiModel):
    enabled: bool
    business_name: str
    chat_title: str
    welcome_message: str
    language: str
    ai_disclosure_text: str
    services: tuple[PublicServiceOptionSchema, ...] = ()


class PublicBookingSchema(ApiModel):
    booking_id: str
    service_id: str
    status: BookingStatus
    start_at: datetime
    end_at: datetime
    timezone: str


class PublicQuoteSchema(ApiModel):
    quote_id: str
    service_id: str
    status: QuoteStatus
    currency: str
    total: Decimal
    valid_until: datetime


class PublicPaymentRequestSchema(ApiModel):
    payment_request_id: str
    status: PaymentStatus
    payment_type: PaymentType
    amount: Decimal
    currency: str
    expires_at: datetime


class PublicProposedSlotSchema(ApiModel):
    # 1-based -- send this number straight back as the customer's next chat
    # message (e.g. as the value of a slot-picker button) to select it; the
    # deterministic slot interpreter accepts a bare "1"/"2"/"3" reply as-is.
    option: int
    slot_id: str
    start_at: datetime
    end_at: datetime
    timezone: str


class PublicCommercialResponse(ApiModel):
    current_state: ProcessState | None
    booking: PublicBookingSchema | None
    quote: PublicQuoteSchema | None
    payment_request: PublicPaymentRequestSchema | None
    proposed_slots: tuple[PublicProposedSlotSchema, ...] = ()

    @classmethod
    def from_domain(cls, value: PublicCommercialSnapshot) -> "PublicCommercialResponse":
        return cls(
            current_state=value.current_state,
            booking=(
                PublicBookingSchema(
                    booking_id=value.booking.booking_id,
                    service_id=value.booking.service_id,
                    status=value.booking.status,
                    start_at=value.booking.start_at,
                    end_at=value.booking.end_at,
                    timezone=value.booking.timezone,
                )
                if value.booking is not None
                else None
            ),
            quote=(
                PublicQuoteSchema(
                    quote_id=value.quote.quote_id,
                    service_id=value.quote.service_id,
                    status=value.quote.status,
                    currency=value.quote.currency,
                    total=value.quote.total,
                    valid_until=value.quote.valid_until,
                )
                if value.quote is not None
                else None
            ),
            payment_request=(
                PublicPaymentRequestSchema(
                    payment_request_id=value.payment_request.payment_request_id,
                    status=value.payment_request.status,
                    payment_type=value.payment_request.payment_type,
                    amount=value.payment_request.amount,
                    currency=value.payment_request.currency,
                    expires_at=value.payment_request.expires_at,
                )
                if value.payment_request is not None
                else None
            ),
            proposed_slots=tuple(
                PublicProposedSlotSchema(
                    option=slot.option,
                    slot_id=slot.slot_id,
                    start_at=slot.start_at,
                    end_at=slot.end_at,
                    timezone=slot.timezone,
                )
                for slot in value.proposed_slots
            ),
        )


def validation_issues(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "location": tuple(error.get("loc", ())),
            "message": str(error.get("msg", "Invalid value")),
            "type": str(error.get("type", "value_error")),
        }
        for error in errors
    ]


# --- Staff authentication -----------------------------------------------------------------


def _validate_email_shape(value: str) -> str:
    stripped = value.strip()
    if "@" not in stripped or " " in stripped or stripped.startswith("@") or stripped.endswith("@"):
        raise ValueError("email is not a valid address")
    return stripped


class SignupRequest(ApiModel):
    email: Annotated[str, Field(min_length=3, max_length=320)]
    password: Annotated[str, Field(min_length=12, max_length=128)]

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email_shape(value)


class LoginRequest(ApiModel):
    email: Annotated[str, Field(min_length=3, max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=128)]

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email_shape(value)


class StaffUserResponse(ApiModel):
    user_id: str
    name: str | None = None
    email: str
    business_id: str | None
    # Every business this account is linked to -- business_id above is just
    # the active one (a member of this list, or null when the list is
    # empty). An account may own more than one business.
    business_ids: list[str] = []


class UpdateStaffProfileRequest(ApiModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized


class SessionResponse(ApiModel):
    token: str
    expires_in_hours: int
    user: StaffUserResponse


class TwoFactorLoginChallengeResponse(ApiModel):
    two_factor_required: bool = True
    challenge_token: str
    expires_in_minutes: int


class ForgotPasswordRequest(ApiModel):
    email: Annotated[str, Field(min_length=3, max_length=320)]

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email_shape(value)


class ResetPasswordRequest(ApiModel):
    token: Annotated[str, Field(min_length=20, max_length=256)]
    password: Annotated[str, Field(min_length=12, max_length=128)]


class ChangePasswordRequest(ApiModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=12, max_length=128)]


class CurrentPasswordRequest(ApiModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]


class TwoFactorCodeRequest(ApiModel):
    code: Annotated[str, Field(min_length=4, max_length=32)]


class PasswordAndTwoFactorRequest(ApiModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    code: Annotated[str, Field(min_length=4, max_length=32)]


class TwoFactorSetupResponse(ApiModel):
    secret: str
    provisioning_uri: str
    expires_in_minutes: int


class RecoveryCodesResponse(ApiModel):
    codes: list[str]


class SecurityStatusResponse(ApiModel):
    two_factor_enabled: bool
    recovery_codes_remaining: int


class SecuritySessionResponse(ApiModel):
    session_id: str
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    current: bool


class SecurityAuditEventResponse(ApiModel):
    event_id: str
    event_type: str
    created_at: datetime
    metadata: dict[str, object]


# --- Self-serve business onboarding -------------------------------------------------------


class OnboardingServiceRequest(ApiModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    # Optional plain-language description of this service. Used to resolve a
    # customer's own wording onto this service without configured synonyms.
    description: Annotated[str, Field(max_length=500)] = ""
    questions: Annotated[list[Annotated[str, Field(min_length=1, max_length=300)]], Field(max_length=20)] = []


class OnboardingRequest(ApiModel):
    business_name: Annotated[str, Field(min_length=1, max_length=255)]
    # No longer defaulted to a specific vertical -- the wizard now requires the
    # owner to type their own industry (any business, not just home services).
    industry: Annotated[str, Field(min_length=1, max_length=120)]
    # Optional plain-language description of what the business does. With
    # `industry`, this is the only per-business adaptation the intent prompt
    # receives (see src/ai/adapters.py::_business_context).
    description: Annotated[str, Field(max_length=1000)] = ""
    tone: Annotated[str, Field(min_length=1, max_length=60)] = "Friendly & direct"
    services: Annotated[list[OnboardingServiceRequest], Field(min_length=1, max_length=50)]
    # Empty means "no fixed service area" (a remote/nationwide business) -- see
    # build_business_dna, which maps that to a `remote` service area instead of
    # `postal_codes`. Only required when enforce_service_area is true.
    service_zip_codes: Annotated[list[Annotated[str, Field(min_length=1, max_length=20)]], Field(max_length=500)] = []
    enforce_service_area: bool = True
    # Real Urgency-based triggers (see QualificationService.evaluate) -- replaces
    # the old onboarding wizard's three checkboxes, which were never actually
    # sent to the backend at all and had no effect on the created business.
    # Decision 2026-08-24 (claude/unit-economics-and-urgency-default.md,
    # variant C): escalate_on_high_urgency defaults False -- see
    # business_dna_builder.OnboardingInput for why.
    escalate_on_high_urgency: bool = False
    escalate_on_emergency: bool = True

    @field_validator("service_zip_codes")
    @classmethod
    def validate_zip_codes(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        # De-duplicate while preserving order.
        seen: set[str] = set()
        unique = []
        for item in cleaned:
            if item not in seen:
                seen.add(item)
                unique.append(item)
        return unique

    @model_validator(mode="after")
    def require_zip_codes_when_area_is_enforced(self) -> "OnboardingRequest":
        if self.enforce_service_area and not self.service_zip_codes:
            raise ValueError("at least one service zip code is required when a service area is enforced")
        return self


def _widget_embed_snippet(business_id: str, *, api_base: str | None) -> str:
    """The exact <script> tag a business owner pastes into their own website
    to mount the customer-facing chat widget (web/widget/widget.js -- served
    by this same backend at /widget/widget.js, not by the business's site).
    Shared by BusinessCreatedResponse (shown once right after onboarding) and
    BusinessDNASettingsResponse (available any time from Settings -> Basics),
    so the two never drift apart.

    The script src is deliberately absolute (this deployment's own origin),
    not relative -- a relative "/widget/widget.js" resolves against whatever
    page it's pasted into, so on the business's *own* site it would 404
    instead of loading the widget. data-api-base is included for clarity
    even though widget.js would derive the same origin from an absolute
    script src on its own.
    """
    src = f"{api_base}/widget/widget.js" if api_base else "/widget/widget.js"
    base_attr = f' data-api-base="{api_base}"' if api_base else ""
    return f'<script src="{src}" data-business-id="{business_id}"{base_attr}></script>'


class BusinessCreatedResponse(ApiModel):
    business_id: str
    name: str
    widget_snippet: str

    @classmethod
    def from_domain(cls, business: Business, *, api_base: str | None = None) -> "BusinessCreatedResponse":
        snippet = _widget_embed_snippet(business.business_id, api_base=api_base)
        return cls(business_id=business.business_id, name=business.name, widget_snippet=snippet)


class OwnedBusinessResponse(ApiModel):
    """One entry in the authenticated account's list of businesses -- powers
    the dashboard's business switcher."""

    business_id: str
    name: str


# --- Staff dashboard: real cases, conversations, and audit trail --------------------------


class DashboardLeadSchema(ApiModel):
    lead_id: str
    name: str | None
    email: str | None
    phone: str | None

    @classmethod
    def from_domain(cls, lead: Lead) -> "DashboardLeadSchema":
        return cls(lead_id=lead.lead_id, name=lead.name, email=lead.email, phone=lead.phone)


class DashboardCaseSummarySchema(ApiModel):
    case_id: str
    lead: DashboardLeadSchema
    current_state: ProcessState
    created_at: datetime
    updated_at: datetime
    event_count: int
    latest_event_type: str | None
    category: str | None = None
    escalation_reason: str | None = None
    is_test: bool = False

    @staticmethod
    def escalation_reason_from_domain(case: ProcessCase) -> str | None:
        if case.current_state is not ProcessState.NEEDS_HUMAN:
            return None
        explicit = next(
            (
                value
                for event in reversed(case.event_history)
                if event.event_type == "QUALIFICATION_EVALUATED"
                and isinstance((value := event.payload.get("escalation_reason")), str)
                and value
            ),
            None,
        )
        if explicit is not None:
            return explicit

        # Older cases predate the explicit reason field. Reconstruct a safe
        # staff-facing category from validated audit fields, never raw text.
        qualification = next(
            (
                event for event in reversed(case.event_history)
                if event.event_type == "QUALIFICATION_EVALUATED"
                and event.payload.get("requires_human") is True
            ),
            None,
        )
        if qualification is None:
            return "already_pending"
        # DELIBERATELY FROZEN LITERALS -- do not "tidy" these into imports of
        # the live reason constants (OUT_OF_SERVICE_AREA_REASON and friends).
        # These substrings are matched against reason text that was WRITTEN TO
        # EVENT HISTORY IN THE PAST. Stored events never change, so this
        # matcher has to keep speaking the vocabulary of the day the event was
        # written. Coupling it to today's constants would look tidier and
        # would silently stop recognising old cases the moment anyone reworded
        # a reason -- the failure would be invisible, because the fallback
        # below quietly returns "ai_review" instead of raising.
        #
        # New cases do not come through here at all: they carry an explicit
        # escalation_reason, handled above. This branch exists only for cases
        # created before that field did.
        reasons = " ".join(
            str(value) for value in qualification.payload.get("reasons", ())
        ).casefold()
        if "contact identity" in reasons:
            return "identity_conflict"
        if "service area" in reasons:
            return "service_area_uncertain"
        if "configured qualification policy" in reasons:
            return "policy_review"
        if "already awaiting" in reasons:
            return "already_pending"
        intent = next(
            (
                event for event in reversed(case.event_history)
                if event.event_type == "INTENT_EXTRACTED"
            ),
            None,
        )
        if intent is None:
            return "ai_review"
        urgency = intent.payload.get("urgency")
        if urgency == "emergency":
            return "safety_emergency"
        if urgency == "high":
            return "urgent_request"
        confidence = intent.payload.get("confidence")
        if isinstance(confidence, int | float) and confidence < 0.8:
            return "low_confidence"
        if intent.payload.get("service_requested") is None:
            return "service_unclear"
        return "ai_review"

    @classmethod
    def from_domain(
        cls,
        case: ProcessCase,
        *,
        service_names: Mapping[str, str] | None = None,
    ) -> "DashboardCaseSummarySchema":
        latest = case.event_history[-1] if case.event_history else None
        service_id = next(
            (
                value
                for event in reversed(case.event_history)
                if isinstance((value := event.payload.get("service_id")), str) and value
            ),
            None,
        )
        category = None
        if service_id is not None:
            category = (service_names or {}).get(service_id, service_id.replace("-", " ").title())
        return cls(
            case_id=case.case_id,
            lead=DashboardLeadSchema.from_domain(case.lead),
            current_state=case.current_state,
            created_at=case.created_at,
            updated_at=case.updated_at,
            event_count=len(case.event_history),
            latest_event_type=str(latest.event_type) if latest else None,
            category=category,
            escalation_reason=cls.escalation_reason_from_domain(case),
            is_test=case.is_test,
        )


class DashboardCaseListResponse(ApiModel):
    cases: tuple[DashboardCaseSummarySchema, ...]


class DashboardAppointmentSchema(ApiModel):
    booking_id: str
    case_id: str
    lead: DashboardLeadSchema
    service_id: str
    service_name: str | None
    start_at: datetime
    end_at: datetime
    timezone: str
    status: str


class DashboardWaitingSchema(ApiModel):
    """A QUALIFIED person with no calendar hour yet — operational tail, not a funnel."""

    case_id: str
    lead: DashboardLeadSchema
    service_id: str | None
    service_name: str | None
    waiting_channel: str | None
    updated_at: datetime


class DashboardAppointmentListResponse(ApiModel):
    day: date
    timezone: str
    appointments: tuple[DashboardAppointmentSchema, ...]
    waiting: tuple[DashboardWaitingSchema, ...] = ()


class DashboardAnalyticsSchema(ApiModel):
    total_cases: int
    booked_cases: int
    escalated_cases: int
    lost_cases: int
    booking_conversion_rate: float
    escalation_rate: float
    lost_rate: float
    median_first_response_seconds: float | None
    response_samples: int
    escalation_reasons: dict[str, int]
    escalation_feedback: dict[str, int]
    hidden_test_cases: int
    hidden_test_conversations: int
    includes_test_data: bool
    stats_since: datetime | None
    period_start: datetime | None
    period_end: datetime | None


class ReportingSettingsSchema(ApiModel):
    test_mode_enabled: bool
    stats_since: datetime | None

    @classmethod
    def from_domain(cls, business: Business) -> "ReportingSettingsSchema":
        return cls(
            test_mode_enabled=business.test_mode_enabled,
            stats_since=business.stats_since,
        )


class ReportingSettingsUpdateRequest(ApiModel):
    test_mode_enabled: bool | None = None
    reset_statistics: bool = False
    clear_statistics_baseline: bool = False

    @model_validator(mode="after")
    def validate_requested_change(self) -> "ReportingSettingsUpdateRequest":
        if self.reset_statistics and self.clear_statistics_baseline:
            raise ValueError("reset_statistics and clear_statistics_baseline cannot both be true")
        if self.test_mode_enabled is None and not self.reset_statistics and not self.clear_statistics_baseline:
            raise ValueError("at least one reporting setting must be changed")
        return self


def _jsonable(value: Any) -> Any:
    """Recursively unwrap the immutable containers `ProcessEvent.payload` is
    frozen into (see `_freeze` in src/domain/models.py). `dict(event.payload)`
    alone only unwraps the top level -- any nested dict/list/set value stays a
    MappingProxyType/frozenset/tuple, and pydantic-core's JSON serializer
    can't encode a MappingProxyType, so any event with a nested payload value
    (e.g. DECISION_RECORDED's "metadata") 500s the dashboard case-detail
    endpoint without this."""
    if isinstance(value, Mapping):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, set | frozenset):
        return [_jsonable(item) for item in value]
    return value


class DashboardEventSchema(ApiModel):
    event_id: str
    event_type: str
    source: str
    occurred_at: datetime
    payload: dict[str, Any]

    @classmethod
    def from_domain(cls, event: ProcessEvent) -> "DashboardEventSchema":
        return cls(
            event_id=event.event_id,
            event_type=str(event.event_type),
            source=event.source,
            occurred_at=event.occurred_at,
            payload=_jsonable(event.payload),
        )


class DashboardCaseDetailResponse(ApiModel):
    case_id: str
    lead: DashboardLeadSchema
    current_state: ProcessState
    created_at: datetime
    updated_at: datetime
    events: tuple[DashboardEventSchema, ...]
    escalation_reason: str | None = None

    @classmethod
    def from_domain(cls, case: ProcessCase) -> "DashboardCaseDetailResponse":
        return cls(
            case_id=case.case_id,
            lead=DashboardLeadSchema.from_domain(case.lead),
            current_state=case.current_state,
            created_at=case.created_at,
            updated_at=case.updated_at,
            events=tuple(DashboardEventSchema.from_domain(event) for event in case.event_history),
            escalation_reason=DashboardCaseSummarySchema.escalation_reason_from_domain(case),
        )


class DashboardConversationSchema(ApiModel):
    conversation_id: str
    case_id: str | None
    lead_id: str | None
    lead_name: str | None
    lead_phone: str | None = None
    lead_email: str | None = None
    case_state: ProcessState | None
    channel: str
    status: ConversationStatus
    created_at: datetime
    last_activity_at: datetime
    escalation_reason: str | None = None

    @classmethod
    def from_domain(
        cls,
        conversation: Conversation,
        *,
        lead_name: str | None = None,
        lead_phone: str | None = None,
        lead_email: str | None = None,
        case_state: ProcessState | None = None,
        escalation_reason: str | None = None,
    ) -> "DashboardConversationSchema":
        return cls(
            conversation_id=conversation.conversation_id,
            case_id=conversation.case_id,
            lead_id=conversation.lead_id,
            lead_name=lead_name,
            lead_phone=lead_phone,
            lead_email=lead_email,
            case_state=case_state,
            channel=conversation.channel,
            status=conversation.status,
            created_at=conversation.created_at,
            last_activity_at=conversation.last_activity_at,
            escalation_reason=escalation_reason,
        )


class DashboardConversationListResponse(ApiModel):
    conversations: tuple[DashboardConversationSchema, ...]


class DashboardMessageSchema(ApiModel):
    message_id: str
    direction: MessageDirection
    role: MessageRole
    text: str
    created_at: datetime


class DashboardConversationDetailResponse(ApiModel):
    conversation: DashboardConversationSchema
    messages: tuple[DashboardMessageSchema, ...]


class StaffReplyRequest(ApiModel):
    message: Annotated[str, Field(min_length=1, max_length=10_000)]


class EscalationFeedbackRequest(ApiModel):
    outcome: Literal[
        "unnecessary",
        "missed",
        "wrong_service",
        "identity_same_customer",
        "identity_different_customer",
    ]


class StaffActionResponse(ApiModel):
    conversation: DashboardConversationSchema
    case: DashboardCaseSummarySchema | None


class SalesPlaybookSchema(ApiModel):
    business_id: str
    version: int
    status: SalesPlaybookStatus
    configuration: dict[str, Any]
    created_at: datetime
    published_at: datetime | None

    @classmethod
    def from_domain(cls, value: SalesPlaybookVersion) -> "SalesPlaybookSchema":
        return cls(
            business_id=value.business_id,
            version=value.version,
            status=value.status,
            configuration=_jsonable(value.configuration),
            created_at=value.created_at,
            published_at=value.published_at,
        )


class SalesPlaybookListResponse(ApiModel):
    playbooks: tuple[SalesPlaybookSchema, ...]


class SalesKnowledgeCardSchema(ApiModel):
    knowledge_id: str
    business_id: str
    version: int
    status: SalesKnowledgeStatus
    source: dict[str, Any]
    principle: str
    applicable_when: tuple[str, ...]
    prohibited_when: tuple[str, ...]
    required_sequence: tuple[str, ...]
    forbidden_actions: tuple[str, ...]
    approved_examples: tuple[str, ...]
    created_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: str | None

    @classmethod
    def from_domain(cls, value: SalesKnowledgeCard) -> "SalesKnowledgeCardSchema":
        return cls(
            knowledge_id=value.knowledge_id,
            business_id=value.business_id,
            version=value.version,
            status=value.status,
            source=_jsonable(value.source),
            principle=value.principle,
            applicable_when=value.applicable_when,
            prohibited_when=value.prohibited_when,
            required_sequence=value.required_sequence,
            forbidden_actions=value.forbidden_actions,
            approved_examples=value.approved_examples,
            created_at=value.created_at,
            reviewed_at=value.reviewed_at,
            reviewed_by=value.reviewed_by,
        )


class SalesKnowledgeCardListResponse(ApiModel):
    cards: tuple[SalesKnowledgeCardSchema, ...]


class SalesObjectionRecordSchema(ApiModel):
    objection_id: str
    objection_type: str
    status: str
    cause: str | None
    source_message_id: str
    evidence_excerpt: str
    created_at: datetime
    updated_at: datetime
    version: int

    @classmethod
    def from_domain(cls, value: SalesObjectionRecord) -> "SalesObjectionRecordSchema":
        return cls(
            objection_id=value.objection_id,
            objection_type=value.objection.objection_type.value,
            status=value.objection.status.value,
            cause=value.objection.cause,
            source_message_id=value.objection.evidence.source_message_id,
            evidence_excerpt=value.objection.evidence.excerpt,
            created_at=value.created_at,
            updated_at=value.updated_at,
            version=value.version,
        )


class SalesCaseContextResponse(ApiModel):
    case_id: str
    stage: SalesStage
    customer_goal: str | None
    current_problem: str | None
    desired_outcome: str | None
    decision_criteria: tuple[str, ...]
    commitment_level: str
    preferred_channel: str | None
    preferred_contact_at: datetime | None
    last_move: SalesMove | None
    next_approved_action: SalesMove
    next_action_reason: str
    requires_human: bool
    human_review_reason: str | None
    version: int
    objections: tuple[SalesObjectionRecordSchema, ...]


class SalesEvidenceSchema(ApiModel):
    source_message_id: str
    excerpt: str


class SalesTurnSchema(ApiModel):
    turn_id: str
    conversation_id: str | None
    source_message_id: str
    playbook_version: int | None
    stage_before: SalesStage
    stage_after: SalesStage
    move: SalesMove
    reason_code: str
    knowledge_ids: tuple[str, ...]
    business_fact_ids: tuple[str, ...]
    customer_evidence: tuple[SalesEvidenceSchema, ...]
    analysis: dict[str, Any]
    validation: dict[str, Any]
    created_at: datetime

    @classmethod
    def from_domain(cls, value: SalesTurn) -> "SalesTurnSchema":
        return cls(
            turn_id=value.turn_id,
            conversation_id=value.conversation_id,
            source_message_id=value.source_message_id,
            playbook_version=value.playbook_version,
            stage_before=value.stage_before,
            stage_after=value.stage_after,
            move=value.move,
            reason_code=value.reason_code,
            knowledge_ids=value.knowledge_ids,
            business_fact_ids=value.business_fact_ids,
            customer_evidence=tuple(
                SalesEvidenceSchema(source_message_id=item.source_message_id, excerpt=item.excerpt)
                for item in value.customer_evidence
            ),
            analysis=_jsonable(value.analysis),
            validation=_jsonable(value.validation),
            created_at=value.created_at,
        )


class SalesTurnListResponse(ApiModel):
    turns: tuple[SalesTurnSchema, ...]


# fulfillment_type (Business DNA) <-> commercial_path (Settings) -- see
# BusinessDNASettingsService._COMMERCIAL_PATHS and CommercialPathSelector
# (src/engine/commercial.py) for what each path means at runtime.
_FULFILLMENT_TO_COMMERCIAL_PATH = {
    "bookable": "booking",
    "quote_required": "quote",
    "direct_sale": "direct_step",
    "human_review": "human_review",
}


class BusinessDNAServiceSchema(ApiModel):
    id: str
    name: str
    description: str = ""
    questions: tuple[str, ...]
    commercial_path: str
    # Only populated when commercial_path == "quote" and the underlying
    # quoting.pricing_type is "fixed" -- Settings only ever writes fixed-price
    # quotes (see BusinessDNASettingsService._apply), so a quote_required
    # service configured with a richer pricing_type elsewhere shows an empty
    # price here rather than a wrong one; re-saving it from Settings would
    # require entering a fixed price, which then replaces the richer config.
    quote_price: str | None = None
    next_step_message: str | None = None
    intake_keywords: tuple[str, ...] = ()

    @classmethod
    def from_domain(cls, service: Mapping[str, Any]) -> "BusinessDNAServiceSchema":
        fulfillment_type = service.get("fulfillment_type")
        commercial_path = _FULFILLMENT_TO_COMMERCIAL_PATH.get(fulfillment_type, "human_review")
        quoting = service.get("quoting") if isinstance(service.get("quoting"), Mapping) else None
        quote_price = None
        if commercial_path == "quote" and quoting is not None and quoting.get("pricing_type") == "fixed":
            fixed_price = quoting.get("fixed_price")
            quote_price = str(fixed_price) if fixed_price is not None else None
        next_step_message = None
        if commercial_path == "direct_step" and service.get("direct_next_step_message") is not None:
            next_step_message = str(service["direct_next_step_message"])
        name = str(service["name"])
        extras = tuple(
            str(keyword)
            for keyword in service.get("intake_keywords", [])
            if isinstance(keyword, str) and keyword.strip() and keyword.strip().casefold() != name.casefold()
        )
        return cls(
            id=str(service["id"]),
            name=name,
            description=str(service.get("description") or ""),
            questions=tuple(str(q["prompt"]) for q in service.get("qualification_questions", [])),
            commercial_path=commercial_path,
            quote_price=quote_price,
            next_step_message=next_step_message,
            intake_keywords=extras,
        )


class BusinessHoursWindowSchema(ApiModel):
    opens: Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]
    closes: Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


class ObjectionResponseSchema(ApiModel):
    """One owner-authored {objection, pre-approved response} pair -- see
    qualification.objection_responses in the Business DNA schema. The AI is
    only ever allowed to select and rephrase one of these entries, never
    invent its own."""

    trigger_description: str
    approved_response: str

    @classmethod
    def from_domain(cls, entry: Mapping[str, Any]) -> "ObjectionResponseSchema":
        return cls(
            trigger_description=str(entry.get("trigger_description", "")),
            approved_response=str(entry.get("approved_response", "")),
        )


class BusinessDNASettingsResponse(ApiModel):
    version: int
    updated_at: datetime
    name: str
    industry: str
    tone: str
    services: tuple[BusinessDNAServiceSchema, ...]
    service_zip_codes: tuple[str, ...]
    escalate_on_high_urgency: bool
    escalate_on_emergency: bool
    booking_enabled: bool
    booking_timezone: str
    business_hours: dict[str, tuple[BusinessHoursWindowSchema, ...]]
    objection_responses: tuple[ObjectionResponseSchema, ...] = ()
    widget_snippet: str = ""
    compliance_disclaimer: str = ""
    ai_disclosure_text: str = ""

    @classmethod
    def from_domain(cls, dna: BusinessDNAVersion, *, api_base: str | None = None) -> "BusinessDNASettingsResponse":
        config = dna.configuration
        primary_area = next(
            (area for area in config["service_areas"] if area["id"] == "primary"),
            None,
        )
        # A `remote` area's `values` is a placeholder (["everywhere"]), never real
        # zip codes -- report an empty list rather than leak that placeholder into
        # the UI as if it were a configured zip code. Settings.tsx treats an empty
        # list as "no fixed area" (see AreaOption / areaMode), matching how the
        # onboarding wizard represents the same choice.
        zips = (
            tuple(str(value) for value in primary_area["values"])
            if primary_area is not None and primary_area["type"] == "postal_codes"
            else ()
        )
        triggers = set(config["human_escalation"]["triggers"])
        booking = config.get("booking", {})
        business_hours = {
            str(day): tuple(
                BusinessHoursWindowSchema(opens=str(window["opens"]), closes=str(window["closes"]))
                for window in windows
            )
            for day, windows in config.get("business_hours", {}).items()
        }
        return cls(
            version=dna.version,
            updated_at=dna.created_at,
            name=str(config["business"]["name"]),
            industry=str(config["business"]["industry"]),
            tone=str(config["communication"]["tone"]),
            services=tuple(BusinessDNAServiceSchema.from_domain(service) for service in config["services"]),
            service_zip_codes=zips,
            escalate_on_high_urgency="high" in triggers,
            escalate_on_emergency="emergency" in triggers,
            booking_enabled=bool(booking.get("enabled", False)),
            booking_timezone=str(booking.get("timezone", "UTC")),
            business_hours=business_hours,
            objection_responses=tuple(
                ObjectionResponseSchema.from_domain(entry)
                for entry in config["qualification"].get("objection_responses", [])
                if isinstance(entry, Mapping)
            ),
            widget_snippet=_widget_embed_snippet(dna.business_id, api_base=api_base),
            compliance_disclaimer=str(config.get("communication", {}).get("compliance_disclaimer", "") or ""),
            ai_disclosure_text=str(config.get("chat_widget", {}).get("ai_disclosure_text", "") or ""),
        )


class BusinessDNAServiceUpdateSchema(ApiModel):
    id: Annotated[str | None, Field(min_length=1, max_length=128)] = None
    name: Annotated[str, Field(min_length=1, max_length=200)]
    # Optional; empty leaves an existing service's description untouched (and
    # falls back to the name for a newly added one) so a client that does not
    # send the field cannot silently wipe it.
    description: Annotated[str, Field(max_length=500)] = ""
    questions: Annotated[tuple[Annotated[str, Field(min_length=1, max_length=500)], ...], Field(max_length=20)] = ()
    # "booking" | "quote" | "direct_step" | "human_review" -- validated against
    # the actual recognized set in BusinessDNASettingsService.SettingsServiceInput.
    commercial_path: Annotated[str, Field(min_length=1, max_length=32)] = "human_review"
    quote_price: Annotated[str | None, Field(max_length=32)] = None
    next_step_message: Annotated[str | None, Field(max_length=1000)] = None
    intake_keywords: Annotated[tuple[Annotated[str, Field(min_length=1, max_length=80)], ...], Field(max_length=30)] = ()


class ObjectionResponseUpdateSchema(ApiModel):
    trigger_description: Annotated[str, Field(min_length=1, max_length=300)]
    approved_response: Annotated[str, Field(min_length=1, max_length=800)]


class BusinessDNASettingsUpdateRequest(ApiModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    industry: Annotated[str, Field(min_length=1, max_length=200)]
    tone: Annotated[str, Field(min_length=1, max_length=500)]
    services: Annotated[tuple[BusinessDNAServiceUpdateSchema, ...], Field(min_length=1, max_length=50)]
    # Empty means "no fixed service area" (a remote/nationwide business) -- see
    # BusinessDNASettingsService._apply, which maps that to a `remote` service
    # area and turns off service-area enforcement, same convention as onboarding.
    service_zip_codes: Annotated[
        tuple[Annotated[str, Field(min_length=1, max_length=32)], ...], Field(max_length=500)
    ] = ()
    escalate_on_high_urgency: bool
    escalate_on_emergency: bool
    booking_enabled: bool = False
    booking_timezone: Annotated[str, Field(min_length=1, max_length=64)] = "UTC"
    # Empty means "leave business_hours as currently configured" -- see
    # BusinessDNASettingsService._apply.
    business_hours: dict[str, tuple[BusinessHoursWindowSchema, ...]] = Field(default_factory=dict)
    # Empty turns the reassurance-response feature off -- see SettingsUpdate.
    # Settings fully owns this list once saved (unlike business_hours above),
    # so an empty submission here genuinely clears any previously configured
    # entries rather than leaving them untouched.
    objection_responses: Annotated[tuple[ObjectionResponseUpdateSchema, ...], Field(max_length=50)] = ()
    compliance_disclaimer: Annotated[str, Field(max_length=1000)] = ""
    ai_disclosure_text: Annotated[str, Field(max_length=200)] = ""
