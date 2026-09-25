"""Owner board: lead touches in, four tabs out, commands back to cycle engines."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field

from src.domain.auth import StaffUser
from src.domain.lead_touch import BoardCommandAction, BoardTab, LeadTouch, LeadTouchRejected
from src.domain.tenancy import Business
from src.persistence.errors import IdempotencyCollisionError
from src.persistence.lead_search_client import LeadSearchClient, LeadSearchError
from src.persistence.lead_touch_service import PersistentLeadTouchService

from ..dependencies import (
    ApplicationContainer,
    BusinessIdPath,
    get_container,
    get_lead_touch_service,
    require_active_subscription,
    require_own_business,
    resolve_business,
)
from ..errors import ConflictError, PublicApiError, RequestDataError, ResourceNotFoundError
from ..schemas import (
    BoardCommandRequest,
    BoardCommandSchema,
    BoardListResponse,
    BoardPersonDetailResponse,
    BoardPersonSchema,
    BoardTouchSchema,
    ErrorResponse,
    LeadTouchAcceptResponse,
    LeadTouchRequest,
)
from .internal import _require_task_secret


router = APIRouter(
    prefix="/api/v1/businesses/{business_id}/board",
    tags=["board"],
    dependencies=[Depends(require_active_subscription)],
)
internal_router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _person_schema(person) -> BoardPersonSchema:
    return BoardPersonSchema(
        person_id=person.person_id,
        tab=person.tab.value,
        name=person.name,
        phone=person.phone,
        email=person.email,
        summary=person.summary,
        last_kind=person.last_kind.value,
        last_cycle=person.last_cycle,
        last_touch_at=person.last_touch_at,
        paused=person.paused,
    )


@internal_router.post(
    "/businesses/{business_id}/lead-touches",
    response_model=LeadTouchAcceptResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Internal task secret is missing or invalid"},
        404: {"model": ErrorResponse, "description": "Business not found"},
        409: {"model": ErrorResponse, "description": "Idempotency collision"},
        422: {"model": ErrorResponse, "description": "Request is not a lead touch"},
    },
    summary="Record one lead touch from cycle 1 or 2",
)
def accept_lead_touch(
    request: Request,
    business_id: BusinessIdPath,
    payload: LeadTouchRequest,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> LeadTouchAcceptResponse:
    _require_task_secret(container, x_internal_task_secret)
    try:
        touch = LeadTouch.from_mapping(business_id, payload.model_dump())
        result = service.accept(touch)
    except LeadTouchRejected as exc:
        raise RequestDataError(exc.public_message) from exc
    except IdempotencyCollisionError as exc:
        raise ConflictError("idempotency_collision", str(exc)) from exc
    except KeyError as exc:
        raise ResourceNotFoundError("business_not_found", "Business was not found") from exc
    request.state.resulting_state = result.tab
    return LeadTouchAcceptResponse(
        business_id=result.business_id,
        person_id=result.person_id,
        tab=result.tab.value,
        touch_id=result.touch_id,
        kind=result.kind.value,
        duplicate=result.duplicate,
    )


@router.get(
    "",
    response_model=BoardListResponse,
    summary="People on one owner-facing board tab",
)
def list_board(
    business_id: BusinessIdPath,
    user: Annotated[object, Depends(require_own_business)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
    tab: Annotated[
        Literal["cold", "in_work", "offer_sent", "done"],
        Query(),
    ] = "cold",
) -> BoardListResponse:
    del user
    try:
        people = service.list_tab(business_id, BoardTab(tab))
    except KeyError as exc:
        raise ResourceNotFoundError("business_not_found", "Business was not found") from exc
    return BoardListResponse(tab=tab, people=tuple(_person_schema(item) for item in people))


@router.get(
    "/people/{person_id}",
    response_model=BoardPersonDetailResponse,
    summary="One person, every recorded touch, owner commands",
)
def get_board_person(
    business_id: BusinessIdPath,
    person_id: str,
    user: Annotated[object, Depends(require_own_business)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
) -> BoardPersonDetailResponse:
    del user
    try:
        person, touches, commands = service.get_person(business_id, person_id)
    except KeyError as exc:
        raise ResourceNotFoundError("person_not_found", "Person was not found") from exc
    return BoardPersonDetailResponse(
        person=_person_schema(person),
        touches=tuple(
            BoardTouchSchema(
                touch_id=item.touch_id,
                cycle=item.cycle,
                kind=item.kind.value,
                source=item.source,
                summary=item.summary,
                occurred_at=item.occurred_at,
                payload={
                    key: value
                    for key, value in dict(item.payload).items()
                    if key != "fingerprint"
                },
            )
            for item in touches
        ),
        commands=tuple(
            BoardCommandSchema(
                command_id=item.command_id,
                action=item.action.value,
                status=item.status,
                created_at=item.created_at,
                payload=dict(item.payload),
            )
            for item in commands
        ),
    )


@router.post(
    "/people/{person_id}/commands",
    response_model=BoardCommandSchema,
    summary="Owner correction sent back to the cycle engine",
)
def issue_board_command(
    business_id: BusinessIdPath,
    person_id: str,
    payload: BoardCommandRequest,
    user: Annotated[StaffUser, Depends(require_own_business)],
    business: Annotated[Business, Depends(resolve_business)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
) -> BoardCommandSchema:
    del business
    try:
        command = service.issue_command(
            business_id,
            person_id,
            BoardCommandAction(payload.action),
            {
                key: value
                for key, value in {
                    "name": payload.name,
                    "phone": payload.phone,
                    "email": payload.email,
                }.items()
                if value
            },
            approved_by=user.email,
        )
    except KeyError as exc:
        raise ResourceNotFoundError("person_not_found", "Person was not found") from exc
    return BoardCommandSchema(
        command_id=command.command_id,
        action=command.action.value,
        status=command.status,
        created_at=command.created_at,
        payload=dict(command.payload),
    )


class LeadSearchRequest(BaseModel):
    site_url: str = Field(min_length=4, max_length=2048)


def _lead_search_client(container: ApplicationContainer) -> LeadSearchClient:
    return LeadSearchClient(container.settings.lead_base_url, container.settings.internal_task_secret)


def _search_view(business_id: str, data: dict | None) -> dict[str, object]:
    if data is None:
        return {"business_id": business_id, "status": "never_run", "site_url": None, "cold": 0, "last_run_at": None}
    return {
        "business_id": business_id,
        "status": data.get("status"),
        "site_url": data.get("site_url"),
        "cold": data.get("cold", 0),
        "last_run_at": data.get("last_run_at"),
    }


@router.post("/search", summary="Find people for Cold: cycle 1 searches from the owner's site")
def start_lead_search(
    business_id: BusinessIdPath,
    body: LeadSearchRequest,
    user: Annotated[object, Depends(require_own_business)],
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> dict[str, object]:
    del user
    try:
        return _search_view(business_id, _lead_search_client(container).start(business_id, body.site_url.strip()))
    except LeadSearchError as exc:
        raise PublicApiError(exc.status, "lead_search_unavailable" if exc.status != 422 else "invalid_site_url", exc.message) from exc


@router.get("/search", summary="Status of the last people search")
def get_lead_search(
    business_id: BusinessIdPath,
    user: Annotated[object, Depends(require_own_business)],
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> dict[str, object]:
    del user
    client = _lead_search_client(container)
    if not client.configured:
        return {**_search_view(business_id, None), "status": "not_set_up"}
    try:
        return _search_view(business_id, client.status(business_id))
    except LeadSearchError as exc:
        raise PublicApiError(exc.status, "lead_search_unavailable", exc.message) from exc



# --- The board as a tab of evorove.com -------------------------------------
# The owner signs in and pays on evorove.com (the Evorove service). Its
# "People" tab reads and drives this board through these internal routes,
# behind the same INTERNAL_TASK_SECRET. The CRM has no site of its own.


class EnsureBusinessRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class InternalCommandRequest(BoardCommandRequest):
    approved_by: str = Field(min_length=1, max_length=320)


def _detail_response(service: PersistentLeadTouchService, business_id: str, person_id: str) -> BoardPersonDetailResponse:
    try:
        person, touches, commands = service.get_person(business_id, person_id)
    except KeyError as exc:
        raise ResourceNotFoundError("person_not_found", "Person was not found") from exc
    return BoardPersonDetailResponse(
        person=_person_schema(person),
        touches=tuple(
            BoardTouchSchema(
                touch_id=item.touch_id, cycle=item.cycle, kind=item.kind.value, source=item.source,
                summary=item.summary, occurred_at=item.occurred_at,
                payload={key: value for key, value in dict(item.payload).items() if key != "fingerprint"},
            )
            for item in touches
        ),
        commands=tuple(
            BoardCommandSchema(
                command_id=item.command_id, action=item.action.value, status=item.status,
                created_at=item.created_at, payload=dict(item.payload),
            )
            for item in commands
        ),
    )


@internal_router.put("/businesses/{business_id}", summary="Make sure evorove.com's business has a board")
def ensure_business(
    business_id: BusinessIdPath,
    body: EnsureBusinessRequest,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    _require_task_secret(container, x_internal_task_secret)
    now = datetime.now(timezone.utc)
    with container.unit_of_work_factory() as uow:
        existing = uow.businesses.get(business_id)
        if existing is None:
            # Billing lives on evorove.com; the board itself is never gated here.
            uow.businesses.add(Business(business_id, body.name, now, now, plan="starter", subscription_status="active"))
            uow.commit()
    return {"business_id": business_id, "created": existing is None}


@internal_router.get("/businesses/{business_id}/board", response_model=BoardListResponse)
def internal_list_board(
    business_id: BusinessIdPath,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
    tab: Annotated[Literal["cold", "in_work", "offer_sent", "done"], Query()] = "cold",
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> BoardListResponse:
    _require_task_secret(container, x_internal_task_secret)
    try:
        people = service.list_tab(business_id, BoardTab(tab))
    except KeyError as exc:
        raise ResourceNotFoundError("business_not_found", "Business was not found") from exc
    return BoardListResponse(tab=tab, people=tuple(_person_schema(item) for item in people))


@internal_router.get("/businesses/{business_id}/board/people/{person_id}", response_model=BoardPersonDetailResponse)
def internal_get_board_person(
    business_id: BusinessIdPath,
    person_id: str,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> BoardPersonDetailResponse:
    _require_task_secret(container, x_internal_task_secret)
    return _detail_response(service, business_id, person_id)


@internal_router.post("/businesses/{business_id}/board/people/{person_id}/commands", response_model=BoardCommandSchema)
def internal_issue_board_command(
    business_id: BusinessIdPath,
    person_id: str,
    payload: InternalCommandRequest,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    service: Annotated[PersistentLeadTouchService, Depends(get_lead_touch_service)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> BoardCommandSchema:
    _require_task_secret(container, x_internal_task_secret)
    fields = {key: value for key, value in {"name": payload.name, "phone": payload.phone, "email": payload.email}.items() if value}
    try:
        command = service.issue_command(
            business_id, person_id, BoardCommandAction(payload.action), fields, approved_by=payload.approved_by
        )
    except KeyError as exc:
        raise ResourceNotFoundError("person_not_found", "Person was not found") from exc
    return BoardCommandSchema(
        command_id=command.command_id, action=command.action.value, status=command.status,
        created_at=command.created_at, payload=dict(command.payload),
    )


@internal_router.post("/businesses/{business_id}/board/search")
def internal_start_lead_search(
    business_id: BusinessIdPath,
    body: LeadSearchRequest,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    _require_task_secret(container, x_internal_task_secret)
    try:
        return _search_view(business_id, _lead_search_client(container).start(business_id, body.site_url.strip()))
    except LeadSearchError as exc:
        raise PublicApiError(exc.status, "lead_search_unavailable" if exc.status != 422 else "invalid_site_url", exc.message) from exc


@internal_router.get("/businesses/{business_id}/board/search")
def internal_get_lead_search(
    business_id: BusinessIdPath,
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    _require_task_secret(container, x_internal_task_secret)
    client = _lead_search_client(container)
    if not client.configured:
        return {**_search_view(business_id, None), "status": "not_set_up"}
    try:
        return _search_view(business_id, client.status(business_id))
    except LeadSearchError as exc:
        raise PublicApiError(exc.status, "lead_search_unavailable", exc.message) from exc
