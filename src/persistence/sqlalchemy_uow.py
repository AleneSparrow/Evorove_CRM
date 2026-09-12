"""SQLAlchemy Unit of Work and engine construction."""

from collections.abc import Callable

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .sqlalchemy_repositories import (
    SQLAlchemyBillingWebhookEventRepository,
    SQLAlchemyBusinessDNARepository,
    SQLAlchemyBusinessRepository,
    SQLAlchemyBookingRepository,
    SQLAlchemyBoardRepository,
    SQLAlchemyConversationMessageRepository,
    SQLAlchemyConversationRepository,
    SQLAlchemyCrmWebhookConnectionRepository,
    SQLAlchemyFollowUpDeliveryRepository,
    SQLAlchemyIdempotencyRepository,
    SQLAlchemyLeadRepository,
    SQLAlchemyPaymentRequestRepository,
    SQLAlchemyProcessCaseRepository,
    SQLAlchemyProcessEventRepository,
    SQLAlchemyQuoteRepository,
    SQLAlchemySalesKnowledgeRepository,
    SQLAlchemySalesObjectionRepository,
    SQLAlchemySalesPlaybookRepository,
    SQLAlchemySalesProfileRepository,
    SQLAlchemySalesTurnRepository,
    SQLAlchemySmsConnectionRepository,
    SQLAlchemyStaffSessionRepository,
    SQLAlchemyStaffSecurityRepository,
    SQLAlchemyStaffUserRepository,
)


def create_database_engine(database_url: str, *, echo: bool = False) -> Engine:
    engine = create_engine(
        database_url,
        echo=echo,
        future=True,
        hide_parameters=True,
        pool_pre_ping=True,
    )
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection: object, connection_record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    return engine


class SQLAlchemyUnitOfWork:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory
        self.session: Session | None = None

    @classmethod
    def factory_for_engine(cls, engine: Engine) -> Callable[[], "SQLAlchemyUnitOfWork"]:
        sessions = sessionmaker(bind=engine, expire_on_commit=False, future=True)
        return lambda: cls(sessions)

    def __enter__(self) -> "SQLAlchemyUnitOfWork":
        self.session = self._session_factory()
        self.businesses = SQLAlchemyBusinessRepository(self.session)
        self.business_dna = SQLAlchemyBusinessDNARepository(self.session)
        self.leads = SQLAlchemyLeadRepository(self.session)
        self.events = SQLAlchemyProcessEventRepository(self.session)
        self.cases = SQLAlchemyProcessCaseRepository(self.session, self.events)
        self.idempotency = SQLAlchemyIdempotencyRepository(self.session)
        self.conversations = SQLAlchemyConversationRepository(self.session)
        self.conversation_messages = SQLAlchemyConversationMessageRepository(self.session)
        self.bookings = SQLAlchemyBookingRepository(self.session)
        self.quotes = SQLAlchemyQuoteRepository(self.session)
        self.payment_requests = SQLAlchemyPaymentRequestRepository(self.session)
        self.staff_users = SQLAlchemyStaffUserRepository(self.session)
        self.staff_sessions = SQLAlchemyStaffSessionRepository(self.session)
        self.staff_security = SQLAlchemyStaffSecurityRepository(self.session)
        self.crm_webhook_connections = SQLAlchemyCrmWebhookConnectionRepository(self.session)
        self.sms_connections = SQLAlchemySmsConnectionRepository(self.session)
        self.billing_webhook_events = SQLAlchemyBillingWebhookEventRepository(self.session)
        self.follow_up_deliveries = SQLAlchemyFollowUpDeliveryRepository(self.session)
        self.sales_profiles = SQLAlchemySalesProfileRepository(self.session)
        self.sales_turns = SQLAlchemySalesTurnRepository(self.session)
        self.sales_knowledge = SQLAlchemySalesKnowledgeRepository(self.session)
        self.sales_playbooks = SQLAlchemySalesPlaybookRepository(self.session)
        self.sales_objections = SQLAlchemySalesObjectionRepository(self.session)
        self.board = SQLAlchemyBoardRepository(self.session)
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self.session is None:
            return
        if exc_type is not None:
            self.session.rollback()
        elif self.session.in_transaction():
            self.session.rollback()
        self.session.close()
        self.session = None

    def commit(self) -> None:
        if self.session is None:
            raise RuntimeError("Unit of Work is not active")
        self.session.commit()

    def rollback(self) -> None:
        if self.session is None:
            raise RuntimeError("Unit of Work is not active")
        self.session.rollback()
