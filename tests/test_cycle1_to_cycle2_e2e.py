"""Cycle 1's Cold card reaches cycle 2 without a live network.

Run with one Python interpreter that has CRM's requirements, cycle 1 installed
editable (``pip install -e ../evorove_lead``), and cycle 2's requirements.
Set EVOROVE_LEAD_PATH and EVOROVE_CYCLE2_PATH if their checkouts are not
siblings of this repository. Missing checkouts skip; incompatible checkouts
or missing Python dependencies fail with an actionable message.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pytest
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


ROOT = Path(__file__).resolve().parents[1]
SECRET = "e2e-test-secret"
pytestmark = pytest.mark.sibling_e2e


def _sibling_path(env_name: str, names: tuple[str, ...]) -> tuple[Path | None, str]:
    override = os.getenv(env_name)
    candidates = ([Path(override).expanduser()] if override else
                  [ROOT.parent / name for name in names])
    for candidate in candidates:
        if (candidate / "src").is_dir():
            return candidate.resolve(), ""
    looked = ", ".join(str(candidate) for candidate in candidates)
    return None, f"searched {looked} for src/; set {env_name} to its repository root"


def _run_sibling(script: str, repo: Path, *, input_text: str | None = None) -> str:
    environment = os.environ.copy()
    # Import the selected checkout, even when another revision was installed.
    environment["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(repo / "src"), environment.get("PYTHONPATH", "")) if part
    )
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=repo, input=input_text,
        capture_output=True, text=True, check=False, env=environment,
    )
    if result.returncode:
        detail = result.stderr.strip()
        if "SIBLING_TOO_OLD:" in detail:
            pytest.fail(
                f"{repo} is too old for the observed_pain e2e contract; "
                f"update the sibling to origin/main. {detail.split('SIBLING_TOO_OLD:', 1)[1].splitlines()[0].strip()}"
            )
        if "ModuleNotFoundError:" in detail or "SIBLING_DEPENDENCY:" in detail:
            pytest.fail(
                f"{sys.executable} cannot import dependencies from {repo}. "
                "Install cycle 1 with 'python -m pip install -e <lead path>' and "
                "cycle 2 with 'python -m pip install -r <cycle 2 path>/requirements.txt'. "
                f"Import error: {detail.splitlines()[-1] if detail else 'unknown'}"
            )
        pytest.fail(f"sibling subprocess failed in {repo} (exit {result.returncode}): {detail}")
    return result.stdout


def _cycle_one_payload(lead: Path) -> dict:
    """Use cycle 1's actual serializer, with its package isolated from CRM's src."""
    script = """
import json
import sys
try:
    from evorove_lead.candidate import Candidate
    from evorove_lead.crm_touch import assembled_touch
    from evorove_lead.handoff import Cycle1Handoff
except ModuleNotFoundError as exc:
    if exc.name == 'evorove_lead' or (exc.name or '').startswith('evorove_lead.'):
        print(f'SIBLING_TOO_OLD: cycle 1 module is missing: {exc}', file=sys.stderr)
        raise SystemExit(3)
    print(f'SIBLING_DEPENDENCY: {exc}', file=sys.stderr)
    raise SystemExit(4)
except ImportError as exc:
    print(f'SIBLING_TOO_OLD: assembled_touch or a required cycle-1 symbol is missing: {exc}', file=sys.stderr)
    raise SystemExit(3)
if 'observed_pain' not in Candidate.__dataclass_fields__ or 'observed_pain' not in Cycle1Handoff.__dataclass_fields__:
    print('SIBLING_TOO_OLD: cycle 1 has no observed_pain field', file=sys.stderr)
    raise SystemExit(3)
candidate = Candidate(
    'Jordan Lee, jordan@example.com',
    'Recent customer reviews describe unanswered requests and lost bookings.',
    'https://buyer.example/reviews',
    observed_pain='Customer requests go unanswered until the next day and people book other companies.',
)
print(json.dumps(assembled_touch('tenant-a', candidate, Cycle1Handoff.from_candidate(candidate),
                                 segment='business owners with unanswered customer requests')))
"""
    return json.loads(_run_sibling(script, lead))


def _cycle_two_accept(command: dict, cycle_two: Path) -> dict:
    """POST through cycle 2's actual FastAPI route and Pydantic receiver model."""
    script = """
import json
import inspect
import sys
from types import SimpleNamespace
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.routes import internal
    from src.api.routes.internal import LeadCommandRequest
    from src.persistence.outreach_service import OutreachService
except ModuleNotFoundError as exc:
    if exc.name == 'src' or (exc.name or '').startswith('src.'):
        print(f'SIBLING_TOO_OLD: cycle 2 module is missing: {exc}', file=sys.stderr)
        raise SystemExit(3)
    print(f'SIBLING_DEPENDENCY: {exc}', file=sys.stderr)
    raise SystemExit(4)
except ImportError as exc:
    print(f'SIBLING_TOO_OLD: LeadCommandRequest or a required cycle-2 symbol is missing: {exc}', file=sys.stderr)
    raise SystemExit(3)
if not hasattr(LeadCommandRequest, 'model_validate'):
    print('SIBLING_TOO_OLD: LeadCommandRequest is not the current receiver schema', file=sys.stderr)
    raise SystemExit(3)
if 'observed_pain' not in inspect.signature(OutreachService.assign_cold).parameters:
    print('SIBLING_TOO_OLD: cycle 2 assign_cold has no observed_pain field', file=sys.stderr)
    raise SystemExit(3)
if 'observed_pain=' not in inspect.getsource(internal.apply_lead_command):
    print('SIBLING_TOO_OLD: cycle 2 lead-command route does not forward observed_pain', file=sys.stderr)
    raise SystemExit(3)

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
    return json.loads(_run_sibling(script, cycle_two, input_text=json.dumps(command)))


def test_cycle_one_cold_card_delivers_one_command_to_cycle_two(tmp_path, monkeypatch):
    lead, missing_lead = _sibling_path("EVOROVE_LEAD_PATH", ("evorove_lead", "Evorove_lead"))
    cycle_two, missing_cycle_two = _sibling_path("EVOROVE_CYCLE2_PATH", ("evorove", "Evorove"))
    missing = "; ".join(reason for reason in (missing_lead, missing_cycle_two) if reason)
    if missing:
        pytest.skip(f"sibling checkout is missing: {missing}")
    assert lead is not None and cycle_two is not None
    database_url = f"sqlite+pysqlite:///{tmp_path / 'crm.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    with factory() as uow:
        uow.businesses.add(Business("tenant-a", "Tenant A", now, now,
                                    plan="starter", subscription_status="active"))
        uow.commit()

    payload = _cycle_one_payload(lead)
    if "observed_pain" not in payload.get("payload", {}):
        pytest.fail(f"{lead} is too old for observed_pain; update the sibling to origin/main")
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
        sent.append(_cycle_two_accept(command, cycle_two))
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
    if "observed_pain" not in call:
        pytest.fail(f"{cycle_two} is too old for observed_pain; update the sibling to origin/main")
    assert call["observed_pain"] == payload["payload"]["observed_pain"]
    engine.dispose()
