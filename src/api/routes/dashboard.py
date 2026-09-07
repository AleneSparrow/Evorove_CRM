"""Staff-facing dashboard API: tomorrow's appointments, then cases and conversations.

The evening screen is booked hours, not a funnel of people to close.
Every endpoint is scoped to the authenticated staff user's own business.
"""

from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from statistics import median
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, status

from src.domain.auth import StaffUser
from src.domain.models import utc_now
from src.domain.states import ProcessState
from src.persistence.staff_action_service import StaffActionService

from ..dependencies import (
    BusinessIdPath,
    UnitOfWorkFactory,
    get_staff_action_service,
    get_unit_of_work_factory,
    require_active_subscription,
    require_own_business,
)
from ..errors import RequestDataError, ResourceNotFoundError
from ..schemas import (
    DashboardAppointmentListResponse,
    DashboardAppointmentSchema,
    DashboardWaitingSchema,
    DashboardCaseDetailResponse,
    DashboardCaseListResponse,
    DashboardCaseSummarySchema,
    DashboardAnalyticsSchema,
    DashboardConversationDetailResponse,
    DashboardConversationListResponse,
    DashboardConversationSchema,
    DashboardLeadSchema,
    DashboardMessageSchema,
    EscalationFeedbackRequest,
    ReportingSettingsSchema,
    ReportingSettingsUpdateRequest,
    StaffActionResponse,
    StaffReplyRequest,
)


# Gated on require_active_subscription: this is the actual delivered product
# (cases and conversations), so it's what's blocked when a business's own
# Flywheel subscription lapses. Settings, billing itself, and public lead
# intake stay reachable regardless -- see src/api/dependencies.py.
router = APIRouter(
    prefix="/api/v1/businesses/{business_id}",
    tags=["dashboard"],
    dependencies=[Depends(require_active_subscription)],
)


@router.get("/appointments", response_model=DashboardAppointmentListResponse)
def list_appointments(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
    on: Annotated[
        date | None,
        Query(description="Local calendar day in the business timezone. Defaults to tomorrow."),
    ] = None,
    include_test: bool = False,
) -> DashboardAppointmentListResponse:
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
        if business is None:
            raise ResourceNotFoundError("business_not_found", "Business was not found")
        dna = unit_of_work.business_dna.get_active(business_id)
        configuration = dna.configuration if dna is not None else {}
        zone_name, zone = _business_zone(configuration)
        day = on or _tomorrow_local(utc_now(), zone)
        start_at, end_at = _local_day_bounds(zone, day)
        bookings = unit_of_work.bookings.list_starting_between(business_id, start_at, end_at)
        service_names = {
            str(service["id"]): str(service["name"])
            for service in (configuration.get("services", ()) if isinstance(configuration, Mapping) else ())
            if isinstance(service, Mapping) and service.get("id") and service.get("name")
        }
        appointments = []
        for booking in bookings:
            case = unit_of_work.cases.get(business_id, booking.case_id)
            if case is not None and case.is_test and not include_test:
                continue
            lead = unit_of_work.leads.get(business_id, booking.lead_id)
            if lead is None:
                continue
            appointments.append(
                DashboardAppointmentSchema(
                    booking_id=booking.booking_id,
                    case_id=booking.case_id,
                    lead=DashboardLeadSchema.from_domain(lead),
                    service_id=booking.service_id,
                    service_name=service_names.get(booking.service_id),
                    start_at=booking.start_at,
                    end_at=booking.end_at,
                    timezone=booking.timezone or zone_name,
                    status=booking.status.value,
                )
            )
        waiting = []
        for case in unit_of_work.cases.list_by_state(
            business_id, (ProcessState.QUALIFIED,), limit=200
        ):
            if case.is_test and not include_test:
                continue
            if unit_of_work.bookings.get_for_case(business_id, case.case_id) is not None:
                continue
            lead = unit_of_work.leads.get(business_id, case.lead.lead_id)
            if lead is None:
                continue
            service_id = lead.attributes.get("service_requested")
            service_key = str(service_id) if service_id else None
            channel = case.metadata.get("waiting_channel")
            waiting.append(
                DashboardWaitingSchema(
                    case_id=case.case_id,
                    lead=DashboardLeadSchema.from_domain(lead),
                    service_id=service_key,
                    service_name=service_names.get(service_key) if service_key else None,
                    waiting_channel=str(channel) if channel else None,
                    updated_at=case.updated_at,
                )
            )
    return DashboardAppointmentListResponse(
        day=day,
        timezone=zone_name,
        appointments=tuple(appointments),
        waiting=tuple(waiting),
    )


@router.get("/cases", response_model=DashboardCaseListResponse)
def list_cases(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
    start_date: Annotated[date | None, Query(description="Inclusive UTC start date")] = None,
    end_date: Annotated[date | None, Query(description="Inclusive UTC end date")] = None,
    include_test: bool = False,
    ignore_baseline: bool = False,
) -> DashboardCaseListResponse:
    _validate_reporting_range(start_date, end_date)
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
        if business is None:
            raise ResourceNotFoundError("business_not_found", "Business was not found")
        if ignore_baseline and start_date is None:
            period_start, period_end = None, None
        else:
            period_start, period_end = _analytics_period(business.stats_since, start_date, end_date)
        cases = unit_of_work.cases.list_for_business(
            business_id,
            limit=None,
            created_at_from=period_start,
            created_at_to=period_end,
            include_test=include_test,
        )
        dna = unit_of_work.business_dna.get_active(business_id)
        service_names = {
            str(service["id"]): str(service["name"])
            for service in (dna.configuration.get("services", ()) if dna is not None else ())
            if isinstance(service, Mapping) and service.get("id") and service.get("name")
        }
    return DashboardCaseListResponse(
        cases=tuple(
            DashboardCaseSummarySchema.from_domain(case, service_names=service_names)
            for case in cases
        )
    )


@router.get("/cases/{case_id}", response_model=DashboardCaseDetailResponse)
def get_case(
    business_id: BusinessIdPath,
    case_id: str,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> DashboardCaseDetailResponse:
    with unit_of_work_factory() as unit_of_work:
        case = unit_of_work.cases.get(business_id, case_id)
        if case is None:
            raise ResourceNotFoundError("case_not_found", "Case was not found")
    return DashboardCaseDetailResponse.from_domain(case)


@router.get("/analytics", response_model=DashboardAnalyticsSchema)
def get_dashboard_analytics(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
    start_date: Annotated[date | None, Query(description="Inclusive UTC start date")] = None,
    end_date: Annotated[date | None, Query(description="Inclusive UTC end date")] = None,
    include_test: bool = False,
) -> DashboardAnalyticsSchema:
    """Compute transparent owner metrics from persisted audit data.

    Rates use all cases as the denominator. Booked/escalated are historical
    ever-events, while lost is the current terminal state. Response time is
    the median first outbound message after the first inbound message per
    conversation, which is robust to a few very slow conversations.
    """
    _validate_reporting_range(start_date, end_date)

    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
        if business is None:
            raise ResourceNotFoundError("business_not_found", "Business was not found")
        period_start, period_end = _analytics_period(business.stats_since, start_date, end_date)
        period_cases = unit_of_work.cases.list_for_business(
            business_id,
            limit=None,
            created_at_from=period_start,
            created_at_to=period_end,
            include_test=True,
        )
        hidden_test_case_ids = {case.case_id for case in period_cases if case.is_test}
        hidden_test_cases = len(hidden_test_case_ids)
        cases = period_cases if include_test else tuple(case for case in period_cases if not case.is_test)
        total = len(cases)
        booked = sum(
            any(event.event_type == "BOOKING_CREATED" for event in case.event_history)
            for case in cases
        )
        escalated = sum(
            any(
                event.event_type == "QUALIFICATION_EVALUATED"
                and event.payload.get("requires_human") is True
                for event in case.event_history
            )
            for case in cases
        )
        lost = sum(case.current_state is ProcessState.LOST for case in cases)
        escalation_reasons: dict[str, int] = {}
        escalation_feedback = {
            "unnecessary": 0,
            "missed": 0,
            "wrong_service": 0,
            "identity_same_customer": 0,
            "identity_different_customer": 0,
        }
        for case in cases:
            reason = DashboardCaseSummarySchema.escalation_reason_from_domain(case)
            if reason is not None:
                escalation_reasons[reason] = escalation_reasons.get(reason, 0) + 1
            for event in case.event_history:
                if event.event_type != "ESCALATION_FEEDBACK_RECORDED":
                    continue
                outcome = event.payload.get("outcome")
                if isinstance(outcome, str) and outcome in escalation_feedback:
                    escalation_feedback[outcome] += 1
        first_response_seconds: list[float] = []
        conversations = unit_of_work.conversations.list_for_business(business_id)
        hidden_test_conversations = sum(
            conversation.case_id in hidden_test_case_ids for conversation in conversations
        )
        included_case_ids = {case.case_id for case in cases}
        for conversation in conversations:
            if conversation.case_id not in included_case_ids:
                continue
            messages = unit_of_work.conversation_messages.list_for_conversation(
                business_id, conversation.conversation_id
            )
            inbound_at = next(
                (message.created_at for message in messages if message.direction.value == "inbound"),
                None,
            )
            if inbound_at is None:
                continue
            outbound_at = next(
                (
                    message.created_at
                    for message in messages
                    if message.direction.value == "outbound" and message.created_at >= inbound_at
                ),
                None,
            )
            if outbound_at is not None:
                first_response_seconds.append((outbound_at - inbound_at).total_seconds())
    denominator = total or 1
    return DashboardAnalyticsSchema(
        total_cases=total,
        booked_cases=booked,
        escalated_cases=escalated,
        lost_cases=lost,
        booking_conversion_rate=booked / denominator if total else 0.0,
        escalation_rate=escalated / denominator if total else 0.0,
        lost_rate=lost / denominator if total else 0.0,
        median_first_response_seconds=(median(first_response_seconds) if first_response_seconds else None),
        response_samples=len(first_response_seconds),
        escalation_reasons=escalation_reasons,
        escalation_feedback=escalation_feedback,
        hidden_test_cases=hidden_test_cases,
        hidden_test_conversations=hidden_test_conversations,
        includes_test_data=include_test,
        stats_since=business.stats_since,
        period_start=period_start,
        period_end=(period_end - timedelta(microseconds=1)) if period_end else None,
    )


@router.get("/analytics/settings", response_model=ReportingSettingsSchema)
def get_reporting_settings(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> ReportingSettingsSchema:
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.get(business_id)
        if business is None:
            raise ResourceNotFoundError("business_not_found", "Business was not found")
        return ReportingSettingsSchema.from_domain(business)


@router.patch("/analytics/settings", response_model=ReportingSettingsSchema)
def update_reporting_settings(
    business_id: BusinessIdPath,
    request: ReportingSettingsUpdateRequest,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> ReportingSettingsSchema:
    """Change reporting boundaries only; cases, conversations and audit events remain intact."""
    with unit_of_work_factory() as unit_of_work:
        business = unit_of_work.businesses.update_reporting_settings(
            business_id,
            test_mode_enabled=request.test_mode_enabled,
            stats_since=utc_now() if request.reset_statistics else None,
            clear_stats_since=request.clear_statistics_baseline,
        )
        unit_of_work.commit()
        return ReportingSettingsSchema.from_domain(business)


def _business_zone(configuration: Mapping[str, object] | object) -> tuple[str, ZoneInfo]:
    name = "America/Chicago"
    if isinstance(configuration, Mapping):
        booking = configuration.get("booking")
        business = configuration.get("business")
        if isinstance(booking, Mapping) and booking.get("timezone"):
            name = str(booking["timezone"])
        elif isinstance(business, Mapping) and business.get("timezone"):
            name = str(business["timezone"])
    try:
        return name, ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return "America/Chicago", ZoneInfo("America/Chicago")


def _tomorrow_local(now: datetime, zone: ZoneInfo) -> date:
    return now.astimezone(zone).date() + timedelta(days=1)


def _local_day_bounds(zone: ZoneInfo, day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    return start, end


def _analytics_period(
    stats_since: datetime | None,
    start_date: date | None,
    end_date: date | None,
) -> tuple[datetime | None, datetime | None]:
    """Return an inclusive date UI range as [start, exclusive end) in UTC.

    Business DNA does not currently own a reporting timezone. UTC gives the
    same deterministic answer to every authenticated staff user; dates are
    labelled accordingly in the UI rather than silently applying a browser's
    local timezone.
    """
    if start_date is None:
        return stats_since, None
    assert end_date is not None
    return (
        datetime.combine(start_date, time.min, tzinfo=timezone.utc),
        datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )


def _validate_reporting_range(start_date: date | None, end_date: date | None) -> None:
    if (start_date is None) != (end_date is None):
        raise RequestDataError("start_date and end_date must be supplied together")
    if start_date is not None and end_date is not None and end_date < start_date:
        raise RequestDataError("end_date must not precede start_date")


@router.get("/conversations", response_model=DashboardConversationListResponse)
def list_conversations(
    business_id: BusinessIdPath,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> DashboardConversationListResponse:
    with unit_of_work_factory() as unit_of_work:
        conversations = unit_of_work.conversations.list_for_business(business_id)
        schemas = []
        for conversation in conversations:
            lead_name = None
            lead_phone = None
            lead_email = None
            if conversation.lead_id is not None:
                lead = unit_of_work.leads.get(business_id, conversation.lead_id)
                lead_name = lead.name if lead is not None else None
                lead_phone = lead.phone if lead is not None else None
                lead_email = lead.email if lead is not None else None
            case_state = None
            if conversation.case_id is not None:
                case = unit_of_work.cases.get(business_id, conversation.case_id)
                case_state = case.current_state if case is not None else None
            escalation_reason = (
                DashboardCaseSummarySchema.escalation_reason_from_domain(case)
                if conversation.case_id is not None and case is not None
                else None
            )
            schemas.append(
                DashboardConversationSchema.from_domain(
                    conversation,
                    lead_name=lead_name,
                    lead_phone=lead_phone,
                    lead_email=lead_email,
                    case_state=case_state,
                    escalation_reason=escalation_reason,
                )
            )
    return DashboardConversationListResponse(conversations=tuple(schemas))


@router.get("/conversations/{conversation_id}", response_model=DashboardConversationDetailResponse)
def get_conversation(
    business_id: BusinessIdPath,
    conversation_id: str,
    user: Annotated[StaffUser, Depends(require_own_business)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> DashboardConversationDetailResponse:
    with unit_of_work_factory() as unit_of_work:
        conversation = unit_of_work.conversations.get(business_id, conversation_id)
        if conversation is None:
            raise ResourceNotFoundError("conversation_not_found", "Conversation was not found")
        lead_name = None
        lead_phone = None
        lead_email = None
        if conversation.lead_id is not None:
            lead = unit_of_work.leads.get(business_id, conversation.lead_id)
            lead_name = lead.name if lead is not None else None
            lead_phone = lead.phone if lead is not None else None
            lead_email = lead.email if lead is not None else None
        case_state = None
        if conversation.case_id is not None:
            case = unit_of_work.cases.get(business_id, conversation.case_id)
            case_state = case.current_state if case is not None else None
        escalation_reason = (
            DashboardCaseSummarySchema.escalation_reason_from_domain(case)
            if conversation.case_id is not None and case is not None
            else None
        )
        messages = unit_of_work.conversation_messages.list_for_conversation(business_id, conversation_id)
    return DashboardConversationDetailResponse(
        conversation=DashboardConversationSchema.from_domain(
            conversation,
            lead_name=lead_name,
            lead_phone=lead_phone,
            lead_email=lead_email,
            case_state=case_state,
            escalation_reason=escalation_reason,
        ),
        messages=tuple(
            DashboardMessageSchema(
                message_id=message.message_id,
                direction=message.direction,
                role=message.role,
                text=message.text,
                created_at=message.created_at,
            )
            for message in messages
        ),
    )


def _staff_action_response(
    unit_of_work_factory: UnitOfWorkFactory, business_id: str, result
) -> StaffActionResponse:
    lead_name = None
    with unit_of_work_factory() as unit_of_work:
        if result.conversation.lead_id is not None:
            lead = unit_of_work.leads.get(business_id, result.conversation.lead_id)
            lead_name = lead.name if lead is not None else None
    return StaffActionResponse(
        conversation=DashboardConversationSchema.from_domain(
            result.conversation,
            lead_name=lead_name,
            case_state=result.case.current_state if result.case is not None else None,
        ),
        case=DashboardCaseSummarySchema.from_domain(result.case) if result.case is not None else None,
    )


@router.post(
    "/conversations/{conversation_id}/reply",
    response_model=StaffActionResponse,
    status_code=status.HTTP_201_CREATED,
)
def reply_to_conversation(
    business_id: BusinessIdPath,
    conversation_id: str,
    body: StaffReplyRequest,
    user: Annotated[StaffUser, Depends(require_own_business)],
    staff_actions: Annotated[StaffActionService, Depends(get_staff_action_service)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> StaffActionResponse:
    result = staff_actions.reply(business_id, conversation_id, user, body.message)
    return _staff_action_response(unit_of_work_factory, business_id, result)


@router.post(
    "/conversations/{conversation_id}/resolve",
    response_model=StaffActionResponse,
)
def resolve_conversation_case(
    business_id: BusinessIdPath,
    conversation_id: str,
    user: Annotated[StaffUser, Depends(require_own_business)],
    staff_actions: Annotated[StaffActionService, Depends(get_staff_action_service)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> StaffActionResponse:
    result = staff_actions.resolve(business_id, conversation_id, user)
    return _staff_action_response(unit_of_work_factory, business_id, result)


@router.post(
    "/conversations/{conversation_id}/escalation-feedback",
    response_model=StaffActionResponse,
)
def record_escalation_feedback(
    business_id: BusinessIdPath,
    conversation_id: str,
    body: EscalationFeedbackRequest,
    user: Annotated[StaffUser, Depends(require_own_business)],
    staff_actions: Annotated[StaffActionService, Depends(get_staff_action_service)],
    unit_of_work_factory: Annotated[UnitOfWorkFactory, Depends(get_unit_of_work_factory)],
) -> StaffActionResponse:
    result = staff_actions.record_escalation_feedback(
        business_id, conversation_id, user, body.outcome
    )
    return _staff_action_response(unit_of_work_factory, business_id, result)
