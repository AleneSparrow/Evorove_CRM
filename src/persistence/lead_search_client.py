"""The owner's "find people" button: ask cycle 1 to search (roadmap step 20).

The CRM never searches the web itself. It hands the owner's site to the
evorove_lead service, which finds people and puts them on Cold through the
normal lead-touch handoff. This module only starts a run and reads its status.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

LOGGER = logging.getLogger("uvicorn.error")
_TIMEOUT_SECONDS = 10


class LeadSearchError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class LeadSearchClient:
    def __init__(self, base_url: str | None, secret: str | None) -> None:
        self._base_url = (base_url or "").rstrip("/") or None
        self._secret = secret

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._secret)

    def start(self, business_id: str, site_url: str) -> dict[str, Any]:
        return self._call("POST", "/api/v1/internal/searches", {"business_id": business_id, "site_url": site_url})

    def status(self, business_id: str) -> dict[str, Any] | None:
        try:
            return self._call("GET", f"/api/v1/internal/searches/{urllib.parse.quote(business_id, safe='')}", None)
        except LeadSearchError as exc:
            if exc.status == 404:
                return None
            raise

    def _call(self, method: str, path: str, payload: dict[str, Any] | None) -> dict[str, Any]:
        if not self.configured:
            raise LeadSearchError(503, "People search is not set up yet.")
        request = urllib.request.Request(
            self._base_url + path,
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            method=method,
            headers={"Content-Type": "application/json", "X-Internal-Task-Secret": self._secret or ""},
        )
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = str(json.loads(exc.read() or b"{}").get("detail") or "")
            except (ValueError, AttributeError):
                pass
            LOGGER.warning("lead_search_http_error status=%s detail=%s", exc.code, detail)
            if exc.code == 422:
                raise LeadSearchError(422, "That website address can't be searched. Use your public site URL.") from exc
            if exc.code == 503:
                raise LeadSearchError(503, "People search is not set up yet.") from exc
            raise LeadSearchError(exc.code, "People search is unavailable right now.") from exc
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            LOGGER.warning("lead_search_unreachable error=%s", exc)
            raise LeadSearchError(502, "People search is unavailable right now.") from exc
