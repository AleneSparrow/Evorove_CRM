import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from src.api.app import create_app
from src.api.routes.dashboard import _tomorrow_local
from src.config import Settings
from src.domain.commercial import Booking, BookingStatus
from src.domain.models import Lead, ProcessCase
from src.domain.states import ProcessState
from src.domain.tenancy import Business
from src.persistence.sqlalchemy_models import Base
from src.persistence.sqlalchemy_uow import SQLAlchemyUnitOfWork, create_database_engine


ROOT = Path(__file__).parents[1]
NOW = datetime(2026, 9, 7, 20, 0, tzinfo=timezone.utc)
CHICAGO = ZoneInfo("America/Chicago")
TOMORROW = NOW.astimezone(CHICAGO).date() + timedelta(days=1)


def load_dna(business_id: str) -> dict:
    with (ROOT / "config" / "business_dna.example.json").open(encoding="utf-8") as file:
        configuration = json.load(file)
    configuration["business"]["id"] = business_id
    configuration["business"]["name"] = business_id
    return configuration


@pytest.fixture
def appointment_environment(tmp_path: Path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'appointments.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    factory = SQLAlchemyUnitOfWork.factory_for_engine(engine)
    application = create_app(settings=Settings(database_url=database_url, app_env="test"))
    with TestClient(application, raise_server_exceptions=False) as client:
        yield client, factory
    engine.dispose()


def signup(client: TestClient) -> tuple[str, str]:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": "owner-appointments@example.com", "password": "correct horse battery"},
    )
    assert response.status_code == 201
    token = response.json()["token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    return token, me["user_id"]


def seed_booked_day(factory, *, business_id: str = "biz-appt") -> None:
    dna = load_dna(business_id)
    tomorrow_start = datetime(2026, 9, 8, 15, 0, tzinfo=CHICAGO).astimezone(timezone.utc)
    today_start = datetime(2026, 9, 7, 14, 0, tzinfo=CHICAGO).astimezone(timezone.utc)
    cancelled_start = datetime(2026, 9, 8, 10, 0, tzinfo=CHICAGO).astimezone(timezone.utc)
    with factory() as uow:
        uow.businesses.add(
            Business(
                business_id,
                business_id,
                NOW,
                NOW,
                plan="starter",
                subscription_status="active",
            )
        )
        uow.business_dna.add_version(business_id, dna)
        uow.leads.add(
            business_id,
            Lead("lead-ada", "Ada Lovelace", "ada@example.com", "+13125550100"),
            NOW,
        )
        uow.leads.add(
            business_id,
            Lead("lead-today", "Today Person", None, "+13125550101"),
            NOW,
        )
        uow.leads.add(
            business_id,
            Lead("lead-cancel", "Cancelled Person", None, "+13125550102"),
            NOW,
        )
        uow.session.flush()
        for lead_id, case_id in (
            ("lead-ada", "case-ada"),
            ("lead-today", "case-today"),
            ("lead-cancel", "case-cancel"),
        ):
            lead = uow.leads.get(business_id, lead_id)
            uow.cases.add(
                ProcessCase(case_id, business_id, lead, ProcessState.BOOKED, NOW, NOW)
            )
        uow.session.flush()
        uow.bookings.add(
            Booking(
                "book-ada",
                business_id,
                "case-ada",
                "lead-ada",
                "diagnostic-visit",
                tomorrow_start,
                tomorrow_start + timedelta(hours=1),
                "America/Chicago",
                BookingStatus.CONFIRMED,
                NOW,
                NOW,
            )
        )
        uow.bookings.add(
            Booking(
                "book-today",
                business_id,
                "case-today",
                "lead-today",
                "diagnostic-visit",
                today_start,
                today_start + timedelta(hours=1),
                "America/Chicago",
                BookingStatus.CONFIRMED,
                NOW,
                NOW,
            )
        )
        uow.bookings.add(
            Booking(
                "book-cancel",
                business_id,
                "case-cancel",
                "lead-cancel",
                "diagnostic-visit",
                cancelled_start,
                cancelled_start + timedelta(hours=1),
                "America/Chicago",
                BookingStatus.CANCELLED,
                NOW,
                NOW,
            )
        )
        uow.commit()


def link_owner(factory, business_id: str, user_id: str) -> None:
    with factory() as uow:
        user = uow.staff_users.get(user_id)
        assert user is not None
        uow.staff_users.save(user.with_business(business_id))
        uow.commit()


def test_tomorrow_helper_uses_business_timezone() -> None:
    assert _tomorrow_local(NOW, CHICAGO) == TOMORROW


def test_appointments_list_is_tomorrows_hours_not_a_funnel(appointment_environment) -> None:
    client, factory = appointment_environment
    token, user_id = signup(client)
    seed_booked_day(factory)
    link_owner(factory, "biz-appt", user_id)
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get(
        "/api/v1/businesses/biz-appt/appointments?on=2026-09-08",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["day"] == "2026-09-08"
    assert body["timezone"] == "America/Chicago"
    assert [row["booking_id"] for row in body["appointments"]] == ["book-ada"]
    row = body["appointments"][0]
    assert row["lead"]["name"] == "Ada Lovelace"
    assert row["service_id"] == "diagnostic-visit"
    assert row["service_name"] == "Diagnostic visit"
    assert row["status"] == "CONFIRMED"
    assert "current_state" not in row


def test_appointments_default_day_is_tomorrow(appointment_environment, monkeypatch) -> None:
    client, factory = appointment_environment
    token, user_id = signup(client)
    seed_booked_day(factory)
    link_owner(factory, "biz-appt", user_id)
    monkeypatch.setattr("src.api.routes.dashboard.utc_now", lambda: NOW)
    response = client.get(
        "/api/v1/businesses/biz-appt/appointments",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["day"] == "2026-09-08"
    assert [row["booking_id"] for row in body["appointments"]] == ["book-ada"]


def test_empty_tomorrow_is_not_a_lead_queue(appointment_environment, monkeypatch) -> None:
    client, factory = appointment_environment
    token, user_id = signup(client)
    dna = load_dna("biz-empty")
    with factory() as uow:
        uow.businesses.add(
            Business(
                "biz-empty",
                "biz-empty",
                NOW,
                NOW,
                plan="starter",
                subscription_status="active",
            )
        )
        uow.business_dna.add_version("biz-empty", dna)
        uow.commit()
    link_owner(factory, "biz-empty", user_id)
    monkeypatch.setattr("src.api.routes.dashboard.utc_now", lambda: NOW)
    response = client.get(
        "/api/v1/businesses/biz-empty/appointments",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["day"] == "2026-09-08"
    assert body["appointments"] == []
    assert "cases" not in body
    assert "leads" not in body
