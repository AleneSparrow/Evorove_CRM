"""Optional observed pain and its validation state on owner board cards."""

from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("board_people", sa.Column("observed_pain", sa.Text(), nullable=True))
    op.add_column("board_people", sa.Column("pain_status", sa.String(32), nullable=False, server_default="none"))
    op.create_check_constraint(
        "ck_board_people_observed_pain_length",
        "board_people",
        "observed_pain IS NULL OR length(observed_pain) <= 500",
    )


def downgrade() -> None:
    op.drop_constraint("ck_board_people_observed_pain_length", "board_people", type_="check")
    op.drop_column("board_people", "pain_status")
    op.drop_column("board_people", "observed_pain")
