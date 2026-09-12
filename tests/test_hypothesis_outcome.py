"""Phase 3: hypothesis_id -> outcome reported to evorove_lead on Done/drop."""

from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.domain.lead_touch import LeadTouch, LeadTouchIdentity, LeadTouchKind, stable_person_id
from src.domain.models import Lead, ProcessCase
from src.domain.states import ProcessState
from src.domain.tenancy import Business
from src.persistence.lead_touch_service import PersistentLeadTouchService
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine

NOW = datetime(2026, 9, 12, 12, 0, tzinfo=timezone.utc)


class RecordingReporter:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def report(self, *, business_id, hypothesis_id, case_id, outcome) -> None:
        self.calls.append(
            {
                "business_id": business_id,
                "hypothesis_id": hypothesis_id,
                "case_id": case_id,
                "outcome": outcome,
            }
        )


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


def _person_id() -> str:
    return stable_person_id("tenant-a", email="jordan@example.com")


def _assemble(factory, hypothesis_id: str = "hyp-1") -> None:
    touch = LeadTouch(
        business_id="tenant-a",
        touch_id="cycle1:jordan",
        person_id=_person_id(),
        cycle=1,
        kind=LeadTouchKind.ASSEMBLED,
        source="evorove_lead",
        summary="Fits weekend catering for local events",
        occurred_at=NOW,
        identity=LeadTouchIdentity(name="Jordan Lee", email="jordan@example.com"),
        payload={"reason": "...", "channel": "email", "hypothesis_id": hypothesis_id},
    )
    PersistentLeadTouchService(factory).accept(touch)


def _case(state: ProcessState) -> ProcessCase:
    return ProcessCase(
        case_id="case-1",
        business_id="tenant-a",
        lead=Lead(lead_id="lead-1", name="Jordan Lee", email="jordan@example.com"),
        current_state=state,
    )


@pytest.mark.parametrize("state", [ProcessState.BOOKED, ProcessState.PAID])
def test_records_done_outcome_on_booked_or_paid(factory, state) -> None:
    _assemble(factory)
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(state), state, NOW)
        uow.commit()

    assert reporter.calls == [
        {"business_id": "tenant-a", "hypothesis_id": "hyp-1", "case_id": "case-1", "outcome": "done"}
    ]


@pytest.mark.parametrize("state", [ProcessState.LOST, ProcessState.CANCELLED])
def test_records_dropped_outcome_on_lost_or_cancelled(factory, state) -> None:
    _assemble(factory)
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(state), state, NOW)
        uow.commit()

    assert reporter.calls == [
        {"business_id": "tenant-a", "hypothesis_id": "hyp-1", "case_id": "case-1", "outcome": "dropped"}
    ]


def test_does_not_report_completed_to_avoid_double_counting_paid(factory) -> None:
    _assemble(factory)
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(ProcessState.COMPLETED), ProcessState.COMPLETED, NOW)
        uow.commit()

    assert reporter.calls == []


def test_does_not_report_non_terminal_states(factory) -> None:
    _assemble(factory)
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(ProcessState.QUALIFIED), ProcessState.QUALIFIED, NOW)
        uow.commit()

    assert reporter.calls == []


def test_does_not_report_when_person_never_carried_a_hypothesis_id(factory) -> None:
    """A directly inbound lead (never through cycle 1) has no hypothesis to report against."""

    touch = LeadTouch(
        business_id="tenant-a",
        touch_id="cycle2:jordan",
        person_id=_person_id(),
        cycle=2,
        kind=LeadTouchKind.DIALOGUE_STARTED,
        source="evorove",
        summary="Started chatting",
        occurred_at=NOW,
        identity=LeadTouchIdentity(name="Jordan Lee", email="jordan@example.com"),
    )
    PersistentLeadTouchService(factory).accept(touch)
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(ProcessState.BOOKED), ProcessState.BOOKED, NOW)
        uow.commit()

    assert reporter.calls == []


def test_does_not_report_when_hypothesis_id_was_blank(factory) -> None:
    """evorove_lead's phase-0 bridge path (before hypothesis.py existed) sends "" -- not a real id."""

    _assemble(factory, hypothesis_id="")
    reporter = RecordingReporter()
    service = PersistentLeadTouchService(factory, hypothesis_outcome_reporter=reporter)

    with factory() as uow:
        service.record_case_state(uow, _case(ProcessState.BOOKED), ProcessState.BOOKED, NOW)
        uow.commit()

    assert reporter.calls == []


def test_reporter_from_env_needs_base_url_and_secret(monkeypatch) -> None:
    from src.persistence.hypothesis_outcome_client import (
        HttpHypothesisOutcomeReporter,
        NullHypothesisOutcomeReporter,
        reporter_from_env,
    )

    monkeypatch.delenv("EVOROVE_LEAD_BASE_URL", raising=False)
    monkeypatch.delenv("INTERNAL_TASK_SECRET", raising=False)
    assert isinstance(reporter_from_env(), NullHypothesisOutcomeReporter)

    monkeypatch.setenv("EVOROVE_LEAD_BASE_URL", "http://evorove-lead.internal")
    monkeypatch.setenv("INTERNAL_TASK_SECRET", "local_development_only")
    assert isinstance(reporter_from_env(), HttpHypothesisOutcomeReporter)
