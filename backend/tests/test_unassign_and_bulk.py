import pytest
from app.models.user import User, UserRole
from app.models.capture_record import CaptureRecord
from app.core.security import create_access_token, hash_password


def test_bulk_unassign_endpoints_and_admin_direct_assignment(client, db_session, test_admin):
    # Create test verifier and auditor in the session
    verifier = User(
        email="verifier_unassign@example.com",
        password_hash=hash_password("verpass123"),
        full_name="Verifier Unassign",
        role=UserRole.FIELD_VERIFIER,
        is_active=True,
    )
    auditor = User(
        email="auditor_unassign@example.com",
        password_hash=hash_password("audpass123"),
        full_name="Auditor Unassign",
        role=UserRole.AUDITOR,
        is_active=True,
    )
    db_session.add_all([verifier, auditor])
    db_session.commit()
    db_session.refresh(verifier)
    db_session.refresh(auditor)

    # Create a fresh pending record for testing
    test_rec = CaptureRecord(
        name="Test Unassign Lead",
        description="Testing bulk unassign",
        status="NOT_COMPLETED",
        source="manual",
        audit_status="PENDING",
        user_id=verifier.id,
        assigned_auditor_id=auditor.id,
    )
    db_session.add(test_rec)
    db_session.commit()
    db_session.refresh(test_rec)
    rec_id = test_rec.id

    admin_token = create_access_token({"sub": str(test_admin.id), "email": test_admin.email, "role": test_admin.role.value})
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Test unassign auditor
    r_un_aud = client.post(
        "/api/admin/records/unassign-auditor",
        json={"record_ids": [rec_id]},
        headers=headers,
    )
    assert r_un_aud.status_code == 200
    assert r_un_aud.json()["success"] is True
    assert r_un_aud.json()["unassigned_count"] == 1

    db_session.refresh(test_rec)
    assert test_rec.assigned_auditor_id is None

    # 2. Test unassign verifier
    r_un_ver = client.post(
        "/api/admin/records/unassign-verifier",
        json={"record_ids": [rec_id]},
        headers=headers,
    )
    assert r_un_ver.status_code == 200
    assert r_un_ver.json()["success"] is True
    assert r_un_ver.json()["unassigned_count"] == 1

    db_session.refresh(test_rec)
    assert test_rec.user_id is None
    assert test_rec.assigned_at is None

    # 3. Test assign verifier directly by admin to unassigned lead (even with audit_status PENDING)
    test_rec.audit_status = "PENDING"
    db_session.commit()

    r_assign_ver = client.post(
        "/api/admin/records/assign-verifier",
        json={"record_ids": [rec_id], "verifier_id": verifier.id},
        headers=headers,
    )
    assert r_assign_ver.status_code == 200
    assert r_assign_ver.json()["success"] is True
    assert r_assign_ver.json()["reassigned_count"] == 1

    db_session.refresh(test_rec)
    assert test_rec.user_id == verifier.id
    assert test_rec.audit_status == "APPROVAL"
