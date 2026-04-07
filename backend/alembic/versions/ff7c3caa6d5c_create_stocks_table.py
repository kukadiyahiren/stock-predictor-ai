"""create_stocks_table

Revision ID: ff7c3caa6d5c
Revises: 
Create Date: 2026-04-07 11:44:53.209557

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ff7c3caa6d5c'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'stocks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=50), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stocks_id'), 'stocks', ['id'], unique=False)
    op.create_index(op.f('ix_stocks_name'), 'stocks', ['name'], unique=False)
    op.create_index(op.f('ix_stocks_symbol'), 'stocks', ['symbol'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_stocks_symbol'), table_name='stocks')
    op.drop_index(op.f('ix_stocks_name'), table_name='stocks')
    op.drop_index(op.f('ix_stocks_id'), table_name='stocks')
    op.drop_table('stocks')
