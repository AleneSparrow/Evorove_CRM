"""Lead-touch contract: every cycle reports each contact with a person to CRM.

This is not a SalesStage and not a ProcessState. Engines keep their own
machines. CRM stores the touch, derives the owner board tab, and may send
a command back. Movement is forward-only except discard / owner command.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum, StrEnum
from typing import Any, Mapping
from uuid import uuid4

from src.domain.models import _freeze, _require_aware, _require_text, utc_now


LEAD_TOUCH_SCHEMA_VERSION = "1"
LEAD_TOUCH_IDEMPOTENCY_CHANNEL = "lead_touch"
PERSON_ID_PREFIX = "ppl_"
ALLOWED_CYCLES = frozenset({1, 2, 3})
ALLOWED_SOURCES = frozenset({"evorove_lead", "evorove", "evorove_crm"})
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class LeadTouchRejected(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.public_message = message


class LeadTouchKind(StrEnum):
    ASSEMBLED = "assembled"
    REASON_UPDATED = "reason_updated"
    DISCARDED = "discarded"
    DIALOGUE_STARTED = "dialogue_started"
    MESSAGE = "message"
    OFFER_SENT = "offer_sent"
    READY_TO_BOOK = "ready_to_book"
    STOPPED = "stopped"
    HUMAN_TAKEOVER = "human_takeover"
    BOOKED = "booked"
    PAID = "paid"
    COMMAND_APPLIED = "command_applied"


class BoardTab(StrEnum):
    COLD = "cold"
    IN_WORK = "in_work"
    OFFER_SENT = "offer_sent"
    DONE = "done"
    DISCARDED = "discarded"


class BoardCommandAction(StrEnum):
    DISCARD = "discard"
    CORRECT_IDENTITY = "correct_identity"
    PAUSE_OUTREACH = "pause_outreach"
    TAKEOVER = "takeover"


class _TabRank(IntEnum):
    DISCARDED = -1
    COLD = 0
    IN_WORK = 1
    OFFER_SENT = 2
    DONE = 3


_KIND_TAB: Mapping[LeadTouchKind, BoardTab | None] = {
    LeadTouchKind.ASSEMBLED: BoardTab.COLD,
    LeadTouchKind.REASON_UPDATED: None,
    LeadTouchKind.DISCARDED: BoardTab.DISCARDED,
    LeadTouchKind.DIALOGUE_STARTED: BoardTab.IN_WORK,
    LeadTouchKind.MESSAGE: BoardTab.IN_WORK,
    LeadTouchKind.OFFER_SENT: BoardTab.OFFER_SENT,
    LeadTouchKind.READY_TO_BOOK: BoardTab.OFFER_SENT,
    LeadTouchKind.STOPPED: None,
    LeadTouchKind.HUMAN_TAKEOVER: None,
    LeadTouchKind.BOOKED: BoardTab.DONE,
    LeadTouchKind.PAID: BoardTab.DONE,
    LeadTouchKind.COMMAND_APPLIED: None,
}

ACTIVE_BOARD_TABS = (BoardTab.COLD, BoardTab.IN_WORK, BoardTab.OFFER_SENT, BoardTab.DONE)


def stable_person_id(
    business_id: str,
    *,
    phone: str | None = None,
    email: str | None = None,
    identity: str | None = None,
    person_id: str | None = None,
) -> str:
    """One person across cycle 1, 2, and CRM. Prefer an already-issued id."""

    existing = (person_id or "").strip()
    if existing:
        if not existing.startswith(PERSON_ID_PREFIX) or len(existing) < 8:
            raise LeadTouchRejected("invalid_person_id", "person_id is not a stable person key")
        return existing
    key = (phone or "").strip() or (email or "").strip().casefold() or (identity or "").strip().casefold()
    if not key:
        raise LeadTouchRejected(
            "not_addressable",
            "A lead touch needs a person_id or an addressable identity",
        )
    digest = hashlib.sha256(f"{business_id}\n{key}".encode("utf-8")).hexdigest()[:32]
    return f"{PERSON_ID_PREFIX}{digest}"


def split_identity_blob(blob: str) -> tuple[str | None, str | None, str | None]:
    """Best-effort name, phone, email from a cycle-1 identity string."""

    text = (blob or "").strip()
    if not text:
        return None, None, None
    email = None
    match = _EMAIL_RE.search(text)
    if match:
        email = match.group(0).casefold()
        text = f"{text[:match.start()]} {text[match.end():]}"
    digits = "".join(character for character in blob if character.isdigit())
    phone = digits if 7 <= len(digits) <= 15 else None
    name = re.sub(r"[\s,]+", " ", text).strip() or None
    if name and name.isdigit():
        name = None
    return name, phone, email


def next_board_tab(current: BoardTab, kind: LeadTouchKind) -> BoardTab:
    target = _KIND_TAB[kind]
    if target is BoardTab.DISCARDED:
        return BoardTab.DISCARDED
    if current is BoardTab.DISCARDED:
        if kind is LeadTouchKind.ASSEMBLED:
            return BoardTab.COLD
        return BoardTab.DISCARDED
    if target is None:
        return current
    if _TabRank[target.name] >= _TabRank[current.name]:
        return target
    return current


@dataclass(frozen=True, slots=True)
class LeadTouchIdentity:
    name: str | None = None
    phone: str | None = None
    email: str | None = None

    def __post_init__(self) -> None:
        if self.name is not None:
            _require_text(self.name, "identity.name")
        if self.phone is not None:
            _require_text(self.phone, "identity.phone")
        if self.email is not None:
            _require_text(self.email, "identity.email")


@dataclass(frozen=True, slots=True)
class LeadTouch:
    business_id: str
    touch_id: str
    person_id: str
    cycle: int
    kind: LeadTouchKind
    source: str
    summary: str
    occurred_at: datetime
    identity: LeadTouchIdentity = field(default_factory=LeadTouchIdentity)
    payload: Mapping[str, Any] = field(default_factory=dict)
    schema_version: str = LEAD_TOUCH_SCHEMA_VERSION

    def __post_init__(self) -> None:
        _require_text(self.business_id, "business_id")
        _require_text(self.touch_id, "touch_id")
        _require_text(self.person_id, "person_id")
        _require_text(self.summary, "summary")
        _require_aware(self.occurred_at, "occurred_at")
        if self.cycle not in ALLOWED_CYCLES:
            raise LeadTouchRejected("invalid_cycle", "cycle must be 1, 2, or 3")
        if self.source not in ALLOWED_SOURCES:
            raise LeadTouchRejected("invalid_source", "source must be a known cycle engine")
        if self.schema_version != LEAD_TOUCH_SCHEMA_VERSION:
            raise LeadTouchRejected("unsupported_schema", "Unsupported lead-touch schema")
        if not self.person_id.startswith(PERSON_ID_PREFIX):
            raise LeadTouchRejected("invalid_person_id", "person_id is not a stable person key")
        if not self.identity.phone and not self.identity.email and self.kind is LeadTouchKind.ASSEMBLED:
            raise LeadTouchRejected(
                "not_addressable",
                "An assembled person must already be addressable by phone or email",
            )
        object.__setattr__(self, "payload", _freeze(dict(self.payload)))

    def fingerprint_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "touch_id": self.touch_id,
            "person_id": self.person_id,
            "cycle": self.cycle,
            "kind": self.kind.value,
            "source": self.source,
            "summary": self.summary,
            "identity": {
                "name": self.identity.name,
                "phone": self.identity.phone,
                "email": self.identity.email,
            },
        }

    @classmethod
    def from_mapping(cls, business_id: str, payload: Mapping[str, Any]) -> "LeadTouch":
        identity_raw = payload.get("identity") or {}
        if not isinstance(identity_raw, Mapping):
            raise LeadTouchRejected("invalid_identity", "identity must be an object")
        extra = payload.get("payload") or {}
        if not isinstance(extra, Mapping):
            raise LeadTouchRejected("invalid_payload", "payload must be an object")
        try:
            kind = LeadTouchKind(str(payload.get("kind") or ""))
        except ValueError as exc:
            raise LeadTouchRejected("invalid_kind", "Unknown lead-touch kind") from exc
        occurred_raw = payload.get("occurred_at")
        if isinstance(occurred_raw, datetime):
            occurred_at = occurred_raw
        elif isinstance(occurred_raw, str) and occurred_raw.strip():
            occurred_at = datetime.fromisoformat(occurred_raw.replace("Z", "+00:00"))
        else:
            occurred_at = utc_now()
        phone = _optional_text(identity_raw.get("phone"))
        email = _optional_text(identity_raw.get("email"))
        identity_blob = _optional_text(payload.get("identity_blob"))
        if identity_blob and not phone and not email:
            name, phone, email = split_identity_blob(identity_blob)
        else:
            name = _optional_text(identity_raw.get("name"))
        person_id = stable_person_id(
            business_id,
            phone=phone,
            email=email,
            identity=identity_blob,
            person_id=_optional_text(payload.get("person_id")),
        )
        cycle_raw = payload.get("cycle")
        try:
            cycle = int(cycle_raw)
        except (TypeError, ValueError) as exc:
            raise LeadTouchRejected("invalid_cycle", "cycle must be 1, 2, or 3") from exc
        return cls(
            business_id=business_id,
            touch_id=str(payload.get("touch_id") or "").strip() or str(uuid4()),
            person_id=person_id,
            cycle=cycle,
            kind=kind,
            source=str(payload.get("source") or "").strip(),
            summary=str(payload.get("summary") or "").strip(),
            occurred_at=occurred_at,
            identity=LeadTouchIdentity(name=name, phone=phone, email=email),
            payload=dict(extra),
            schema_version=str(payload.get("schema_version") or LEAD_TOUCH_SCHEMA_VERSION),
        )


@dataclass(frozen=True, slots=True)
class BoardPerson:
    business_id: str
    person_id: str
    tab: BoardTab
    name: str | None
    phone: str | None
    email: str | None
    summary: str
    last_kind: LeadTouchKind
    last_cycle: int
    last_touch_at: datetime
    paused: bool = False
    version: int = 0


@dataclass(frozen=True, slots=True)
class StoredLeadTouch:
    business_id: str
    person_id: str
    touch_id: str
    cycle: int
    kind: LeadTouchKind
    source: str
    summary: str
    occurred_at: datetime
    payload: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class LeadTouchAcceptResult:
    business_id: str
    person_id: str
    tab: BoardTab
    touch_id: str
    kind: LeadTouchKind
    duplicate: bool


@dataclass(frozen=True, slots=True)
class BoardCommand:
    business_id: str
    command_id: str
    person_id: str
    action: BoardCommandAction
    payload: Mapping[str, Any]
    created_at: datetime
    status: str = "pending"


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise LeadTouchRejected("invalid_request", "Expected a string field")
    stripped = value.strip()
    return stripped or None
