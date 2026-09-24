"""Step 20: the owner starts a people search for Cold from the CRM."""

import io
import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.app import create_app
from src.config import Settings
from src.domain.tenancy import Business
from src.persistence import lead_search_client
from src.persistence.auth_service import AuthService
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine

NOW = datetime(2026, 9, 24, tzinfo=timezone.utc)
SECRET = "board-secret"


class FakeLead:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict | None, str]] = []
        self.fail: urllib.error.HTTPError | None = None

    def __call__(self, request, timeout=None):
        body = json.loads(request.data) if request.data else None
        self.calls.append((request.get_method(), request.full_url, body, request.get_header("X-internal-task-secret")))
        if self.fail is not None:
            raise self.fail
        if request.get_method() == "POST":
            payload = {"business_id": "tenant-a", "site_url": body["site_url"], "status": "queued", "cold": 0, "last_run_at": None}
        else:
            payload = {"business_id": "tenant-a", "site_url": "https://acme-heating.com/", "status": "people_found", "cold": 4,
                       "last_run_at": "2026-09-24T11:00:00+00:00"}
        return io.BytesIO(json.dumps(payload).encode())


def _world(tmp_path: Path, monkeypatch, lead_base_url: str | None = "https://lead.internal"):
    fake = FakeLead()
    monkeypatch.setattr(lead_search_client.urllib.request, "urlopen", fake)
    database_url = f"sqlite+pysqlite:///{tmp_path / 'search.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    with factory() as uow:
        uow.businesses.add(Business("tenant-a", "Tenant A", NOW, NOW, plan="starter", subscription_status="active"))
        uow.commit()
    app = create_app(settings=Settings(database_url=database_url, app_env="test", internal_task_secret=SECRET,
                                       lead_base_url=lead_base_url))
    return app, factory, fake, engine


def _owner(factory):
    session = AuthService(factory).signup("owner@example.com", "correct horse battery")
    with factory() as uow:
        uow.staff_users.save(uow.staff_users.get(session.user.user_id).with_business("tenant-a"))
        uow.commit()
    return {"Authorization": f"Bearer {session.token}"}


def test_owner_starts_a_search_and_sees_its_status(tmp_path, monkeypatch) -> None:
    app, factory, fake, engine = _world(tmp_path, monkeypatch)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _owner(factory)
        url = "/api/v1/businesses/tenant-a/board/search"
        assert client.post(url, json={"site_url": "https://acme-heating.com/"}).status_code == 401
        started = client.post(url, json={"site_url": " https://acme-heating.com/ "}, headers=headers)
        assert started.status_code == 200, started.text
        assert started.json()["status"] == "queued"
        method, target, body, secret = fake.calls[0]
        assert (method, target) == ("POST", "https://lead.internal/api/v1/internal/searches")
        assert body == {"business_id": "tenant-a", "site_url": "https://acme-heating.com/"} and secret == SECRET
        status = client.get(url, headers=headers).json()
        assert status["status"] == "people_found" and status["cold"] == 4
    engine.dispose()


def test_errors_are_plain_english(tmp_path, monkeypatch) -> None:
    app, factory, fake, engine = _world(tmp_path, monkeypatch)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _owner(factory)
        fake.fail = urllib.error.HTTPError("u", 422, "bad", {}, io.BytesIO(b'{"detail":"private"}'))
        bad = client.post("/api/v1/businesses/tenant-a/board/search", json={"site_url": "http://10.0.0.1"}, headers=headers)
        assert bad.status_code == 422 and "public site URL" in bad.text
        fake.fail = urllib.error.URLError("down")
        down = client.post("/api/v1/businesses/tenant-a/board/search", json={"site_url": "https://a.com"}, headers=headers)
        assert down.status_code == 502 and "unavailable" in down.text
    engine.dispose()


def test_not_set_up_without_lead_url(tmp_path, monkeypatch) -> None:
    app, factory, fake, engine = _world(tmp_path, monkeypatch, lead_base_url=None)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _owner(factory)
        assert client.get("/api/v1/businesses/tenant-a/board/search", headers=headers).json()["status"] == "not_set_up"
        refused = client.post("/api/v1/businesses/tenant-a/board/search", json={"site_url": "https://a.com"}, headers=headers)
        assert refused.status_code == 503 and fake.calls == []
    engine.dispose()
