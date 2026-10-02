import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from models.cooperative import Cooperative
from models.membership import CooperativeMembership
from models.user import User
from schemas.auth import UserRole


def test_same_user_can_have_distinct_roles_across_cooperatives(session):
    coop_a = Cooperative(
        name="Alpha Dairy",
        code="ALPHA-001",
        registration_number="REG-001",
        kra_pin="A000000001A",
        county="Nakuru",
        location="Naivasha",
    )
    coop_b = Cooperative(
        name="Beta Dairy",
        code="BETA-001",
        registration_number="REG-002",
        kra_pin="A000000002B",
        county="Kiambu",
        location="Thika",
    )
    user = User(
        email="member@example.com",
        password_hash="hashed",
        full_name="Same User",
        phone_number="+254700000001",
        role=UserRole.COOP_ADMIN,
        is_active=True,
    )
    session.add_all([coop_a, coop_b, user])
    session.commit()

    session.add_all([
        CooperativeMembership(
            cooperative_id=coop_a.id,
            user_id=user.id,
            role=UserRole.COOP_ADMIN.value,
            status="ACTIVE",
        ),
        CooperativeMembership(
            cooperative_id=coop_b.id,
            user_id=user.id,
            role=UserRole.MANAGER.value,
            status="ACTIVE",
        ),
    ])
    session.commit()

    count = session.query(CooperativeMembership).filter_by(user_id=user.id).count()
    assert count == 2

    duplicate = CooperativeMembership(
        cooperative_id=coop_a.id,
        user_id=user.id,
        role=UserRole.MANAGER.value,
        status="ACTIVE",
    )
    session.add(duplicate)
    with pytest.raises(IntegrityError):
        session.commit()
