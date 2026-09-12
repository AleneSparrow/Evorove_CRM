"""Accept lead touches onto the owner board and issue commands back to engines."""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import datetime
from typing import Any, Mapping
from uuid import uuid4

from src.domain.lead_touch import (
    ACTIVE_BOARD_TABS,
    BoardCommand,
    BoardCommandAction,
    BoardPerson,
    BoardTab,
    LeadTouch,
    LeadTouchAcceptResult,
    LeadTouchKind,
    LeadTouchRejected,
    StoredLeadTouch,
    next_board_tab,
)
from src.domain.models import ProcessCase, utc_now
from src.domain.states import ProcessState
from src.persistence.errors import IdempotencyCollisionError
from src.persistence.hypothesis_outcome_client import HypothesisOutcomeReporter, reporter_from_env
from src.persistence.repositories import UnitOfWork, UnitOfWorkFactory
from src.persistence.sqlalchemy_models import IntegrationOutboxRow


CYCLE_COMMAND_OUTBOX_KIND = "cycle_command"

# Phase 3: "Done" is BOOKED or PAID (the same two states lead_touch.py's own
# _KIND_TAB already calls BoardTab.DONE); an explicit drop is LOST (covers
# "quote expired"/"quote declined" -- the contract's dropped/STOP/timeout)
# or CANCELLED (booking cancelled). Not COMPLETED: it always follows PAID
# for the same case, so counting it too would double-report one outcome.
_OUTCOME_FOR_PROCESS_STATE: Mapping[ProcessState, str] = {
    ProcessState.BOOKED: "done",
    ProcessState.PAID: "done",
    ProcessState.LOST: "dropped",
    ProcessState.CANCELLED: "dropped",
}


class PersistentLeadTouchService:
    def __init__(
        self,
        unit_of_work_factory: UnitOfWorkFactory,
        hypothesis_outcome_reporter: HypothesisOutcomeReporter | None = None,
    ) -> None:
        self._unit_of_work_factory = unit_of_work_factory
        self._hypothesis_outcome_reporter = (
            hypothesis_outcome_reporter if hypothesis_outcome_reporter is not None else reporter_from_env()
        )

    def accept(self, touch: LeadTouch) -> LeadTouchAcceptResult:
        with self._unit_of_work_factory() as uow:
            result = self.accept_in_unit_of_work(uow, touch)
            uow.commit()
            return result

    def accept_in_unit_of_work(self, uow: UnitOfWork, touch: LeadTouch) -> LeadTouchAcceptResult:
        business = uow.businesses.get(touch.business_id)
        if business is None:
            raise KeyError(f"unknown business_id: {touch.business_id}")
        existing = uow.board.get_touch(touch.business_id, touch.touch_id)
        fingerprint = _fingerprint(touch)
        if existing is not None:
            stored = (existing.payload or {}).get("fingerprint")
            if stored != fingerprint:
                raise IdempotencyCollisionError("lead touch replay does not match the stored event")
            person = uow.board.get_person(touch.business_id, existing.person_id)
            if person is None:
                raise RuntimeError("stored lead touch has no person card")
            return LeadTouchAcceptResult(
                business_id=touch.business_id,
                person_id=person.person_id,
                tab=person.tab,
                touch_id=touch.touch_id,
                kind=touch.kind,
                duplicate=True,
            )

        occurred = touch.occurred_at
        person = uow.board.get_person(touch.business_id, touch.person_id, for_update=True)
        if person is None:
            if touch.kind is LeadTouchKind.COMMAND_APPLIED:
                raise LeadTouchRejected("unknown_person", "Unknown person on the board")
            tab = next_board_tab(BoardTab.COLD, touch.kind)
            person = BoardPerson(
                business_id=touch.business_id,
                person_id=touch.person_id,
                tab=tab,
                name=touch.identity.name,
                phone=touch.identity.phone,
                email=touch.identity.email,
                summary=touch.summary,
                last_kind=touch.kind,
                last_cycle=touch.cycle,
                last_touch_at=occurred,
                paused=touch.kind is LeadTouchKind.STOPPED,
                version=0,
            )
            uow.board.add_person(person, created_at=occurred)
        else:
            expected = person.version
            tab = next_board_tab(person.tab, touch.kind)
            paused = True if touch.kind is LeadTouchKind.STOPPED else person.paused
            person = replace(
                person,
                tab=tab,
                name=person.name or touch.identity.name,
                phone=person.phone or touch.identity.phone,
                email=person.email or touch.identity.email,
                summary=touch.summary,
                last_kind=touch.kind,
                last_cycle=touch.cycle,
                last_touch_at=occurred,
                paused=paused,
            )
            uow.board.save_person(person, expected, updated_at=occurred)

        stored_touch = StoredLeadTouch(
            business_id=touch.business_id,
            person_id=touch.person_id,
            touch_id=touch.touch_id,
            cycle=touch.cycle,
            kind=touch.kind,
            source=touch.source,
            summary=touch.summary,
            occurred_at=occurred,
            payload={**dict(touch.payload), "fingerprint": fingerprint},
        )
        uow.board.add_touch(stored_touch, created_at=occurred)
        return LeadTouchAcceptResult(
            business_id=touch.business_id,
            person_id=touch.person_id,
            tab=person.tab,
            touch_id=touch.touch_id,
            kind=touch.kind,
            duplicate=False,
        )

    def record_case_state(
        self,
        uow: UnitOfWork,
        case: ProcessCase,
        target: ProcessState,
        occurred_at: datetime,
    ) -> None:
        person_id = _person_id_for_case(case)
        if person_id is None:
            return

        kind = _kind_for_process_state(target)
        if kind is not None:
            try:
                self.accept_in_unit_of_work(
                    uow,
                    LeadTouch(
                        business_id=case.business_id,
                        touch_id=f"cycle3:{kind.value}:{case.case_id}",
                        person_id=person_id,
                        cycle=3,
                        kind=kind,
                        source="evorove_crm",
                        summary=_summary_for_kind(kind),
                        occurred_at=occurred_at,
                        identity=_identity_from_lead(case),
                        payload={"case_id": case.case_id, "process_state": target.value},
                    ),
                )
            except (LeadTouchRejected, KeyError, IdempotencyCollisionError, RuntimeError):
                pass

        outcome = _OUTCOME_FOR_PROCESS_STATE.get(target)
        if outcome is not None:
            self._report_hypothesis_outcome(uow, case, person_id, outcome)

    def _report_hypothesis_outcome(
        self, uow: UnitOfWork, case: ProcessCase, person_id: str, outcome: str
    ) -> None:
        """Non-PII only: business_id, hypothesis_id, case_id, outcome. No name or contact."""

        hypothesis_id = self._hypothesis_id_for_person(uow, case.business_id, person_id)
        if not hypothesis_id:
            return
        self._hypothesis_outcome_reporter.report(
            business_id=case.business_id,
            hypothesis_id=hypothesis_id,
            case_id=case.case_id,
            outcome=outcome,
        )

    @staticmethod
    def _hypothesis_id_for_person(uow: UnitOfWork, business_id: str, person_id: str) -> str:
        """The hypothesis that produced this person, from their original ASSEMBLED touch.

        Later touches (dialogue, offer, booked, paid) don't carry it forward
        themselves -- it lives once, on the touch cycle 1 sent when this
        person first landed on Cold.
        """

        for touch in uow.board.list_touches(business_id, person_id):
            if touch.kind is LeadTouchKind.ASSEMBLED:
                value = (touch.payload or {}).get("hypothesis_id")
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return ""

    def list_tab(self, business_id: str, tab: BoardTab) -> tuple[BoardPerson, ...]:
        if tab not in ACTIVE_BOARD_TABS:
            raise LeadTouchRejected("invalid_tab", "Unknown board tab")
        with self._unit_of_work_factory() as uow:
            if uow.businesses.get(business_id) is None:
                raise KeyError(f"unknown business_id: {business_id}")
            return uow.board.list_people(business_id, tab)

    def get_person(
        self, business_id: str, person_id: str
    ) -> tuple[BoardPerson, tuple[StoredLeadTouch, ...], tuple[BoardCommand, ...]]:
        with self._unit_of_work_factory() as uow:
            person = uow.board.get_person(business_id, person_id)
            if person is None:
                raise KeyError(f"unknown person_id: {person_id}")
            touches = uow.board.list_touches(business_id, person_id)
            commands = uow.board.list_commands(business_id, person_id)
            return person, touches, commands

    def issue_command(
        self,
        business_id: str,
        person_id: str,
        action: BoardCommandAction,
        payload: Mapping[str, Any] | None = None,
        *,
        approved_by: str,
    ) -> BoardCommand:
        body = dict(payload or {})
        now = utc_now()
        command_id = str(uuid4())
        with self._unit_of_work_factory() as uow:
            person = uow.board.get_person(business_id, person_id, for_update=True)
            if person is None:
                raise KeyError(f"unknown person_id: {person_id}")
            expected = person.version
            if action is BoardCommandAction.DISCARD:
                person = replace(person, tab=BoardTab.DISCARDED, last_kind=LeadTouchKind.COMMAND_APPLIED)
            elif action is BoardCommandAction.PAUSE_OUTREACH:
                person = replace(person, paused=True, last_kind=LeadTouchKind.COMMAND_APPLIED)
            elif action is BoardCommandAction.CORRECT_IDENTITY:
                person = replace(
                    person,
                    name=_optional_overwrite(person.name, body.get("name")),
                    phone=_optional_overwrite(person.phone, body.get("phone")),
                    email=_optional_overwrite(person.email, body.get("email")),
                    last_kind=LeadTouchKind.COMMAND_APPLIED,
                )
            elif action is BoardCommandAction.TAKEOVER:
                person = replace(person, last_kind=LeadTouchKind.COMMAND_APPLIED)
            person = replace(person, last_touch_at=now, last_cycle=3, summary=_command_summary(action))
            uow.board.save_person(person, expected, updated_at=now)
            command = BoardCommand(
                business_id=business_id,
                command_id=command_id,
                person_id=person_id,
                action=action,
                payload={**body, "approved_by": approved_by},
                created_at=now,
                status="pending",
            )
            uow.board.add_command(command)
            uow.board.add_touch(
                StoredLeadTouch(
                    business_id=business_id,
                    person_id=person_id,
                    touch_id=f"command:{command_id}",
                    cycle=3,
                    kind=LeadTouchKind.COMMAND_APPLIED,
                    source="evorove_crm",
                    summary=_command_summary(action),
                    occurred_at=now,
                    payload={"action": action.value, "approved_by": approved_by},
                ),
                created_at=now,
            )
            session = getattr(uow, "session", None)
            if session is not None:
                session.add(
                    IntegrationOutboxRow(
                        id=f"cycle-command:{command_id}",
                        business_id=business_id,
                        kind=CYCLE_COMMAND_OUTBOX_KIND,
                        payload={
                            "command_id": command_id,
                            "person_id": person_id,
                            "action": action.value,
                            "payload": dict(command.payload),
                            "phone": person.phone,
                            "email": person.email,
                            "name": person.name,
                        },
                        status="PENDING",
                        attempt_count=0,
                        next_attempt_at=now,
                        last_error=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
            uow.commit()
            return command


def _fingerprint(touch: LeadTouch) -> str:
    encoded = json.dumps(touch.fingerprint_payload(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _kind_for_process_state(state: ProcessState) -> LeadTouchKind | None:
    mapping = {
        ProcessState.QUOTED: LeadTouchKind.OFFER_SENT,
        ProcessState.BOOKED: LeadTouchKind.BOOKED,
        ProcessState.PAID: LeadTouchKind.PAID,
    }
    return mapping.get(state)


def _summary_for_kind(kind: LeadTouchKind) -> str:
    return {
        LeadTouchKind.OFFER_SENT: "Offer sent",
        LeadTouchKind.BOOKED: "Appointment booked",
        LeadTouchKind.PAID: "Payment received",
    }[kind]


def _command_summary(action: BoardCommandAction) -> str:
    return {
        BoardCommandAction.DISCARD: "Removed from the board",
        BoardCommandAction.CORRECT_IDENTITY: "Contact details corrected",
        BoardCommandAction.PAUSE_OUTREACH: "Outreach paused",
        BoardCommandAction.TAKEOVER: "Owner took over the conversation",
    }[action]


def _person_id_for_case(case: ProcessCase) -> str | None:
    from src.domain.lead_touch import LeadTouchRejected, stable_person_id

    stored = case.lead.attributes.get("person_id")
    existing = stored if isinstance(stored, str) else None
    try:
        return stable_person_id(
            case.business_id,
            phone=case.lead.phone,
            email=case.lead.email,
            person_id=existing,
        )
    except LeadTouchRejected:
        return None


def _identity_from_lead(case: ProcessCase):
    from src.domain.lead_touch import LeadTouchIdentity

    return LeadTouchIdentity(name=case.lead.name, phone=case.lead.phone, email=case.lead.email)


def _optional_overwrite(current: str | None, incoming: Any) -> str | None:
    if not isinstance(incoming, str) or not incoming.strip():
        return current
    return incoming.strip()
