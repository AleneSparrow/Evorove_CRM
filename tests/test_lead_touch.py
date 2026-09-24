from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.app import create_app
from src.config import Settings
from src.domain.lead_touch import (
    BoardCommandAction,
    BoardTab,
    LeadTouch,
    LeadTouchIdentity,
    LeadTouchKind,
    LeadTouchRejected,
    next_board_tab,
    split_identity_blob,
    stable_person_id,
)
from src.domain.tenancy import Business
from src.persistence.auth_service import AuthService
from src.persistence.lead_touch_service import PersistentLeadTouchService
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine


NOW = datetime(2026, 9, 12, 12, 0, tzinfo=timezone.utc)
SECRET = "test-internal-secret"


def test_stable_person_id_is_the_same_across_cycles() -> None:
    first = stable_person_id("biz-1", email="ada@example.com")
    second = stable_person_id("biz-1", email="ada@example.com")
    assert first == second
    assert first.startswith("ppl_")
    assert stable_person_id("biz-2", email="ada@example.com") != first


def test_tabs_move_forward_only() -> None:
    assert next_board_tab(BoardTab.COLD, LeadTouchKind.DIALOGUE_STARTED) is BoardTab.IN_WORK
    assert next_board_tab(BoardTab.IN_WORK, LeadTouchKind.OFFER_SENT) is BoardTab.OFFER_SENT
    assert next_board_tab(BoardTab.OFFER_SENT, LeadTouchKind.MESSAGE) is BoardTab.OFFER_SENT
    assert next_board_tab(BoardTab.OFFER_SENT, LeadTouchKind.BOOKED) is BoardTab.DONE
    assert next_board_tab(BoardTab.DONE, LeadTouchKind.ASSEMBLED) is BoardTab.DONE


def test_assembled_without_address_is_rejected() -> None:
    with pytest.raises(LeadTouchRejected, match="addressable"):
        LeadTouch(
            business_id="biz-1",
            touch_id="t1",
            person_id=stable_person_id("biz-1", email="ada@example.com"),
            cycle=1,
            kind=LeadTouchKind.ASSEMBLED,
            source="evorove_lead",
            summary="Found with a reason",
            occurred_at=NOW,
            identity=LeadTouchIdentity(name="Ada"),
        )


def test_split_identity_blob_extracts_email() -> None:
    name, phone, email = split_identity_blob("Jordan Lee, jordan@example-bakery.com")
    assert email == "jordan@example-bakery.com"
    assert name == "Jordan Lee"
    assert phone is None


@pytest.fixture
def factory(tmp_path: Path):
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / 'board.db'}")
    Base.metadata.create_all(engine)
    unit_factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    with unit_factory() as uow:
        uow.businesses.add(
            Business("tenant-a", "Tenant A", NOW, NOW, plan="starter", subscription_status="active")
        )
        uow.commit()
    yield unit_factory
    engine.dispose()


def _assembled(**overrides: object) -> LeadTouch:
    values = dict(
        business_id="tenant-a",
        touch_id="cycle1:jordan",
        person_id=stable_person_id("tenant-a", email="jordan@example.com"),
        cycle=1,
        kind=LeadTouchKind.ASSEMBLED,
        source="evorove_lead",
        summary="Fits weekend catering for local events",
        occurred_at=NOW,
        identity=LeadTouchIdentity(name="Jordan Lee", email="jordan@example.com"),
    )
    values.update(overrides)
    return LeadTouch(**values)


def test_assembled_lands_on_cold(factory) -> None:
    result = PersistentLeadTouchService(factory).accept(_assembled())
    assert result.tab is BoardTab.COLD
    assert result.duplicate is False
    people = PersistentLeadTouchService(factory).list_tab("tenant-a", BoardTab.COLD)
    assert len(people) == 1
    assert people[0].email == "jordan@example.com"


def test_dialogue_moves_to_in_work(factory) -> None:
    service = PersistentLeadTouchService(factory)
    person_id = stable_person_id("tenant-a", email="jordan@example.com")
    service.accept(_assembled())
    result = service.accept(
        _assembled(
            touch_id="cycle2:greet",
            cycle=2,
            kind=LeadTouchKind.DIALOGUE_STARTED,
            source="evorove",
            summary="First message sent",
            person_id=person_id,
        )
    )
    assert result.tab is BoardTab.IN_WORK
    assert service.list_tab("tenant-a", BoardTab.COLD) == ()
    assert len(service.list_tab("tenant-a", BoardTab.IN_WORK)) == 1


def test_replay_is_idempotent(factory) -> None:
    service = PersistentLeadTouchService(factory)
    first = service.accept(_assembled())
    second = service.accept(_assembled())
    assert second.duplicate is True
    assert second.person_id == first.person_id
    person, touches, _ = service.get_person("tenant-a", first.person_id)
    assert len(touches) == 1
    assert person.tab is BoardTab.COLD


def test_owner_discard_leaves_active_board(factory) -> None:
    service = PersistentLeadTouchService(factory)
    accepted = service.accept(_assembled())
    command = service.issue_command(
        "tenant-a",
        accepted.person_id,
        BoardCommandAction.DISCARD,
        approved_by="owner@example.com",
    )
    assert command.status == "pending"
    assert service.list_tab("tenant-a", BoardTab.COLD) == ()
    person, _, commands = service.get_person("tenant-a", accepted.person_id)
    assert person.tab is BoardTab.DISCARDED
    assert commands[0].action.value == "discard"


def test_discarded_person_found_again_stays_off_cold(factory) -> None:
    service = PersistentLeadTouchService(factory)
    accepted = service.accept(_assembled())
    service.issue_command(
        "tenant-a", accepted.person_id, BoardCommandAction.DISCARD, approved_by="owner@example.com"
    )
    again = service.accept(_assembled(touch_id="cycle1:jordan:again"))
    assert again.person_id == accepted.person_id
    assert service.list_tab("tenant-a", BoardTab.COLD) == ()
    person, touches, _ = service.get_person("tenant-a", accepted.person_id)
    assert person.tab is BoardTab.DISCARDED
    assert "cycle1:jordan:again" in {touch.touch_id for touch in touches}  # recorded, not re-activated


def test_internal_touch_and_staff_board(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'board-api.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    with factory() as uow:
        uow.businesses.add(
            Business("tenant-a", "Tenant A", NOW, NOW, plan="starter", subscription_status="active")
        )
        uow.commit()
    application = create_app(
        settings=Settings(
            database_url=database_url,
            app_env="test",
            internal_task_secret=SECRET,
        )
    )
    with TestClient(application, raise_server_exceptions=False) as client:
        session = AuthService(factory).signup("board-owner@example.com", "correct horse battery")
        with factory() as uow:
            owner = uow.staff_users.get(session.user.user_id)
            assert owner is not None
            uow.staff_users.save(owner.with_business("tenant-a"))
            uow.commit()
        missing = client.post(
            "/api/v1/internal/businesses/tenant-a/lead-touches",
            json={
                "touch_id": "c1-1",
                "cycle": 1,
                "kind": "assembled",
                "source": "evorove_lead",
                "summary": "Fits weekend catering for local events",
                "identity": {"name": "Jordan", "email": "jordan@example.com"},
            },
        )
        assert missing.status_code == 401
        created = client.post(
            "/api/v1/internal/businesses/tenant-a/lead-touches",
            headers={"X-Internal-Task-Secret": SECRET},
            json={
                "touch_id": "c1-1",
                "cycle": 1,
                "kind": "assembled",
                "source": "evorove_lead",
                "summary": "Fits weekend catering for local events",
                "identity": {"name": "Jordan", "email": "jordan@example.com"},
            },
        )
        assert created.status_code == 200, created.text
        body = created.json()
        assert body["tab"] == "cold"
        person_id = body["person_id"]
        listed = client.get(
            "/api/v1/businesses/tenant-a/board?tab=cold",
            headers={"Authorization": f"Bearer {session.token}"},
        )
        assert listed.status_code == 200
        assert listed.json()["people"][0]["person_id"] == person_id
        command = client.post(
            f"/api/v1/businesses/tenant-a/board/people/{person_id}/commands",
            headers={"Authorization": f"Bearer {session.token}"},
            json={"action": "pause_outreach"},
        )
        assert command.status_code == 200
        assert command.json()["action"] == "pause_outreach"
    engine.dispose()
