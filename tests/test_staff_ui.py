from pathlib import Path

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.config import Settings


def test_staff_ui_serves_board_from_the_api_origin(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>staff</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("ok", encoding="utf-8")
    application = create_app(
        settings=Settings(database_url="sqlite+pysqlite://", app_env="test"),
        staff_ui_dist=dist,
    )
    with TestClient(application, raise_server_exceptions=False) as client:
        board = client.get("/app/board")
        assert board.status_code == 200
        assert "staff" in board.text
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert asset.text == "ok"
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        missing_api = client.get("/api/v1/does-not-exist")
        assert missing_api.status_code == 404
        assert "staff" not in missing_api.text
