import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.app import create_app
from src.config import Settings
from src.domain.events import EventType
from src.domain.hot_lead import (
    HotLeadHandoff,
    HotLeadIdentity,
    HotLeadReadiness,
    HotLeadRejected,
)
from src.domain.commercial import Booking, BookingStatus
from src.domain.models import Lead, ProcessCase
from src.domain.states import ProcessState
from src.domain.tenancy import Business
from src.engine.intent_extractor import DeterministicIntentExtractor
from src.persistence.auth_service import AuthService
from src.persistence.commercial_service import CommercialWorkflowService
from src.persistence.hot_lead_handoff import PersistentHotLeadHandoffService
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine


ROOT = Path(__file__).parents[1]
NOW = datetime(2026, 9, 7, 20, 0, tzinfo=timezone.utc)


def load_dna(business_id: str) -> dict:
    with (ROOT / "config" / "business_dna.example.json").open(encoding="utf-8") as file:
        configuration = json.load(file)
    configuration["business"]["id"] = business_id
    configuration["business"]["name"] = business_id
    return configuration


def seed_business(factory, business_id: str) -> None:
    with factory() as unit_of_work:
        unit_of_work.businesses.add(Business(business_id, business_id, NOW, NOW))
        unit_of_work.business_dna.add_version(business_id, load_dna(business_id))
        unit_of_work.commit()


def make_handoff(
    business_id: str = "tenant-a",
    *,
    handoff_id: str = "handoff-1",
    service_id: str = "diagnostic-visit",
    location: str | None = "60601",
    evidence: str = "Yes, book me.",
) -> HotLeadHandoff:
    return HotLeadHandoff(
        business_id=business_id,
        handoff_id=handoff_id,
        channel="web_chat",
        identity=HotLeadIdentity(name="Ada", phone="+13125550100"),
        service_id=service_id,
        readiness=HotLeadReadiness(evidence_excerpt=evidence),
        sales_profile_snapshot={"stage": "BOOKING", "last_move": "OFFER_BOOKING_SLOTS"},
        customer_location=location,
    )


@pytest.fixture
def factory(tmp_path: Path):
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / 'hot-lead.db'}")
    Base.metadata.create_all(engine)
    unit_factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    seed_business(unit_factory, "tenant-a")
    yield unit_factory
    engine.dispose()


def test_zip_only_card_is_not_a_hot_lead() -> None:
    with pytest.raises(HotLeadRejected, match="readiness"):
        HotLeadHandoff.from_mapping(
            "tenant-a",
            {
                "handoff_id": "card-1",
                "channel": "web_chat",
                "identity": {"name": "Ada", "phone": "+13125550100"},
                "service_id": "diagnostic-visit",
                "customer_location": "60601",
            },
        )


def test_calendar_slot_in_handoff_is_rejected() -> None:
    with pytest.raises(HotLeadRejected, match="calendar"):
        HotLeadHandoff.from_mapping(
            "tenant-a",
            {
                "handoff_id": "slot-1",
                "channel": "sms",
                "identity": {"phone": "+13125550100"},
                "service_id": "diagnostic-visit",
                "readiness": {"evidence_excerpt": "Book me", "signal": "ready_to_book"},
                "slot_start_at": "2026-09-08T15:00:00+00:00",
            },
        )


def test_name_without_channel_identity_is_rejected() -> None:
    with pytest.raises(HotLeadRejected, match="addressable"):
        HotLeadIdentity(name="Ada")


def test_accept_creates_qualified_case_without_a_slot(factory) -> None:
    service = PersistentHotLeadHandoffService(factory)
    result = service.accept(make_handoff(), occurred_at=NOW)

    assert result.duplicate is False
    assert result.current_state == ProcessState.QUALIFIED.value
    assert result.booking_id is None
    with factory() as uow:
        case = uow.cases.get("tenant-a", result.case_id)
        booking = uow.bookings.get_for_case("tenant-a", result.case_id)
        assert case is not None
        assert case.current_state is ProcessState.QUALIFIED
        assert case.lead.attributes["service_requested"] == "diagnostic-visit"
        assert case.metadata["hot_lead_handoff"] is True
        assert case.metadata["waiting_channel"] == "web_chat"
        assert case.metadata["readiness_evidence"] == "Yes, book me."
        assert booking is None
        types = [event.event_type for event in uow.events.list_for_case("tenant-a", result.case_id)]
        assert EventType.HOT_LEAD_RECEIVED in types
        assert types.count(EventType.STATE_CHANGED) == 3


def test_replay_returns_the_same_case(factory) -> None:
    service = PersistentHotLeadHandoffService(factory)
    first = service.accept(make_handoff(), occurred_at=NOW)
    second = service.accept(make_handoff(), occurred_at=NOW)
    assert second.duplicate is True
    assert second.case_id == first.case_id


def test_unknown_service_is_rejected(factory) -> None:
    service = PersistentHotLeadHandoffService(factory)
    with pytest.raises(HotLeadRejected, match="catalog"):
        service.accept(make_handoff(service_id="not-a-service"), occurred_at=NOW)


def test_commercial_can_propose_slots_after_handoff(factory) -> None:
    accepted = PersistentHotLeadHandoffService(factory).accept(make_handoff(), occurred_at=NOW)
    commercial = CommercialWorkflowService()
    metadata: dict = {}
    with factory() as uow:
        case = uow.cases.get("tenant-a", accepted.case_id)
        dna = uow.business_dna.get_active("tenant-a")
        assert case is not None and dna is not None
        response = commercial.initialize(
            uow, case, load_dna("tenant-a"), metadata, occurred_at=NOW
        )
        uow.commit()
    assert response.reason == "booking_slots_proposed"
    assert case.current_state is ProcessState.QUALIFIED
    with factory() as uow:
        assert uow.bookings.get_for_case("tenant-a", accepted.case_id) is None


def test_accept_does_not_run_a_sales_stage_machine(factory) -> None:
    result = PersistentHotLeadHandoffService(factory).accept(make_handoff(), occurred_at=NOW)
    with factory() as uow:
        case = uow.cases.get("tenant-a", result.case_id)
        assert case is not None
        assert "sales_stage" not in case.metadata
        assert case.metadata["sales_profile_snapshot"]["stage"] == "BOOKING"


def test_human_hold_is_not_auto_advanced(factory) -> None:
    with factory() as uow:
        lead = Lead("lead-hold", "Ada", None, "+13125550100")
        uow.leads.add("tenant-a", lead, NOW)
        uow.session.flush()
        uow.cases.add(
            ProcessCase(
                "case-hold",
                "tenant-a",
                lead,
                ProcessState.NEEDS_HUMAN,
                NOW,
                NOW,
                pending_transition=ProcessState.QUALIFIED,
            )
        )
        uow.commit()
    with pytest.raises(HotLeadRejected, match="human"):
        PersistentHotLeadHandoffService(factory).accept(make_handoff(), occurred_at=NOW)


def test_already_booked_person_is_not_a_hot_lead(factory) -> None:
    accepted = PersistentHotLeadHandoffService(factory).accept(make_handoff(), occurred_at=NOW)
    with factory() as uow:
        uow.bookings.add(
            Booking(
                "book-ada",
                "tenant-a",
                accepted.case_id,
                accepted.lead_id,
                "diagnostic-visit",
                NOW,
                NOW + timedelta(hours=1),
                "America/Chicago",
                BookingStatus.CONFIRMED,
                NOW,
                NOW,
            )
        )
        uow.commit()
    with pytest.raises(HotLeadRejected, match="calendar"):
        PersistentHotLeadHandoffService(factory).accept(
            make_handoff(handoff_id="handoff-2"),
            occurred_at=NOW,
        )


def test_qualified_case_without_a_slot_is_reused(factory) -> None:
    first = PersistentHotLeadHandoffService(factory).accept(make_handoff(), occurred_at=NOW)
    second = PersistentHotLeadHandoffService(factory).accept(
        make_handoff(handoff_id="handoff-2"),
        occurred_at=NOW,
    )
    assert second.duplicate is False
    assert second.case_id == first.case_id


def test_quote_path_is_reachable_after_handoff(factory) -> None:
    accepted = PersistentHotLeadHandoffService(factory).accept(
        make_handoff(service_id="equipment-replacement"),
        occurred_at=NOW,
    )
    commercial = CommercialWorkflowService()
    metadata: dict = {}
    with factory() as uow:
        case = uow.cases.get("tenant-a", accepted.case_id)
        dna = uow.business_dna.get_active("tenant-a")
        assert case is not None and dna is not None
        response = commercial.initialize(
            uow, case, load_dna("tenant-a"), metadata, occurred_at=NOW
        )
        uow.commit()
    assert response.reason == "pricing_input_required"
    assert case.current_state in {ProcessState.QUALIFIED, ProcessState.QUOTED}


@pytest.fixture
def api_client(tmp_path: Path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'hot-lead-api.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    unit_factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    seed_business(unit_factory, "tenant-a")
    application = create_app(
        settings=Settings(
            database_url=database_url,
            app_env="test",
            internal_task_secret="test-internal-secret",
        ),
        intent_extractor=DeterministicIntentExtractor({}),
    )
    with TestClient(application, raise_server_exceptions=False) as client:
        session = AuthService(unit_factory).signup(
            "hot-lead-owner@example.com", "correct horse battery"
        )
        with unit_factory() as unit_of_work:
            owner = unit_of_work.staff_users.get(session.user.user_id)
            assert owner is not None
            unit_of_work.staff_users.save(owner.with_business("tenant-a"))
            unit_of_work.commit()
        client.headers.update({"Authorization": f"Bearer {session.token}"})
        yield client, unit_factory
    engine.dispose()


def _payload(**overrides: object) -> dict:
    body: dict = {
        "handoff_id": "evorove-handoff-1",
        "source": "evorove",
        "channel": "sms",
        "identity": {"name": "Ada", "phone": "+13125550100"},
        "service_id": "diagnostic-visit",
        "readiness": {
            "evidence_excerpt": "Let's lock a time.",
            "signal": "ready_to_book",
        },
        "sales_profile_snapshot": {"stage": "BOOKING"},
        "customer_location": "60601",
    }
    body.update(overrides)
    return body


def test_api_accepts_hot_lead_and_does_not_book(api_client) -> None:
    client, factory = api_client
    response = client.post("/api/v1/businesses/tenant-a/hot-leads", json=_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current_state"] == "QUALIFIED"
    assert body["booking_id"] is None
    assert body["duplicate"] is False
    replay = client.post("/api/v1/businesses/tenant-a/hot-leads", json=_payload())
    assert replay.status_code == 200
    assert replay.json()["duplicate"] is True
    assert replay.json()["case_id"] == body["case_id"]
    with factory() as uow:
        assert uow.bookings.get_for_case("tenant-a", body["case_id"]) is None


def test_api_rejects_interest_without_readiness(api_client) -> None:
    client, _ = api_client
    response = client.post(
        "/api/v1/businesses/tenant-a/hot-leads",
        json=_payload(readiness={"evidence_excerpt": "just looking", "signal": "curious"}),
    )
    assert response.status_code == 422


def test_api_rejects_a_slot_in_the_payload(api_client) -> None:
    client, _ = api_client
    response = client.post(
        "/api/v1/businesses/tenant-a/hot-leads",
        json=_payload(slot_start_at="2026-09-08T15:00:00+00:00"),
    )
    assert response.status_code == 422


def test_internal_accepts_hot_lead_with_task_secret(api_client) -> None:
    client, factory = api_client
    response = client.post(
        "/api/v1/internal/businesses/tenant-a/hot-leads",
        json=_payload(handoff_id="evorove-internal-1"),
        headers={"X-Internal-Task-Secret": "test-internal-secret"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current_state"] == "QUALIFIED"
    assert body["booking_id"] is None
    with factory() as uow:
        assert uow.bookings.get_for_case("tenant-a", body["case_id"]) is None


def test_internal_rejects_missing_or_wrong_secret(api_client) -> None:
    client, _ = api_client
    missing = client.post(
        "/api/v1/internal/businesses/tenant-a/hot-leads",
        json=_payload(handoff_id="evorove-internal-2"),
    )
    assert missing.status_code == 401
    wrong = client.post(
        "/api/v1/internal/businesses/tenant-a/hot-leads",
        json=_payload(handoff_id="evorove-internal-3"),
        headers={"X-Internal-Task-Secret": "nope"},
    )
    assert wrong.status_code == 401
