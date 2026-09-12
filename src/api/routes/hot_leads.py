"""Receive a hot lead from Evorove into cycle 3."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request

from src.domain.auth import StaffUser
from src.domain.hot_lead import HotLeadHandoff, HotLeadRejected
from src.domain.tenancy import Business
from src.persistence.hot_lead_handoff import PersistentHotLeadHandoffService

from ..dependencies import (
    ApplicationContainer,
    BusinessIdPath,
    get_container,
    get_hot_lead_handoff_service,
    require_own_business,
    resolve_business,
)
from ..errors import RequestDataError, ResourceNotFoundError
from ..schemas import ErrorResponse, HotLeadHandoffRequest, HotLeadHandoffResponse
from .internal import _require_task_secret


router = APIRouter(prefix="/api/v1/businesses", tags=["hot lead"])
internal_router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


_RESPONSES = {
    404: {"model": ErrorResponse, "description": "Business not found"},
    409: {"model": ErrorResponse, "description": "Idempotency or concurrency conflict"},
    422: {"model": ErrorResponse, "description": "Request is not a hot lead"},
}


def _accept(
    request: Request,
    business_id: str,
    payload: HotLeadHandoffRequest,
    handoff_service: PersistentHotLeadHandoffService,
) -> HotLeadHandoffResponse:
    try:
        handoff = HotLeadHandoff.from_mapping(business_id, payload.model_dump())
    except (TypeError, ValueError) as exc:
        message = getattr(exc, "public_message", None)
        raise RequestDataError(message if isinstance(message, str) else "Request is not a hot lead") from exc

    try:
        result = handoff_service.accept(handoff)
    except HotLeadRejected as exc:
        raise RequestDataError(exc.public_message) from exc
    except KeyError as exc:
        raise ResourceNotFoundError("business_not_found", "Business was not found") from exc

    request.state.resulting_state = result.current_state
    return HotLeadHandoffResponse(
        business_id=result.business_id,
        case_id=result.case_id,
        lead_id=result.lead_id,
        current_state=result.current_state,
        service_id=result.service_id,
        waiting_channel=result.waiting_channel,
        duplicate=result.duplicate,
        booking_id=result.booking_id,
    )


@router.post(
    "/{business_id}/hot-leads",
    response_model=HotLeadHandoffResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Staff authentication is required"},
        403: {"model": ErrorResponse, "description": "Staff user does not own this business"},
        **_RESPONSES,
    },
    summary="Accept a hot lead from Evorove (ready to book, not yet on the calendar)",
    description=(
        "Staff-authenticated receive path for a person who already agreed to a service "
        "and is ready to book. Creates a QUALIFIED case. Does not set a calendar hour; "
        "zone, forms, the specific slot, and any quote stay with ProcessEngine / commercial. "
        "Replaying the same business and handoff_id with the same payload returns the stored result."
    ),
)
def accept_hot_lead(
    request: Request,
    payload: HotLeadHandoffRequest,
    user: Annotated[StaffUser, Depends(require_own_business)],
    business: Annotated[Business, Depends(resolve_business)],
    handoff_service: Annotated[PersistentHotLeadHandoffService, Depends(get_hot_lead_handoff_service)],
) -> HotLeadHandoffResponse:
    return _accept(request, business.business_id, payload, handoff_service)


@internal_router.post(
    "/businesses/{business_id}/hot-leads",
    response_model=HotLeadHandoffResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Internal task secret is missing or invalid"},
        **_RESPONSES,
    },
    summary="Machine receive path for a hot lead from Evorove",
    description=(
        "Same contract as the staff hot-leads route, gated by INTERNAL_TASK_SECRET. "
        "Does not set a calendar hour. Evorove POSTs here when the person is ready to book."
    ),
)
def accept_hot_lead_internal(
    request: Request,
    business_id: BusinessIdPath,
    payload: HotLeadHandoffRequest,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    handoff_service: Annotated[PersistentHotLeadHandoffService, Depends(get_hot_lead_handoff_service)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> HotLeadHandoffResponse:
    _require_task_secret(container, x_internal_task_secret)
    return _accept(request, business_id, payload, handoff_service)
