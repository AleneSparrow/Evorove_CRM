"""Cycle-3 receive contract for a hot lead from Evorove.

This is the only legal entry into CRM booking. The payload is a person who
already agreed to a service and is ready to book — not a search result, not
a ZIP card, and not a calendar slot. Operational fields (zone, forms, hour,
quote) are collected after accept, by existing commercial machinery.
"""

from dataclasses import dataclass, field
from typing import Any, Mapping

from src.domain.models import _freeze, _require_text


HOT_LEAD_HANDOFF_SCHEMA_VERSION = "1"
HOT_LEAD_SOURCE = "evorove"
HOT_LEAD_IDEMPOTENCY_CHANNEL = "hot_lead"
HOT_LEAD_READINESS_SIGNAL = "ready_to_book"
ALLOWED_WAITING_CHANNELS = frozenset({"sms", "web_chat", "email"})
_CALENDAR_KEYS = frozenset({"slot_start_at", "start_at", "booking_id", "end_at"})


class HotLeadRejected(ValueError):
    """The payload is not a hot lead this CRM may accept."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.public_message = message


@dataclass(frozen=True, slots=True)
class HotLeadIdentity:
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
        if not self.phone and not self.email:
            raise HotLeadRejected(
                "not_addressable",
                "A hot lead must already be addressable by phone or email",
            )


@dataclass(frozen=True, slots=True)
class HotLeadReadiness:
    evidence_excerpt: str
    signal: str = HOT_LEAD_READINESS_SIGNAL

    def __post_init__(self) -> None:
        _require_text(self.evidence_excerpt, "readiness.evidence_excerpt")
        _require_text(self.signal, "readiness.signal")
        if self.signal != HOT_LEAD_READINESS_SIGNAL:
            raise HotLeadRejected(
                "missing_readiness",
                "A hot lead must carry a ready_to_book signal, not raw interest",
            )


@dataclass(frozen=True, slots=True)
class HotLeadHandoff:
    """Explicit receive contract from Evorove (cycle 2 exit / cycle 3 entry)."""

    business_id: str
    handoff_id: str
    channel: str
    identity: HotLeadIdentity
    service_id: str
    readiness: HotLeadReadiness
    source: str = HOT_LEAD_SOURCE
    schema_version: str = HOT_LEAD_HANDOFF_SCHEMA_VERSION
    sales_profile_snapshot: Mapping[str, Any] = field(default_factory=dict)
    customer_location: str | None = None
    person_id: str | None = None

    def __post_init__(self) -> None:
        _require_text(self.business_id, "business_id")
        _require_text(self.handoff_id, "handoff_id")
        _require_text(self.channel, "channel")
        _require_text(self.service_id, "service_id")
        if self.source != HOT_LEAD_SOURCE:
            raise HotLeadRejected("invalid_source", "Hot leads are accepted only from Evorove")
        if self.schema_version != HOT_LEAD_HANDOFF_SCHEMA_VERSION:
            raise HotLeadRejected("unsupported_schema", "Unsupported hot-lead handoff schema")
        if self.channel not in ALLOWED_WAITING_CHANNELS:
            raise HotLeadRejected(
                "invalid_channel",
                "Waiting channel must be sms, web_chat, or email",
            )
        if self.customer_location is not None:
            _require_text(self.customer_location, "customer_location")
        if self.person_id is not None:
            _require_text(self.person_id, "person_id")
        snapshot = dict(self.sales_profile_snapshot)
        _reject_calendar_keys(snapshot, "sales_profile_snapshot")
        object.__setattr__(self, "sales_profile_snapshot", _freeze(snapshot))

    def fingerprint_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "source": self.source,
            "business_id": self.business_id,
            "handoff_id": self.handoff_id,
            "channel": self.channel,
            "identity": {
                "name": self.identity.name,
                "phone": self.identity.phone,
                "email": self.identity.email,
            },
            "service_id": self.service_id,
            "readiness": {
                "evidence_excerpt": self.readiness.evidence_excerpt,
                "signal": self.readiness.signal,
            },
            "sales_profile_snapshot": _unfreeze(self.sales_profile_snapshot),
            "customer_location": self.customer_location,
            "person_id": self.person_id,
        }

    @classmethod
    def from_mapping(cls, business_id: str, payload: Mapping[str, Any]) -> "HotLeadHandoff":
        _reject_calendar_keys(payload, "handoff")
        identity_raw = payload.get("identity")
        readiness_raw = payload.get("readiness")
        if not isinstance(identity_raw, Mapping):
            raise HotLeadRejected("not_addressable", "A hot lead must include an addressable identity")
        if not isinstance(readiness_raw, Mapping):
            raise HotLeadRejected(
                "missing_readiness",
                "A hot lead must carry readiness evidence, not a CRM card",
            )
        snapshot = payload.get("sales_profile_snapshot") or {}
        if not isinstance(snapshot, Mapping):
            raise HotLeadRejected("invalid_snapshot", "sales_profile_snapshot must be an object")
        return cls(
            business_id=business_id,
            handoff_id=str(payload.get("handoff_id") or ""),
            channel=str(payload.get("channel") or "").casefold(),
            identity=HotLeadIdentity(
                name=_optional_text(identity_raw.get("name")),
                phone=_optional_text(identity_raw.get("phone")),
                email=_optional_text(identity_raw.get("email")),
            ),
            service_id=str(payload.get("service_id") or ""),
            readiness=HotLeadReadiness(
                evidence_excerpt=str(readiness_raw.get("evidence_excerpt") or ""),
                signal=str(readiness_raw.get("signal") or ""),
            ),
            source=str(payload.get("source") or HOT_LEAD_SOURCE),
            schema_version=str(payload.get("schema_version") or HOT_LEAD_HANDOFF_SCHEMA_VERSION),
            sales_profile_snapshot=dict(snapshot),
            customer_location=_optional_text(payload.get("customer_location")),
            person_id=_optional_text(payload.get("person_id")),
        )


def _reject_calendar_keys(mapping: Mapping[str, Any], owner: str) -> None:
    present = _CALENDAR_KEYS.intersection(mapping)
    if present:
        raise HotLeadRejected(
            "already_on_calendar",
            f"{owner} must not include a calendar slot; CRM books the hour",
        )


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise HotLeadRejected("invalid_request", "Expected a string field")
    stripped = value.strip()
    return stripped or None


def _unfreeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _unfreeze(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_unfreeze(item) for item in value]
    return value


@dataclass(frozen=True, slots=True)
class HotLeadAcceptResult:
    business_id: str
    case_id: str
    lead_id: str
    current_state: str
    service_id: str
    waiting_channel: str
    duplicate: bool
    booking_id: None = None

    def as_stored(self) -> dict[str, Any]:
        return {
            "business_id": self.business_id,
            "case_id": self.case_id,
            "lead_id": self.lead_id,
            "current_state": self.current_state,
            "service_id": self.service_id,
            "waiting_channel": self.waiting_channel,
            "booking_id": self.booking_id,
        }
