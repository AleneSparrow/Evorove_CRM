"""Persistence protocols; domain and engine code contain no SQL."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Mapping, Protocol, Sequence

from src.domain.auth import StaffSession, StaffUser
from src.domain.models import Lead, ProcessCase, ProcessEvent
from src.domain.conversations import Conversation, ConversationMessage
from src.domain.commercial import Booking, PaymentRequest, PaymentType, Quote
from src.domain.states import ProcessState
from src.domain.sales import (
    CustomerSalesProfile, SalesKnowledgeCard, SalesKnowledgeStatus, SalesObjectionRecord,
    SalesPlaybookVersion, SalesTurn,
)
from src.domain.tenancy import Business, BusinessDNAVersion


class ClaimStatus(StrEnum):
    CLAIMED = "CLAIMED"
    COMPLETED = "COMPLETED"


@dataclass(frozen=True, slots=True)
class IdempotencyRecord:
    business_id: str
    channel: str
    external_message_id: str
    fingerprint: str
    case_id: str | None
    result: Mapping[str, Any] | None
    created_at: datetime


class DeliveryStatus(StrEnum):
    """State of one durable follow-up SMS delivery attempt -- see
    FollowUpDeliveryRepository / PersistentFollowUpRunner._send_one."""

    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class FollowUpDeliveryAttempt:
    business_id: str
    case_id: str
    attempt_number: int
    status: DeliveryStatus
    message_text: str
    twilio_sid: str | None
    created_at: datetime
    updated_at: datetime


class BusinessRepository(Protocol):
    def add(self, business: Business) -> None: ...
    def get(self, business_id: str) -> Business | None: ...
    def get_by_payment_customer_id(self, payment_customer_id: str) -> Business | None: ...
    def get_by_payment_subscription_id(self, payment_subscription_id: str) -> Business | None: ...
    def list_all(self) -> tuple[Business, ...]:
        """Every tenant, unfiltered -- for platform-wide sweeps (currently
        just PersistentFollowUpRunner) rather than anything scoped to a
        single authenticated owner. No pagination yet: fine at today's
        business count, would need one before this becomes a bottleneck."""
        ...
    def update_billing(
        self,
        business_id: str,
        *,
        payment_customer_id: str | None,
        payment_subscription_id: str | None,
        plan: str | None,
        subscription_status: str,
        trial_ends_at: datetime | None,
        current_period_end: datetime | None,
        event_at: datetime | None = None,
    ) -> Business:
        """`event_at` is the webhook snapshot's own timestamp (see
        BillingService._event_timestamp). When it is older than the
        business's stored `billing_event_at` watermark, the update is
        skipped entirely (an out-of-order/delayed delivery must not
        resurrect a since-superseded billing state) and the business is
        returned unchanged. `None` applies only while no watermark exists;
        afterward it is rejected because it cannot prove its ordering."""
        ...
    def update_reporting_settings(
        self,
        business_id: str,
        *,
        test_mode_enabled: bool | None = None,
        stats_since: datetime | None = None,
        clear_stats_since: bool = False,
    ) -> Business: ...


class BusinessDNARepository(Protocol):
    def add_version(self, business_id: str, configuration: Mapping[str, Any]) -> BusinessDNAVersion: ...
    def get_active(self, business_id: str) -> BusinessDNAVersion | None: ...
    def list_versions(self, business_id: str) -> tuple[BusinessDNAVersion, ...]: ...


class LeadRepository(Protocol):
    def lock_identity(
        self,
        business_id: str,
        identity_type: str,
        normalized_value: str,
    ) -> None: ...
    def add(self, business_id: str, lead: Lead, created_at: datetime) -> None: ...
    def save(self, business_id: str, lead: Lead, updated_at: datetime) -> None: ...
    def get(self, business_id: str, lead_id: str) -> Lead | None: ...
    def find_by_identity(
        self,
        business_id: str,
        normalized_phone: str | None,
        normalized_email: str | None,
    ) -> Lead | None: ...


class ProcessCaseRepository(Protocol):
    def add(self, case: ProcessCase) -> None: ...
    def get(
        self, business_id: str, case_id: str, *, for_update: bool = False
    ) -> ProcessCase | None: ...
    def find_active_for_lead(self, business_id: str, lead_id: str) -> ProcessCase | None: ...
    def save(self, case: ProcessCase, expected_version: int) -> None: ...
    def list_for_business(
        self,
        business_id: str,
        *,
        limit: int | None = 200,
        created_at_from: datetime | None = None,
        created_at_to: datetime | None = None,
        include_test: bool = True,
    ) -> tuple[ProcessCase, ...]: ...
    def list_by_state(
        self,
        business_id: str,
        states: Sequence[ProcessState],
        *,
        limit: int = 500,
    ) -> tuple[ProcessCase, ...]:
        """Oldest-updated-first, unlike list_for_business (most-recent-
        first) -- built for PersistentFollowUpRunner, where the cases that
        matter are exactly the ones NOT recently touched. Most-recent-first
        with a limit would silently starve genuinely stale cases out of the
        window on any business with more active cases than the limit."""
        ...


class ProcessEventRepository(Protocol):
    def add(self, business_id: str, case_id: str, event: ProcessEvent) -> None: ...
    def add_many(self, business_id: str, case_id: str, events: tuple[ProcessEvent, ...]) -> None: ...
    def list_for_case(self, business_id: str, case_id: str) -> tuple[ProcessEvent, ...]: ...


class SalesProfileRepository(Protocol):
    def add(self, profile: CustomerSalesProfile, *, now: datetime) -> None: ...
    def get(
        self, business_id: str, case_id: str, *, for_update: bool = False
    ) -> CustomerSalesProfile | None: ...
    def save(
        self, profile: CustomerSalesProfile, expected_version: int, *, now: datetime
    ) -> CustomerSalesProfile: ...


class SalesTurnRepository(Protocol):
    def add(self, turn: SalesTurn) -> None: ...
    def get_by_source_message(
        self, business_id: str, case_id: str, source_message_id: str
    ) -> SalesTurn | None: ...
    def list_for_case(self, business_id: str, case_id: str) -> tuple[SalesTurn, ...]: ...


class SalesKnowledgeRepository(Protocol):
    def add(self, card: SalesKnowledgeCard, *, now: datetime) -> None: ...
    def get(
        self, business_id: str, knowledge_id: str, version: int
    ) -> SalesKnowledgeCard | None: ...
    def list_approved(self, business_id: str) -> tuple[SalesKnowledgeCard, ...]: ...
    def list_for_business(
        self, business_id: str, *, status: SalesKnowledgeStatus | None = None
    ) -> tuple[SalesKnowledgeCard, ...]: ...
    def set_status(
        self,
        business_id: str,
        knowledge_id: str,
        version: int,
        *,
        status: SalesKnowledgeStatus,
        reviewed_at: datetime,
        reviewed_by: str,
    ) -> SalesKnowledgeCard | None: ...


class SalesPlaybookRepository(Protocol):
    def add(self, playbook: SalesPlaybookVersion) -> None: ...
    def get_active(self, business_id: str) -> SalesPlaybookVersion | None: ...
    def list_versions(self, business_id: str) -> tuple[SalesPlaybookVersion, ...]: ...


class SalesObjectionRepository(Protocol):
    def add(self, record: SalesObjectionRecord) -> None: ...
    def save(
        self, record: SalesObjectionRecord, expected_version: int
    ) -> SalesObjectionRecord: ...
    def list_for_case(
        self, business_id: str, case_id: str
    ) -> tuple[SalesObjectionRecord, ...]: ...


class IdempotencyRepository(Protocol):
    def claim(
        self,
        business_id: str,
        channel: str,
        external_message_id: str,
        fingerprint: str,
    ) -> tuple[ClaimStatus, IdempotencyRecord]: ...
    def complete(
        self,
        business_id: str,
        channel: str,
        external_message_id: str,
        case_id: str,
        result: Mapping[str, Any],
    ) -> None: ...
    def get(self, business_id: str, channel: str, external_message_id: str) -> IdempotencyRecord | None: ...


class ConversationRepository(Protocol):
    def lock_token_identity(self, business_id: str, token_hash: str) -> None: ...
    def lock_session_identity(self, business_id: str, channel: str, external_session_id: str) -> None: ...
    def add(self, conversation: Conversation) -> None: ...
    def get(self, business_id: str, conversation_id: str, *, for_update: bool = False) -> Conversation | None: ...
    def get_by_token_hash(self, business_id: str, token_hash: str, *, for_update: bool = False) -> Conversation | None: ...
    def get_by_channel_session(
        self,
        business_id: str,
        channel: str,
        external_session_id: str,
        *,
        for_update: bool = False,
    ) -> Conversation | None: ...
    def save(self, conversation: Conversation, expected_version: int) -> None: ...
    def list_for_business(self, business_id: str, *, limit: int = 200) -> tuple[Conversation, ...]: ...
    def list_for_case(self, business_id: str, case_id: str) -> tuple[Conversation, ...]: ...


class ConversationMessageRepository(Protocol):
    def add(self, message: ConversationMessage) -> None: ...
    def get_by_external_id(
        self, business_id: str, conversation_id: str, external_message_id: str
    ) -> ConversationMessage | None: ...
    def list_for_conversation(
        self, business_id: str, conversation_id: str, *, limit: int | None = None
    ) -> tuple[ConversationMessage, ...]: ...
    def next_sequence(self, business_id: str, conversation_id: str) -> int: ...


class BookingRepository(Protocol):
    def lock_slot(self, business_id: str, service_id: str, start_at: datetime) -> None: ...
    def add(self, booking: Booking) -> None: ...
    def get(self, business_id: str, booking_id: str, *, for_update: bool = False) -> Booking | None: ...
    def get_for_case(self, business_id: str, case_id: str, *, for_update: bool = False) -> Booking | None: ...
    def list_overlapping(
        self,
        business_id: str,
        service_id: str,
        start_at: datetime,
        end_at: datetime,
        *,
        exclude_booking_id: str | None = None,
    ) -> tuple[Booking, ...]: ...
    def list_starting_between(
        self,
        business_id: str,
        start_at: datetime,
        end_at: datetime,
    ) -> tuple[Booking, ...]: ...
    def save(self, booking: Booking, expected_version: int) -> None: ...


class QuoteRepository(Protocol):
    def add(self, quote: Quote) -> None: ...
    def get(self, business_id: str, quote_id: str, *, for_update: bool = False) -> Quote | None: ...
    def get_for_case(self, business_id: str, case_id: str, *, for_update: bool = False) -> Quote | None: ...
    def save(self, quote: Quote, expected_version: int) -> None: ...


class PaymentRequestRepository(Protocol):
    def add(self, payment_request: PaymentRequest) -> None: ...
    def get(
        self,
        business_id: str,
        payment_request_id: str,
        *,
        for_update: bool = False,
    ) -> PaymentRequest | None: ...
    def get_for_case_type(
        self,
        business_id: str,
        case_id: str,
        payment_type: PaymentType,
        *,
        for_update: bool = False,
    ) -> PaymentRequest | None: ...
    def save(self, payment_request: PaymentRequest, expected_version: int) -> None: ...


class CrmWebhookConnectionRepository(Protocol):
    def get_url(self, business_id: str) -> str | None: ...
    def upsert(self, business_id: str, webhook_url: str, *, now: datetime) -> None: ...
    def delete(self, business_id: str) -> None: ...


class SmsConnectionRepository(Protocol):
    def get_by_business(self, business_id: str) -> tuple[str, str] | None:
        """Returns (phone_number, twilio_phone_sid) if the business has a
        provisioned number, else None."""
        ...

    def get_business_id_by_phone(self, phone_number: str) -> str | None: ...

    def add(
        self, business_id: str, phone_number: str, twilio_phone_sid: str, *, now: datetime
    ) -> None: ...


class BillingWebhookEventRepository(Protocol):
    def claim(self, event_fingerprint: str, event_name: str, *, now: datetime) -> bool:
        """Atomically records that this exact webhook delivery (identified
        by a fingerprint of its raw payload bytes) is being processed.
        Returns True the first time a given fingerprint is seen (the caller
        should apply it), False if it was already recorded -- Lemon
        Squeezy resends a retried delivery with identical bytes, so a
        repeat hashes to the same fingerprint and must be treated as a
        no-op, never reapplied."""
        ...


class FollowUpDeliveryRepository(Protocol):
    def claim_attempt(
        self,
        business_id: str,
        case_id: str,
        attempt_number: int,
        *,
        message_text: str,
        now: datetime,
    ) -> tuple[FollowUpDeliveryAttempt, bool]:
        """Atomically get-or-creates the delivery-attempt row for this
        (business_id, case_id, attempt_number) -- the durable outbox
        "intent" record, written *before* Twilio is ever called. Returns
        `(attempt, owns_send)`.

        `owns_send` is True only for the caller that should actually call
        Twilio: either it just created the row (first-ever claim), or an
        existing PENDING row is older than the abandoned-attempt grace
        period (the process that claimed it crashed before recording any
        outcome) and this call is taking over. Every other caller --
        concurrent claims racing the winner, or a PENDING row still within
        its grace period -- gets `owns_send=False` and MUST NOT send;
        `attempt.status` tells it what to do instead: SENT/FAILED means the
        attempt already has a final outcome (finish the case update, don't
        resend), PENDING-but-not-owned means another process is (or very
        recently was) actively handling it (back off, try again later)."""
        ...

    def mark_result(
        self,
        business_id: str,
        case_id: str,
        attempt_number: int,
        *,
        sent: bool,
        twilio_sid: str | None,
        now: datetime,
    ) -> None: ...


class StaffUserRepository(Protocol):
    def add(self, user: StaffUser) -> None: ...
    def get(self, user_id: str) -> StaffUser | None: ...
    def get_by_email(self, normalized_email: str, *, for_update: bool = False) -> StaffUser | None: ...
    def save(self, user: StaffUser) -> None: ...


class StaffSessionRepository(Protocol):
    def add(self, session: StaffSession) -> None: ...
    def get(self, session_id: str) -> StaffSession | None: ...
    def get_by_token_hash(self, token_hash: str) -> StaffSession | None: ...
    def list_for_user(self, user_id: str) -> tuple[StaffSession, ...]: ...
    def revoke(self, session_id: str, revoked_at: datetime) -> None: ...
    def revoke_all_for_user(self, user_id: str, revoked_at: datetime, *, except_session_id: str | None = None) -> int: ...


@dataclass(frozen=True, slots=True)
class SecurityCredentials:
    user_id: str
    totp_secret_encrypted: str | None
    pending_totp_secret_encrypted: str | None
    pending_expires_at: datetime | None
    two_factor_enabled_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PasswordResetRecord:
    reset_id: str
    user_id: str
    token_hash: str
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None


@dataclass(frozen=True, slots=True)
class LoginChallenge:
    challenge_id: str
    user_id: str
    token_hash: str
    created_at: datetime
    expires_at: datetime
    consumed_at: datetime | None


@dataclass(frozen=True, slots=True)
class RecoveryCode:
    recovery_code_id: str
    user_id: str
    code_hash: str
    created_at: datetime
    used_at: datetime | None


@dataclass(frozen=True, slots=True)
class SecurityAuditEvent:
    event_id: str
    user_id: str
    event_type: str
    created_at: datetime
    metadata: Mapping[str, Any]


class StaffSecurityRepository(Protocol):
    def get_credentials(self, user_id: str, *, for_update: bool = False) -> SecurityCredentials | None: ...
    def save_credentials(self, value: SecurityCredentials) -> None: ...
    def add_reset(self, value: PasswordResetRecord) -> None: ...
    def get_reset_by_hash(self, token_hash: str, *, for_update: bool = False) -> PasswordResetRecord | None: ...
    def invalidate_resets(self, user_id: str, now: datetime) -> None: ...
    def mark_reset_used(self, reset_id: str, now: datetime) -> None: ...
    def add_login_challenge(self, value: LoginChallenge) -> None: ...
    def get_login_challenge_by_hash(self, token_hash: str, *, for_update: bool = False) -> LoginChallenge | None: ...
    def consume_login_challenge(self, challenge_id: str, now: datetime) -> None: ...
    def invalidate_login_challenges(self, user_id: str, now: datetime) -> None: ...
    def replace_recovery_codes(self, user_id: str, values: tuple[RecoveryCode, ...]) -> None: ...
    def get_recovery_code(self, user_id: str, code_hash: str, *, for_update: bool = False) -> RecoveryCode | None: ...
    def use_recovery_code(self, recovery_code_id: str, now: datetime) -> None: ...
    def list_recovery_codes(self, user_id: str) -> tuple[RecoveryCode, ...]: ...
    def add_audit_event(self, value: SecurityAuditEvent) -> None: ...
    def list_audit_events(self, user_id: str, *, limit: int = 100) -> tuple[SecurityAuditEvent, ...]: ...


class UnitOfWork(Protocol):
    businesses: BusinessRepository
    business_dna: BusinessDNARepository
    leads: LeadRepository
    cases: ProcessCaseRepository
    events: ProcessEventRepository
    idempotency: IdempotencyRepository
    conversations: ConversationRepository
    conversation_messages: ConversationMessageRepository
    bookings: BookingRepository
    quotes: QuoteRepository
    payment_requests: PaymentRequestRepository
    staff_users: StaffUserRepository
    staff_sessions: StaffSessionRepository
    staff_security: StaffSecurityRepository
    crm_webhook_connections: CrmWebhookConnectionRepository
    sms_connections: SmsConnectionRepository
    billing_webhook_events: BillingWebhookEventRepository
    follow_up_deliveries: FollowUpDeliveryRepository
    sales_profiles: SalesProfileRepository
    sales_turns: SalesTurnRepository
    sales_knowledge: SalesKnowledgeRepository
    sales_playbooks: SalesPlaybookRepository
    sales_objections: SalesObjectionRepository

    def __enter__(self) -> "UnitOfWork": ...
    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


class UnitOfWorkFactory(Protocol):
    def __call__(self) -> UnitOfWork: ...
