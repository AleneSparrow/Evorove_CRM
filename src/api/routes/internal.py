"""Operator-triggered internal tasks -- not part of the tenant-facing API.

Currently three endpoints behind the same secret: stalled-lead follow-up,
CRM/SMS outbox delivery, and commercial expiry. See DEPLOY.md.
"""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header

from src.domain.models import utc_now
from src.persistence.commercial_expiry import CommercialExpirySweep
from src.persistence.crm_webhook_service import CrmWebhookService
from src.persistence.cycle_command_delivery import CycleCommandDeliveryService
from src.persistence.follow_up_service import FollowUpSweepResult, PersistentFollowUpRunner
from src.persistence.sms_service import SmsService

from ..dependencies import ApplicationContainer, get_container
from ..errors import UnauthorizedError

router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _require_task_secret(container: ApplicationContainer, provided: str | None) -> None:
    configured = container.settings.internal_task_secret
    if not configured:
        raise UnauthorizedError("Internal task endpoints are not enabled on this deployment")
    if not provided or not hmac.compare_digest(provided, configured):
        raise UnauthorizedError("Invalid or missing internal task secret")


@router.post(
    "/follow-up/run",
    summary="Run a proactive stalled-lead follow-up sweep across every business",
)
def run_follow_up_sweep(
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, int]:
    _require_task_secret(container, x_internal_task_secret)
    sms_service = SmsService(
        container.unit_of_work_factory,
        account_sid=container.settings.twilio_account_sid,
        auth_token=container.settings.twilio_auth_token,
        public_api_base_url=container.settings.public_api_base_url,
    )
    runner = PersistentFollowUpRunner(container.unit_of_work_factory, sms_service)
    result: FollowUpSweepResult = runner.run(utc_now())
    return {
        "businesses_scanned": result.businesses_scanned,
        "cases_considered": result.cases_considered,
        "follow_ups_sent": result.follow_ups_sent,
        "follow_ups_skipped_stale": result.follow_ups_skipped_stale,
    }


@router.post(
    "/integrations/deliver",
    summary="Deliver due CRM and SMS-reply outbox rows",
)
def deliver_integration_outbox(
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, int]:
    _require_task_secret(container, x_internal_task_secret)
    crm = CrmWebhookService(container.unit_of_work_factory).deliver_due()
    sms_service = SmsService(
        container.unit_of_work_factory,
        account_sid=container.settings.twilio_account_sid,
        auth_token=container.settings.twilio_auth_token,
        public_api_base_url=container.settings.public_api_base_url,
    )
    sms = sms_service.deliver_due()
    commands = CycleCommandDeliveryService(
        container.unit_of_work_factory,
        evorove_base_url=container.settings.evorove_base_url,
        internal_task_secret=container.settings.internal_task_secret,
    ).deliver_due()
    return {
        "attempted": crm["attempted"] + sms["attempted"] + commands["attempted"],
        "sent": crm["sent"] + sms["sent"] + commands["sent"],
        "failed": crm["failed"] + sms["failed"] + commands["failed"],
    }


@router.post(
    "/commercial/expire",
    summary="Expire due quotes and payment requests across tenants",
)
def expire_due_commercial_items(
    container: Annotated[ApplicationContainer, Depends(get_container)],
    x_internal_task_secret: Annotated[str | None, Header()] = None,
) -> dict[str, int]:
    _require_task_secret(container, x_internal_task_secret)
    return CommercialExpirySweep(container.unit_of_work_factory).run(utc_now())
