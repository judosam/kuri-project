import pytest
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.capture_record import CaptureRecord
from tests.conftest import auth_header

def test_field_verifier_record_sets_qc_status_not_applicable(client, db_session, test_user, user_token, admin_token):
    # 1. Field verifier creates a new record directly
    payload = {
        "name": "Field Discovery Site",
        "description": "Found active residential construction during field tour",
        "construction_happening": "Yes",
        "type_of_construction": "Residential Individual House",
        "stage_of_construction": "Brickwork / Blockwork",
        "building_user_name": "Rangaraj",
        "contact_number": "9876543210",
        "field_gps": {
            "latitude": 11.0234,
            "longitude": 76.9543,
            "location_accuracy": 5.0,
            "captured_at": 1730620800000,
        },
        "photos": []
    }

    create_resp = client.post("/api/records", json=payload, headers=auth_header(user_token))
    assert create_resp.status_code == 201, create_resp.text
    record_data = create_resp.json()
    record_id = record_data["id"]

    # Assert record properties directly from response
    assert record_data["source"] == "manual"
    assert record_data["qc_status"] == "Not Applicable"
    assert record_data["audit_status"] == "NOT_APPLICABLE"
    assert record_data["assigned_auditor_id"] is None

    # Verify directly in DB
    db_rec = db_session.query(CaptureRecord).filter(CaptureRecord.id == record_id).first()
    assert db_rec is not None
    assert db_rec.qc_status == "Not Applicable"
    assert db_rec.audit_status == "NOT_APPLICABLE"
    assert db_rec.assigned_auditor_id is None

    # 2. Query admin records for QA (for_qa=True) - MUST NOT BE IN QA PORTAL
    qa_list_resp = client.get("/api/admin/records?for_qa=true", headers=auth_header(admin_token))
    assert qa_list_resp.status_code == 200
    qa_records = qa_list_resp.json()["records"]
    assert all(r["id"] != record_id for r in qa_records)
    assert all(r["qc_status"] != "Not Applicable" for r in qa_records)

    # 3. Create an auditor user and test auditor login
    auditor = User(
        email="auditor@example.com",
        password_hash=hash_password("auditorpass123"),
        full_name="Desk Auditor",
        role=UserRole.AUDITOR,
        is_active=True,
    )
    db_session.add(auditor)
    db_session.commit()

    login_resp = client.post("/api/auth/login", json={"email": "auditor@example.com", "password": "auditorpass123"})
    assert login_resp.status_code == 200
    auditor_token = login_resp.json()["access_token"]

    # Auditor view defaults to for_qa=True internally
    auditor_records_resp = client.get("/api/admin/records", headers=auth_header(auditor_token))
    assert auditor_records_resp.status_code == 200
    auditor_records = auditor_records_resp.json()["records"]
    assert all(r["id"] != record_id for r in auditor_records)

    # 4. QA Dashboard check - must not include Not Applicable in counts
    qa_dash_resp = client.get("/api/admin/qa-dashboard", headers=auth_header(auditor_token))
    assert qa_dash_resp.status_code == 200
    dash_data = qa_dash_resp.json()
    assert dash_data["total"] == 0
    assert dash_data["pending"] == 0

    # 5. Admin standard view (for_qa=False) - record is visible
    admin_all_resp = client.get(f"/api/admin/records?search={db_rec.unique_id}", headers=auth_header(admin_token))
    assert admin_all_resp.status_code == 200
    admin_records = admin_all_resp.json()["records"]
    matching = [r for r in admin_records if r["id"] == record_id]
    assert len(matching) == 1
    assert matching[0]["qc_status"] == "Not Applicable"
    assert matching[0]["audit_status"] == "NOT_APPLICABLE"

    # 6. Admin can filter by qc_status=NOT_APPLICABLE
    na_filter_resp = client.get("/api/admin/records?qc_status=NOT_APPLICABLE", headers=auth_header(admin_token))
    assert na_filter_resp.status_code == 200
    na_records = na_filter_resp.json()["records"]
    assert any(r["id"] == record_id for r in na_records)
