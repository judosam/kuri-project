import pytest
from app.core.security import hash_password
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.auth_service import AuthService
from tests.conftest import auth_header

def test_field_verifier_can_view_duplicate_proximity_record_read_only(client, db_session):
    """Field verifier can view (read-only) a duplicate or nearby record, but cannot mutate it."""
    # 1. Create two verifiers
    auth_svc = AuthService(db_session)
    
    verifier_a = User(
        email="verifier_a@test.com",
        full_name="Verifier A",
        role=UserRole.FIELD_VERIFIER,
        is_active=True,
        password_hash=hash_password("pass123"),
    )
    
    verifier_b = User(
        email="verifier_b@test.com",
        full_name="Verifier B",
        role=UserRole.FIELD_VERIFIER,
        is_active=True,
        password_hash=hash_password("pass123"),
    )
    
    db_session.add_all([verifier_a, verifier_b])
    db_session.commit()
    db_session.refresh(verifier_a)
    db_session.refresh(verifier_b)

    token_a = auth_svc.create_token(verifier_a)
    headers_a = auth_header(token_a)

    # 2. Record A assigned to Verifier A at (11.000000, 77.000000)
    rec_a = CaptureRecord(
        name="Assigned Task A",
        unique_id="CBE-TASK-A",
        user_id=verifier_a.id,
        coordinates="11.000000, 77.000000",
        status="NOT_COMPLETED",
        audit_status="APPROVAL",
    )

    # Record B (visited site) assigned to Verifier B at 16m away (11.000100, 77.000100)
    rec_b_nearby = CaptureRecord(
        name="Visited Duplicate Site B",
        unique_id="CBE-VISITED-B",
        user_id=verifier_b.id,
        coordinates="11.000100, 77.000100",
        status="COMPLETED",
        audit_status="APPROVAL",
    )

    # Record C far away at (12.000000, 78.000000)
    rec_c_far = CaptureRecord(
        name="Far Away Site C",
        unique_id="CBE-FAR-C",
        user_id=verifier_b.id,
        coordinates="12.000000, 78.000000",
        status="COMPLETED",
        audit_status="APPROVAL",
    )

    db_session.add_all([rec_a, rec_b_nearby, rec_c_far])
    db_session.commit()
    db_session.refresh(rec_a)
    db_session.refresh(rec_b_nearby)
    db_session.refresh(rec_c_far)

    # 3. Verifier A can read their own record A
    res_a = client.get(f"/api/records/{rec_a.id}", headers=headers_a)
    assert res_a.status_code == 200

    # 4. Verifier A CAN read nearby duplicate reference record B (read-only)
    res_b = client.get(f"/api/records/{rec_b_nearby.id}", headers=headers_a)
    assert res_b.status_code == 200, f"Expected 200 reading duplicate record, got {res_b.status_code}: {res_b.text}"
    assert res_b.json()["unique_id"] == "CBE-VISITED-B"

    # 5. Verifier A CANNOT read far away record C (403 Forbidden)
    res_c = client.get(f"/api/records/{rec_c_far.id}", headers=headers_a)
    assert res_c.status_code == 403, f"Expected 403 reading far away record, got {res_c.status_code}"

    # 6. Verifier A CANNOT mutate duplicate reference record B (403 Forbidden on write)
    res_mark = client.post(
        f"/api/records/{rec_b_nearby.id}/mark-status",
        json={"status": "Duplicate", "remarks": "Trying to edit"},
        headers=headers_a,
    )
    assert res_mark.status_code == 403, f"Expected 403 mutating duplicate record, got {res_mark.status_code}"
