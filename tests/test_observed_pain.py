"""Observed pain is optional board data and must never block Cold."""

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest
from sqlalchemy import select

from src.domain.lead_touch import BoardTab, LeadTouch, LeadTouchIdentity, LeadTouchKind, stable_person_id
from src.domain.tenancy import Business
from src.persistence import cycle_command_delivery
from src.persistence.cycle_command_delivery import CycleCommandDeliveryService
from src.persistence.lead_touch_service import PersistentLeadTouchService
from src.persistence.sqlalchemy_models import Base, IntegrationOutboxRow
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine


NOW = datetime(2026, 10, 26, tzinfo=timezone.utc)
PAIN = "Customer requests go unanswered until the next day and people book other companies."


@pytest.fixture
def factory(tmp_path: Path):
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / 'board.db'}")
    Base.metadata.create_all(engine)
    unit_factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    with unit_factory() as uow:
        uow.businesses.add(Business("tenant-a", "Tenant A", NOW, NOW, plan="starter", subscription_status="active"))
        uow.commit()
    yield unit_factory
    engine.dispose()


def _touch(pain: object = None) -> LeadTouch:
    payload: dict[str, object] = {
        "reason": "Recent customer reviews describe unanswered requests and lost bookings.",
        "reason_source": "https://buyer.example/reviews",
        "channel": "email",
        "hypothesis_id": "hyp-1",
        "pain_evidence_excerpt": PAIN,
        "pain_evidence_source": "https://buyer.example/evidence",
    }
    if pain is not None:
        payload["observed_pain"] = pain
    return LeadTouch(
        business_id="tenant-a",
        person_id=stable_person_id("tenant-a", email="jordan@example.com"),
        touch_id="cycle1:jordan",
        cycle=1,
        kind=LeadTouchKind.ASSEMBLED,
        source="evorove_lead",
        summary="Recent reviews show requests go unanswered.",
        occurred_at=NOW,
        identity=LeadTouchIdentity(name="Jordan", email="jordan@example.com"),
        payload=payload,
    )


def _command(factory):
    with factory() as uow:
        row = uow.session.scalar(select(IntegrationOutboxRow))
        assert row is not None
        return SimpleNamespace(id=row.id, payload=dict(row.payload), status=row.status,
                               attempt_count=row.attempt_count)


def test_grounded_pain_is_stored_visible_and_copied_without_evidence(factory):
    service = PersistentLeadTouchService(factory)
    touch = _touch("  " + PAIN + "  ")
    service.accept(touch)
    person = service.list_tab("tenant-a", BoardTab.COLD)[0]
    assert person.observed_pain == PAIN
    assert person.pain_status == "ready"
    command = _command(factory)
    assert command.payload["action"] == "cold_assigned"
    assert command.payload["payload"]["observed_pain"] == PAIN
    assert "pain_evidence_excerpt" not in command.payload["payload"]
    assert "pain_evidence_source" not in command.payload["payload"]
    assert "observed_pain" not in command.payload  # nested command, not a Found request


@pytest.mark.parametrize("bad,status", [
    ("slow replies", "rejected_not_grounded"),
    ("  late   ", "rejected_not_grounded"),
    ("word " * 110, "rejected_too_long"),
])
def test_ungrounded_pain_is_marked_but_cold_command_still_exists(factory, bad, status):
    service = PersistentLeadTouchService(factory)
    result = service.accept(_touch(bad))
    assert result.tab is BoardTab.COLD
    person = service.list_tab("tenant-a", BoardTab.COLD)[0]
    assert person.pain_status == status
    assert "observed_pain" not in _command(factory).payload["payload"]
    assert _command(factory).payload["payload"]["reason_source"] == "https://buyer.example/reviews"


def test_card_without_pain_preserves_old_command_shape(factory):
    service = PersistentLeadTouchService(factory)
    service.accept(_touch())
    person = service.list_tab("tenant-a", BoardTab.COLD)[0]
    assert person.observed_pain is None and person.pain_status == "none"
    assert "observed_pain" not in _command(factory).payload["payload"]


def test_cycle_two_pain_422_marks_card_and_stops_retries(factory, monkeypatch):
    service = PersistentLeadTouchService(factory)
    service.accept(_touch(PAIN))
    monkeypatch.setattr(cycle_command_delivery, "_post_command",
                        lambda *args: (False, "observed_pain_not_grounded"))
    delivery = CycleCommandDeliveryService(factory, evorove_base_url="https://cycle-two.example",
                                           internal_task_secret="test-only")
    command = _command(factory)
    assert delivery.deliver_one(command.id) is False
    assert delivery.deliver_one(command.id) is False
    assert _command(factory).status == "FAILED"
    assert _command(factory).attempt_count == 1
    assert service.list_tab("tenant-a", BoardTab.COLD)[0].pain_status == "rejected_by_cycle2"


def test_exact_cycle_two_422_code_is_recognized_without_echoing_response(monkeypatch):
    def reject(_request, timeout):
        raise HTTPError("https://cycle-two.example/lead-commands", 422, "bad", {},
                        BytesIO(b'{"error":{"code":"observed_pain_not_grounded"}}'))
    monkeypatch.setattr(cycle_command_delivery.urllib.request, "urlopen", reject)
    ok, reason = cycle_command_delivery._post_command("https://cycle-two.example/lead-commands",
                                                       "test-only", {})
    assert (ok, reason) == (False, "observed_pain_not_grounded")
