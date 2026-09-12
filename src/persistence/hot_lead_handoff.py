"""Accept a hot lead from Evorove into cycle 3 without running a sale.

Creates or reuses a tenant-scoped lead, walks ProcessEngine to QUALIFIED,
and leaves the hour unset. CommercialWorkflowService remains the path that
collects zone/fields and books a specific slot.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import uuid4

from src.domain.events import EventType
from src.domain.hot_lead import (
    HOT_LEAD_IDEMPOTENCY_CHANNEL,
    HotLeadAcceptResult,
    HotLeadHandoff,
    HotLeadRejected,
)
from src.domain.models import DecisionType, Lead, ProcessCase, ProcessEvent
from src.domain.lead_touch import LeadTouch, LeadTouchIdentity, LeadTouchKind, stable_person_id
from src.domain.states import ProcessState
from src.engine.commercial import find_service
from src.engine.decision_router import DecisionRequest
from src.engine.lead_intake import LeadIntakeService
from src.engine.process_engine import ProcessEngine
from src.persistence.lead_touch_service import PersistentLeadTouchService
from src.persistence.errors import IdempotencyInProgressError
from src.persistence.repositories import ClaimStatus, UnitOfWork, UnitOfWorkFactory


_ADVANCE = {
    ProcessState.NEW_LEAD: (ProcessState.CONTACTED, ProcessState.QUALIFYING, ProcessState.QUALIFIED),
    ProcessState.CONTACTED: (ProcessState.QUALIFYING, ProcessState.QUALIFIED),
    ProcessState.QUALIFYING: (ProcessState.QUALIFIED,),
    ProcessState.QUALIFIED: (),
}
_OPEN_AFTER_INTAKE = (
    ProcessState.QUALIFIED,
    ProcessState.BOOKED,
    ProcessState.QUOTED,
    ProcessState.FOLLOW_UP,
    ProcessState.WON,
)


class PersistentHotLeadHandoffService:
    def __init__(
        self,
        unit_of_work_factory: UnitOfWorkFactory,
        process_engine: ProcessEngine | None = None,
    ) -> None:
        self.unit_of_work_factory = unit_of_work_factory
        self.process_engine = process_engine or ProcessEngine()

    def accept(self, handoff: HotLeadHandoff, *, occurred_at: datetime | None = None) -> HotLeadAcceptResult:
        occurred = occurred_at or datetime.now(timezone.utc)
        if occurred.tzinfo is None or occurred.utcoffset() is None:
            raise ValueError("occurred_at must be timezone-aware")
        with self.unit_of_work_factory() as uow:
            result = self.accept_in_unit_of_work(uow, handoff, occurred_at=occurred)
            uow.commit()
            return result

    def accept_in_unit_of_work(
        self,
        uow: UnitOfWork,
        handoff: HotLeadHandoff,
        *,
        occurred_at: datetime,
    ) -> HotLeadAcceptResult:
        fingerprint = self.fingerprint(handoff)
        business = uow.businesses.get(handoff.business_id)
        if business is None:
            raise KeyError(f"unknown business_id: {handoff.business_id}")
        claim_status, claim = uow.idempotency.claim(
            handoff.business_id,
            HOT_LEAD_IDEMPOTENCY_CHANNEL,
            handoff.handoff_id,
            fingerprint,
        )
        if claim_status is ClaimStatus.COMPLETED:
            if claim.result is None or claim.case_id is None:
                raise IdempotencyInProgressError("completed handoff has no persisted result")
            return self._deserialize_result(claim.result, duplicate=True)

        dna_version = uow.business_dna.get_active(handoff.business_id)
        if dna_version is None:
            raise RuntimeError(f"business has no active Business DNA: {handoff.business_id}")
        dna = self._plain_json(dna_version.configuration)
        try:
            find_service(dna, handoff.service_id)
        except ValueError as exc:
            raise HotLeadRejected(
                "unknown_service",
                "Agreed service is not in this business's catalog",
            ) from exc

        phone = LeadIntakeService._normalize_phone(handoff.identity.phone)
        email = LeadIntakeService._normalize_email(handoff.identity.email)
        person_id = stable_person_id(
            handoff.business_id, phone=phone, email=email, person_id=handoff.person_id
        )
        self._lock_identities(uow, handoff.business_id, phone, email)

        try:
            existing_lead = uow.leads.find_by_identity(handoff.business_id, phone, email)
        except ValueError as exc:
            raise HotLeadRejected(
                "identity_conflict",
                "Phone and email belong to different existing leads",
            ) from exc
        if existing_lead is not None:
            lead, lead_created = self._merge_lead(existing_lead, handoff, phone, email, person_id), False
        else:
            lead = self._new_lead(handoff, phone, email, person_id)
            lead_created = True

        active = None if lead_created else self._existing_case(uow, handoff.business_id, lead.lead_id)
        if active is not None and active.current_state is ProcessState.NEEDS_HUMAN:
            raise HotLeadRejected(
                "human_hold",
                "This person is already with a human; CRM will not auto-advance the hold",
            )
        if active is not None and uow.bookings.get_for_case(active.business_id, active.case_id) is not None:
            raise HotLeadRejected(
                "already_on_calendar",
                "This person already has a calendar hour; a hot lead must not",
            )
        if active is not None and active.current_state not in _ADVANCE:
            raise HotLeadRejected(
                "case_not_receivable",
                "This case is past intake and cannot accept a hot-lead handoff",
            )
        case_created = active is None
        if active is None:
            case = ProcessCase(
                str(uuid4()),
                handoff.business_id,
                lead,
                is_test=business.test_mode_enabled,
            )
        else:
            case = active
            case.update_lead(lead)

        existing_event_count = len(case.event_history)
        expected_version = case.version
        self._stamp_handoff(case, handoff)
        self._advance_to_qualified(case, handoff, occurred_at)

        if lead_created:
            uow.leads.add(handoff.business_id, lead, case.created_at)
        else:
            uow.leads.save(handoff.business_id, lead, case.updated_at)
        if case_created:
            uow.cases.add(case)
        else:
            uow.cases.save(case, expected_version)
        uow.events.add_many(
            handoff.business_id,
            case.case_id,
            case.event_history[existing_event_count:],
        )
        PersistentLeadTouchService(self.unit_of_work_factory).accept_in_unit_of_work(
            uow,
            LeadTouch(
                business_id=handoff.business_id,
                touch_id=f"ready-to-book:{handoff.handoff_id}",
                person_id=person_id,
                cycle=2,
                kind=LeadTouchKind.READY_TO_BOOK,
                source="evorove",
                summary="Ready to book",
                occurred_at=occurred_at,
                identity=LeadTouchIdentity(
                    name=handoff.identity.name,
                    phone=phone,
                    email=email,
                ),
                payload={"handoff_id": handoff.handoff_id, "service_id": handoff.service_id},
            ),
        )
        result = HotLeadAcceptResult(
            business_id=handoff.business_id,
            case_id=case.case_id,
            lead_id=lead.lead_id,
            current_state=case.current_state.value,
            service_id=handoff.service_id,
            waiting_channel=handoff.channel,
            duplicate=False,
        )
        uow.idempotency.complete(
            handoff.business_id,
            HOT_LEAD_IDEMPOTENCY_CHANNEL,
            handoff.handoff_id,
            case.case_id,
            result.as_stored(),
        )
        return result

    @staticmethod
    def _existing_case(uow: UnitOfWork, business_id: str, lead_id: str) -> ProcessCase | None:
        active = uow.cases.find_active_for_lead(business_id, lead_id)
        if active is not None:
            return active
        for case in uow.cases.list_by_state(business_id, _OPEN_AFTER_INTAKE, limit=500):
            if case.lead.lead_id == lead_id:
                return case
        return None

    def fingerprint(self, handoff: HotLeadHandoff) -> str:
        canonical = json.dumps(
            handoff.fingerprint_payload(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _advance_to_qualified(
        self,
        case: ProcessCase,
        handoff: HotLeadHandoff,
        occurred_at: datetime,
    ) -> None:
        targets = _ADVANCE.get(case.current_state)
        if targets is None:
            raise HotLeadRejected(
                "case_not_receivable",
                "This case is past intake and cannot accept a hot-lead handoff",
            )
        received = ProcessEvent(
            EventType.HOT_LEAD_RECEIVED,
            event_id=f"hot-lead:{handoff.business_id}:{handoff.handoff_id}:received",
            occurred_at=occurred_at,
            source="evorove",
            payload={
                "handoff_id": handoff.handoff_id,
                "service_id": handoff.service_id,
                "channel": handoff.channel,
                "readiness_signal": handoff.readiness.signal,
            },
        )
        if case.current_state is ProcessState.NEW_LEAD:
            first, *rest = targets
            self.process_engine.receive(
                case,
                received,
                DecisionRequest(DecisionType.RULE, first),
            )
            targets = rest
        else:
            case.record(received)
        for index, target in enumerate(targets):
            self.process_engine.receive(
                case,
                ProcessEvent(
                    EventType.TRIGGER_RECEIVED,
                    event_id=f"hot-lead:{handoff.business_id}:{handoff.handoff_id}:advance:{index}",
                    occurred_at=occurred_at,
                    source="evorove",
                    payload={"reason": "hot_lead_accepted", "target": target.value},
                ),
                DecisionRequest(DecisionType.RULE, target),
            )
        if case.current_state is not ProcessState.QUALIFIED:
            raise RuntimeError("hot-lead handoff did not reach QUALIFIED")

    @staticmethod
    def _stamp_handoff(case: ProcessCase, handoff: HotLeadHandoff) -> None:
        case.metadata["hot_lead_handoff"] = True
        case.metadata["hot_lead_handoff_id"] = handoff.handoff_id
        case.metadata["waiting_channel"] = handoff.channel
        case.metadata["readiness_evidence"] = handoff.readiness.evidence_excerpt
        case.metadata["sales_profile_snapshot"] = dict(handoff.sales_profile_snapshot)

    @staticmethod
    def _new_lead(
        handoff: HotLeadHandoff, phone: str | None, email: str | None, person_id: str
    ) -> Lead:
        attributes: dict[str, Any] = {
            "service_requested": handoff.service_id,
            "person_id": person_id,
        }
        if handoff.customer_location:
            attributes["customer_location"] = handoff.customer_location
        return Lead(
            str(uuid4()),
            handoff.identity.name,
            email,
            phone,
            attributes,
        )

    @staticmethod
    def _merge_lead(
        existing: Lead,
        handoff: HotLeadHandoff,
        phone: str | None,
        email: str | None,
        person_id: str,
    ) -> Lead:
        attributes = dict(existing.attributes)
        attributes["service_requested"] = handoff.service_id
        attributes["person_id"] = existing.attributes.get("person_id") or person_id
        if handoff.customer_location and "customer_location" not in attributes:
            attributes["customer_location"] = handoff.customer_location
        return Lead(
            existing.lead_id,
            existing.name or handoff.identity.name,
            existing.email or email,
            existing.phone or phone,
            attributes,
            sms_consent=existing.sms_consent,
        )

    @staticmethod
    def _lock_identities(
        uow: UnitOfWork,
        business_id: str,
        phone: str | None,
        email: str | None,
    ) -> None:
        for identity_type, value in sorted(
            (kind, item) for kind, item in (("phone", phone), ("email", email)) if item
        ):
            uow.leads.lock_identity(business_id, identity_type, value)

    @staticmethod
    def _deserialize_result(stored: Mapping[str, Any], *, duplicate: bool) -> HotLeadAcceptResult:
        return HotLeadAcceptResult(
            business_id=str(stored["business_id"]),
            case_id=str(stored["case_id"]),
            lead_id=str(stored["lead_id"]),
            current_state=str(stored["current_state"]),
            service_id=str(stored["service_id"]),
            waiting_channel=str(stored["waiting_channel"]),
            duplicate=duplicate,
            booking_id=None,
        )

    @staticmethod
    def _plain_json(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {str(key): PersistentHotLeadHandoffService._plain_json(item) for key, item in value.items()}
        if isinstance(value, tuple | list):
            return [PersistentHotLeadHandoffService._plain_json(item) for item in value]
        return value
