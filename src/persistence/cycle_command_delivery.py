"""Deliver owner board commands to the cycle-2 engine."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Any
from urllib.parse import urljoin

from sqlalchemy import select

from src.domain.models import utc_now
from src.persistence.lead_touch_service import CYCLE_COMMAND_OUTBOX_KIND
from src.persistence.repositories import UnitOfWorkFactory
from src.persistence.sqlalchemy_models import IntegrationOutboxRow

LOGGER = logging.getLogger("uvicorn.error")
_MAX_ATTEMPTS = 8
_BACKOFF = timedelta(minutes=5)


class CycleCommandDeliveryService:
    def __init__(
        self,
        unit_of_work_factory: UnitOfWorkFactory,
        *,
        evorove_base_url: str | None,
        internal_task_secret: str | None,
    ) -> None:
        self._unit_of_work_factory = unit_of_work_factory
        self._evorove_base_url = (evorove_base_url or "").rstrip("/") or None
        self._secret = internal_task_secret

    def deliver_due(self, *, limit: int = 50) -> dict[str, int]:
        now = utc_now()
        with self._unit_of_work_factory() as uow:
            session = getattr(uow, "session", None)
            if session is None:
                return {"attempted": 0, "sent": 0, "failed": 0}
            rows = session.scalars(
                select(IntegrationOutboxRow)
                .where(
                    IntegrationOutboxRow.status == "PENDING",
                    IntegrationOutboxRow.kind == CYCLE_COMMAND_OUTBOX_KIND,
                    IntegrationOutboxRow.next_attempt_at <= now,
                )
                .order_by(IntegrationOutboxRow.created_at.asc())
                .limit(limit)
            ).all()
            ids = [row.id for row in rows]
        attempted = sent = failed = 0
        for outbox_id in ids:
            attempted += 1
            if self.deliver_one(outbox_id):
                sent += 1
            else:
                failed += 1
        return {"attempted": attempted, "sent": sent, "failed": failed}

    def deliver_one(self, outbox_id: str) -> bool:
        with self._unit_of_work_factory() as uow:
            session = getattr(uow, "session", None)
            if session is None:
                return False
            row = session.get(IntegrationOutboxRow, outbox_id)
            if row is None or row.status != "PENDING":
                return row is not None and row.status == "SENT"
            now = utc_now()
            command_id = str(row.payload.get("command_id") or "")
            if not self._evorove_base_url or not self._secret:
                row.status = "FAILED"
                row.last_error = "evorove_not_configured"
                row.updated_at = now
                if command_id:
                    uow.board.mark_command_status(row.business_id, command_id, "failed", now=now)
                uow.commit()
                return False
            url = urljoin(
                self._evorove_base_url + "/",
                f"api/v1/internal/businesses/{row.business_id}/lead-commands",
            )
            delivered, error = _post_command(url, self._secret, dict(row.payload))
            if delivered:
                row.status = "SENT"
                row.updated_at = now
                if command_id:
                    uow.board.mark_command_status(
                        row.business_id, command_id, "delivered", now=now
                    )
                uow.commit()
                return True
            row.attempt_count += 1
            row.last_error = (error or "delivery_failed")[:255]
            row.updated_at = now
            if row.attempt_count >= _MAX_ATTEMPTS:
                row.status = "FAILED"
                if command_id:
                    uow.board.mark_command_status(row.business_id, command_id, "failed", now=now)
            else:
                row.next_attempt_at = now + _BACKOFF
            uow.commit()
            return False


def _post_command(url: str, secret: str, payload: dict[str, Any]) -> tuple[bool, str | None]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Task-Secret": secret,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300, None
    except urllib.error.HTTPError as exc:
        LOGGER.warning("cycle_command_http_error url=%s status=%s", url, exc.code)
        return False, f"http_{exc.code}"
    except urllib.error.URLError as exc:
        LOGGER.warning("cycle_command_url_error url=%s error=%s", url, exc.reason)
        return False, "unreachable"
