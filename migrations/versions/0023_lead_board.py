"""Owner board: people, lead touches, and commands back to cycle engines."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

JSON_TYPE = sa.JSON(none_as_null=True).with_variant(
    postgresql.JSONB(none_as_null=True), "postgresql"
)


def upgrade() -> None:
    op.create_table(
        "board_people",
        sa.Column("business_id", sa.String(128), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("person_id", sa.String(128), nullable=False),
        sa.Column("tab", sa.String(32), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("last_kind", sa.String(32), nullable=False),
        sa.Column("last_cycle", sa.Integer(), nullable=False),
        sa.Column("last_touch_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("business_id", "person_id"),
        sa.CheckConstraint(
            "tab IN ('cold','in_work','offer_sent','done','discarded')",
            name="ck_board_people_tab",
        ),
        sa.CheckConstraint("version >= 0", name="ck_board_people_version_nonnegative"),
    )
    op.create_index(
        "ix_board_people_business_tab",
        "board_people",
        ["business_id", "tab", "last_touch_at"],
    )
    op.create_table(
        "board_touches",
        sa.Column("business_id", sa.String(128), nullable=False),
        sa.Column("touch_id", sa.String(255), nullable=False),
        sa.Column("person_id", sa.String(128), nullable=False),
        sa.Column("cycle", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id", "person_id"],
            ["board_people.business_id", "board_people.person_id"],
            ondelete="CASCADE",
            name="fk_board_touches_person",
        ),
        sa.PrimaryKeyConstraint("business_id", "touch_id"),
        sa.CheckConstraint("cycle IN (1, 2, 3)", name="ck_board_touches_cycle"),
    )
    op.create_index(
        "ix_board_touches_person",
        "board_touches",
        ["business_id", "person_id", "occurred_at"],
    )
    op.create_table(
        "board_commands",
        sa.Column("business_id", sa.String(128), nullable=False),
        sa.Column("command_id", sa.String(128), nullable=False),
        sa.Column("person_id", sa.String(128), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id", "person_id"],
            ["board_people.business_id", "board_people.person_id"],
            ondelete="CASCADE",
            name="fk_board_commands_person",
        ),
        sa.PrimaryKeyConstraint("business_id", "command_id"),
        sa.CheckConstraint(
            "action IN ('discard','correct_identity','pause_outreach','takeover')",
            name="ck_board_commands_action",
        ),
        sa.CheckConstraint("status IN ('pending','delivered','failed')", name="ck_board_commands_status"),
    )


def downgrade() -> None:
    op.drop_table("board_commands")
    op.drop_index("ix_board_touches_person", table_name="board_touches")
    op.drop_table("board_touches")
    op.drop_index("ix_board_people_business_tab", table_name="board_people")
    op.drop_table("board_people")
