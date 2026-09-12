"""Best-effort outbound report to evorove_lead: hypothesis_id -> outcome.

Phase 3 of the cycle-1 hypothesis-search-loop plan: when a case reaches a
terminal outcome (Done, or an explicit drop), the hypothesis that produced
this person -- carried since intake as non-PII metadata on the assembled
lead touch, see `lead_touch_service._hypothesis_id_for_person` -- gets told
what happened. Never who the person was: this client's `report` has no
parameter for a name, contact, or message.

Deliberately stdlib-only (`urllib.request`), same convention as
`evorove_lead`'s own `crm_touch.py` client on the other side of this same
call. Never raises: reporting an outcome must not be allowed to break a
real ProcessState transition.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Protocol


class HypothesisOutcomeReporter(Protocol):
    def report(self, *, business_id: str, hypothesis_id: str, case_id: str, outcome: str) -> None: ...


class NullHypothesisOutcomeReporter:
    def report(self, *, business_id: str, hypothesis_id: str, case_id: str, outcome: str) -> None:
        return None


class HttpHypothesisOutcomeReporter:
    """POST one outcome event to evorove_lead's internal API. Failures are swallowed."""

    def __init__(self, base_url: str, secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret

    def report(self, *, business_id: str, hypothesis_id: str, case_id: str, outcome: str) -> None:
        url = f"{self._base_url}/api/v1/internal/hypothesis-outcomes"
        body = json.dumps(
            {
                "business_id": business_id,
                "hypothesis_id": hypothesis_id,
                "case_id": case_id,
                "outcome": outcome,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Internal-Task-Secret": self._secret,
            },
        )
        try:
            urllib.request.urlopen(request, timeout=5).close()
        except (urllib.error.URLError, TimeoutError, OSError):
            return


def reporter_from_env() -> HypothesisOutcomeReporter:
    """No `EVOROVE_LEAD_BASE_URL` -> no reporter. Same shape as `sink_from_env` in evorove_lead."""

    base = (os.getenv("EVOROVE_LEAD_BASE_URL") or "").strip().rstrip("/")
    secret = os.getenv("INTERNAL_TASK_SECRET") or ""
    if base and secret:
        return HttpHypothesisOutcomeReporter(base, secret)
    return NullHypothesisOutcomeReporter()
