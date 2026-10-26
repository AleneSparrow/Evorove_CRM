"""Cycle 1's Cold card reaches the cycle 2 lead-command receiver without a live network."""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from src.api.app import create_app
from src.api.schemas import LeadTouchRequest
from src.config import Settings
from src.domain.tenancy import Business
from src.persistence import cycle_command_delivery
from src.persistence.cycle_command_delivery import CycleCommandDeliveryService
from src.persistence.sqlalchemy_models import Base, IntegrationOutboxRow
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine


ROOT = Path(__file__).resolve().parents[2]
LEAD = ROOT / "evorove_lead"
CYCLE_TWO = ROOT / "evorove"
SECRET = "e2e-test-secret"


def _cycle_one_payload() -> dict:
    """Use cycle 1's actual serializer, with its package isolated from CRM's src."""
    script = """
import json
from evorove_lead.candidate import Candidate
from evorove_lead.crm_touch import assembled_touch
from evorove_lead.handoff import Cycle1Handoff
candidate = Candidate(
    'Jordan Lee, jordan@example.com',
    'Recent customer reviews describe unanswered requests and lost bookings.',
    'https://buyer.example/reviews',
    observed_pain='Customer requests go unanswered until the next day and people book other companies.',
)
print(json.dumps(assembled_touch('tenant-a', candidate, Cycle1Handoff.from_candidate(candidate),
                                 segment='business owners with unanswered customer requests')))
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=LEAD, capture_output=True,
                            text=True, check=True)
    return json.loads(result.stdout)


def _cycle_two_accept(command: dict) -> dict:
    """POST through cycle 2's actual FastAPI route and Pydantic receiver model."""
    script = """
import json
import sys
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.api.routes import internal
from src.api.routes.internal import LeadCommandRequest

body = json.loads(sys.stdin.read())
validated = LeadCommandRequest.model_validate(body)
calls = []
class Outreach:
    def assign_cold(self, business_id, **kwargs):
        calls.append({'business_id': business_id, **kwargs})
        return 'drafted'
internal.build_outreach_service = lambda container: Outreach()
app = FastAPI()
app.include_router(internal.router)
app.dependency_overrides[internal.get_container] = lambda: SimpleNamespace(
    settings=SimpleNamespace(internal_task_secret='e2e-test-secret'))
with TestClient(app) as client:
    response = client.post('/api/v1/internal/businesses/tenant-a/lead-commands',
                           json=validated.model_dump(),
                           headers={'X-Internal-Task-Secret': 'e2e-test-secret'})
assert response.status_code == 200, response.text
print(json.dumps({'response': response.json(), 'calls': calls}))
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=CYCLE_TWO,
                            input=json.dumps(command), capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_cycle_one_cold_card_delivers_one_command_to_cycle_two(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'crm.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    with factory() as uow:
        uow.businesses.add(Business("tenant-a", "Tenant A", now, now,
                                    plan="starter", subscription_status="active"))
        uow.commit()

    payload = _cycle_one_payload()
    assert LeadTouchRequest.model_validate(payload).model_dump()["schema_version"] == "1"
    assert payload["cycle"] == 1 and payload["touch_id"].startswith("cycle1:assembled:")
    assert payload["identity"]["email"] or payload["identity"]["phone"]
    assert payload["payload"]["reason"] and payload["payload"]["reason_source"]
    assert payload["payload"]["channel"] and payload["payload"]["segment"]
    assert not any(key in payload for key in ("message", "subject", "body", "text"))
    app = create_app(settings=Settings(database_url=database_url, app_env="test",
                                      internal_task_secret=SECRET))
    with TestClient(app, raise_server_exceptions=False) as client:
        url = "/api/v1/internal/businesses/tenant-a/lead-touches"
        headers = {"X-Internal-Task-Secret": SECRET}
        first = client.post(url, json=payload, headers=headers)
        again = client.post(url, json=payload, headers=headers)
        assert first.status_code == again.status_code == 200
        assert first.json()["tab"] == "cold" and again.json()["duplicate"] is True
        listed = client.get("/api/v1/internal/businesses/tenant-a/board?tab=cold", headers=headers)
        assert listed.status_code == 200 and len(listed.json()["people"]) == 1
        assert listed.json()["people"][0]["observed_pain"] == payload["payload"]["observed_pain"]

    with factory() as uow:
        rows = uow.session.scalars(select(IntegrationOutboxRow)).all()
        assert len(rows) == 1
        outbox_id = rows[0].id
    sent = []

    def fake_http(request, timeout):
        assert timeout == 5
        assert urlparse(request.full_url).path == "/api/v1/internal/businesses/tenant-a/lead-commands"
        command = json.loads(request.data)
        assert request.headers["X-internal-task-secret"] == SECRET
        assert set(command["payload"]) == {"reason", "reason_source", "channel", "hypothesis_id", "segment", "observed_pain"}
        assert not any(key in json.dumps(command) for key in ("pain_evidence_excerpt", "pain_evidence_source"))
        assert not any(key in command["payload"] for key in ("message", "subject", "body", "text"))
        sent.append(_cycle_two_accept(command))
        return type("Response", (), {"status": 200, "__enter__": lambda self: self,
                                      "__exit__": lambda self, *args: None})()

    monkeypatch.setattr(cycle_command_delivery.urllib.request, "urlopen", fake_http)
    delivery = CycleCommandDeliveryService(factory, evorove_base_url="https://cycle-two.example",
                                           internal_task_secret=SECRET)
    assert delivery.deliver_one(outbox_id) is True
    assert delivery.deliver_one(outbox_id) is True
    assert len(sent) == 1
    call = sent[0]["calls"][0]
    assert call["person_id"] == first.json()["person_id"]
    assert call["reason"] == payload["payload"]["reason"]
    assert call["reason_source"] == payload["payload"]["reason_source"]
    assert call["segment"] == payload["payload"]["segment"]
    assert call["observed_pain"] == payload["payload"]["observed_pain"]
    engine.dispose()
