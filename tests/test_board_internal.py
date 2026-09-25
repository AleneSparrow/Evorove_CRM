"""The board as a tab of evorove.com: internal routes the Evorove service calls."""

from pathlib import Path

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.config import Settings
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine

SECRET = "board-secret"
H = {"X-Internal-Task-Secret": SECRET}


def test_evorove_com_drives_the_board_through_internal_routes(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'b.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    app = create_app(settings=Settings(database_url=database_url, app_env="test", internal_task_secret=SECRET))
    base = "/api/v1/internal/businesses/biz-1"
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.put(base, json={"name": "Evorove"}).status_code == 401
        assert client.put(base, json={"name": "Evorove"}, headers=H).json()["created"] is True
        assert client.put(base, json={"name": "Evorove"}, headers=H).json()["created"] is False
        with factory() as uow:
            assert uow.businesses.get("biz-1").has_billing_access  # billing is evorove.com's job

        touch = {"touch_id": "c1-1", "cycle": 1, "kind": "assembled", "source": "evorove_lead",
                 "summary": "Asked who fixes furnaces", "identity": {"name": "Dana", "email": "dana@example.com"}}
        person_id = client.post(f"{base}/lead-touches", json=touch, headers=H).json()["person_id"]

        listed = client.get(f"{base}/board?tab=cold", headers=H)
        assert [p["person_id"] for p in listed.json()["people"]] == [person_id]
        detail = client.get(f"{base}/board/people/{person_id}", headers=H).json()
        assert detail["touches"][0]["summary"] == "Asked who fixes furnaces"
        command = client.post(f"{base}/board/people/{person_id}/commands",
                              json={"action": "pause_outreach", "approved_by": "alena@example.com"}, headers=H)
        assert command.status_code == 200 and command.json()["action"] == "pause_outreach"
        assert client.get(f"{base}/board/search", headers=H).json()["status"] == "not_set_up"
        assert client.get(f"{base}/board?tab=cold").status_code == 401
    engine.dispose()


def test_crm_pages_go_to_the_people_tab_on_the_one_site(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'r.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    app = create_app(settings=Settings(database_url=database_url, app_env="test", internal_task_secret=SECRET,
                                       public_site_url="https://evorove.com"))
    with TestClient(app, raise_server_exceptions=False, follow_redirects=False) as client:
        for path in ("/", "/login", "/app/board"):
            response = client.get(path)
            assert response.status_code == 308 and response.headers["location"] == "https://evorove.com/app/people"
        assert client.get("/ready").status_code != 308  # the service itself still answers
        assert client.get("/api/v1/internal/businesses/x/board", headers=H).status_code == 404
    engine.dispose()
