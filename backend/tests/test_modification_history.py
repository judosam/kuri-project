import pytest
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.record_service import (
    record_qc_history,
    record_field_history,
    record_telecaller_history,
)


def test_qc_history_caps_at_five_revisions(db_session):
    record = CaptureRecord(name="Test Record", description="Test", status="NOT_COMPLETED", source="manual")
    db_session.add(record)
    db_session.commit()

    user = User(email="auditor1@test.com", password_hash="dummy", role=UserRole.AUDITOR, full_name="Auditor One")
    db_session.add(user)
    db_session.commit()

    # Perform 7 modifications
    for i in range(1, 8):
        record_qc_history(
            record,
            user=user,
            qc_vhr_comment=f"VHR Revision {i}",
            audit_status="APPROVAL" if i % 2 == 0 else "RE_AUDITED",
            qc_sqfeet=str(1000 + i * 100),
        )

    # Must be capped at exactly 5
    assert len(record.qc_history) == 5
    # Newest must be index 0
    assert record.qc_history[0]["qc_vhr_comment"] == "VHR Revision 7"
    assert record.qc_history[1]["qc_vhr_comment"] == "VHR Revision 6"
    assert record.qc_history[2]["qc_vhr_comment"] == "VHR Revision 5"
    assert record.qc_history[3]["qc_vhr_comment"] == "VHR Revision 4"
    assert record.qc_history[4]["qc_vhr_comment"] == "VHR Revision 3"


def test_field_history_caps_at_five_revisions(db_session):
    record = CaptureRecord(name="Test Field Record", description="Test", status="NOT_COMPLETED", source="manual")
    db_session.add(record)
    db_session.commit()

    user = User(email="field1@test.com", password_hash="dummy", role=UserRole.FIELD_VERIFIER, full_name="Field Verifier One")
    db_session.add(user)
    db_session.commit()

    for i in range(1, 7):
        record_field_history(
            record,
            user=user,
            status="Updated Revisited",
            stage_of_construction=f"Floor Slab {i}",
            remarks=f"Field visit note {i}",
            updated_coordinates=f"11.000{i}, 76.000{i}",
        )

    assert len(record.field_history) == 5
    assert record.field_history[0]["stage_of_construction"] == "Floor Slab 6"
    assert record.field_history[4]["stage_of_construction"] == "Floor Slab 2"
    assert record.field_history[0]["user_name"] == "Field Verifier One"


def test_telecaller_history_caps_at_five_revisions(db_session):
    record = CaptureRecord(name="Test TC Record", description="Test", status="NOT_COMPLETED", source="manual")
    db_session.add(record)
    db_session.commit()

    user = User(email="tc1@test.com", password_hash="dummy", role=UserRole.TELECALLER, full_name="Telecaller One")
    db_session.add(user)
    db_session.commit()

    for i in range(1, 8):
        record_telecaller_history(
            record,
            user=user,
            telecaller_status=f"STATUS_{i}",
            telecaller_comment=f"Call result {i}",
            telecaller_no_of_floors=f"G+{i}",
        )

    assert len(record.telecaller_history) == 5
    assert record.telecaller_history[0]["telecaller_status"] == "STATUS_7"
    assert record.telecaller_history[0]["telecaller_no_of_floors"] == "G+7"
    assert record.telecaller_history[4]["telecaller_status"] == "STATUS_3"


def test_api_record_update_persists_and_returns_history(client, admin_token, db_session):
    from tests.test_activity_logs import auth_header

    # Create record
    res = client.post(
        "/api/records",
        headers=auth_header(admin_token),
        json={"name": "History API Site", "description": "Desc", "photos": []},
    )
    assert res.status_code == 201
    rec_id = res.json()["id"]

    # 1. Update QC
    client.put(
        f"/api/admin/records/{rec_id}",
        headers=auth_header(admin_token),
        json={"qc_vhr_comment": "First QC VHR", "audit_status": "APPROVAL"},
    )
    res_qc2 = client.put(
        f"/api/admin/records/{rec_id}",
        headers=auth_header(admin_token),
        json={"qc_vhr_comment": "Second QC VHR", "audit_status": "RE_AUDITED"},
    )
    assert res_qc2.status_code == 200
    data = res_qc2.json()
    assert len(data["qc_history"]) == 2
    assert data["qc_history"][0]["qc_vhr_comment"] == "Second QC VHR"
    assert data["qc_history"][1]["qc_vhr_comment"] == "First QC VHR"

    # 2. Update Field Verification
    res_field = client.put(
        f"/api/admin/records/{rec_id}",
        headers=auth_header(admin_token),
        json={"stage_of_construction": "Roof Plastering", "remarks": "Almost done"},
    )
    assert res_field.status_code == 200
    data = res_field.json()
    assert len(data["field_history"]) >= 1
    assert data["field_history"][0]["stage_of_construction"] == "Roof Plastering"

    # 3. Update Telecaller
    res_tc = client.put(
        f"/api/admin/records/{rec_id}",
        headers=auth_header(admin_token),
        json={"telecaller_status": "CALL_CONNECTED", "telecaller_no_of_floors": "G+3"},
    )
    assert res_tc.status_code == 200
    data = res_tc.json()
    assert len(data["telecaller_history"]) >= 1
    assert data["telecaller_history"][0]["telecaller_status"] == "CALL_CONNECTED"
    assert data["telecaller_history"][0]["telecaller_no_of_floors"] == "G+3"
