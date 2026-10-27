import io
from datetime import datetime, timezone
import openpyxl
import pytest

from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.core.security import hash_password, create_access_token


@pytest.fixture
def field_verifier_2(db_session):
    user = User(
        email="verifier2@example.com",
        password_hash=hash_password("Password123!"),
        full_name="Verifier Two",
        role=UserRole.FIELD_VERIFIER,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def field_verifier_2_token(client, field_verifier_2):
    response = client.post(
        "/api/auth/login",
        json={"email": "verifier2@example.com", "password": "Password123!"},
    )
    return response.json()["access_token"]


def test_excel_export_organized_order(client, admin_token, test_user, field_verifier_2, db_session):
    """Excel export columns must strictly follow:
    Imported Data -> DC Data -> Field Verifier Data -> Telecaller Data -> Reassign Columns
    """
    record = CaptureRecord(
        user_id=test_user.id,
        name="Excel Order Test Site",
        source="captured",
        unique_id="CBE-999001",
        coordinates="11.016844, 76.955832",
        site_address="123 Trichy Road",
        village="Singanallur",
        taluk="Coimbatore South",
        district="Coimbatore",
        status="Updated Revisited",
        audit_status="RE_AUDITED",
        qc_vhr_comment="Cleared site",
        qc_street_details="Street view clear",
        qc_builder_contact="ABC Builders 9876543210",
        assigned_telecaller_id=test_user.id,
        telecaller_status="CONSTRUCTION_CONFIRMED",
        telecaller_comment="Confirmed by owner",
        reassigned_to_id=field_verifier_2.id,
        reassigned_at=datetime.now(timezone.utc),
        revisit_status="Updated Revisited",
        updated_coordinates="11.016900, 76.955900",
        updated_information="Revisit confirmed slab work in progress",
    )
    db_session.add(record)
    db_session.commit()

    res = client.get("/api/admin/records/export", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200

    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert "Inspections Report" in wb.sheetnames
    sheet = wb["Inspections Report"]
    headers = [cell.value for cell in sheet[1]]

    # 1. Imported Data (Planning fields)
    assert "Imported Coordinates" in headers
    assert "Village" in headers
    idx_imported = headers.index("Imported Coordinates")

    # 2. DC Data
    assert "QC Status" in headers
    assert "QC Comments (VHR Imagery)" in headers
    idx_dc = headers.index("QC Status")

    # 3. Field Verifier Data
    assert "Field Verifier" in headers
    assert "Verification Status" in headers
    idx_field = headers.index("Field Verifier")

    # 4. Telecaller Data
    assert "Assigned Telecaller" in headers
    assert "Telecaller Status" in headers
    idx_telecaller = headers.index("Assigned Telecaller")

    # 5. Reassign Columns
    assert "Reassigned Field Verifier" in headers
    assert "Reassign Date" in headers
    assert "Revisit Status" in headers
    assert "Updated Coordinates" in headers
    assert "Updated Information" in headers
    idx_reassign = headers.index("Reassigned Field Verifier")

    # Verify order: Imported Data -> DC Data -> Field Verifier Data -> Telecaller Data -> Reassign Columns
    assert idx_imported < idx_dc < idx_field < idx_telecaller < idx_reassign

    # Check row data
    row_values = dict(zip(headers, [cell.value for cell in sheet[2]]))
    assert row_values["Record Name"] == "Excel Order Test Site"
    assert row_values["QC Status"] == "Reaudited"
    assert row_values["Verification Status"] == "Completed"
    assert row_values["Revisit Status"] == "Updated Revisited"
    assert row_values["Updated Coordinates"] == "11.016900, 76.955900"
    assert row_values["Updated Information"] == "Revisit confirmed slab work in progress"


def test_reassign_completed_record_for_revisit_and_submission(
    client, admin_token, test_user, user_token, field_verifier_2, field_verifier_2_token, db_session
):
    """Admin reassigns completed record to field verifier; verifier inspects and submits; status becomes Updated Revisited."""
    # 1. Start with a completed record
    record = CaptureRecord(
        user_id=test_user.id,
        name="Completed Task For Revisit",
        status="COMPLETED",
        audit_status="APPROVAL",
        coordinates="11.012345, 76.987654",
        remarks="First visit remarks",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    # 2. Reassign to field verifier 2 via assign-verifier endpoint
    assign_res = client.post(
        "/api/admin/records/assign-verifier",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"record_ids": [record.id], "verifier_id": field_verifier_2.id},
    )
    assert assign_res.status_code == 200
    data = assign_res.json()
    assert data["success"] is True
    assert data["reassigned_count"] == 1

    # Verify state after reassignment: marked for revisit, pending in verifier's list
    db_session.refresh(record)
    assert record.user_id == field_verifier_2.id
    assert record.reassigned_to_id == field_verifier_2.id
    assert record.revisit_status == "REASSIGNED"
    assert record.status == "NOT_COMPLETED"

    # 3. Field verifier 2 completes the revisit inspection via POST /api/records
    submit_res = client.post(
        "/api/records",
        headers={"Authorization": f"Bearer {field_verifier_2_token}"},
        json={
            "task_id": record.id,
            "name": "Revisited Inspection Complete",
            "date_of_visit": "2026-10-13",
            "construction_happening": "Yes",
            "stage_of_construction": "Roof slab",
            "remarks": "Revisited site: construction progressing well",
            "field_gps": {
                "latitude": 11.012400,
                "longitude": 76.987700,
                "location_accuracy": 3.5,
            },
            "photos": [],
        },
    )
    assert submit_res.status_code == 201
    submit_data = submit_res.json()
    assert submit_data["status"] == "Updated Revisited"
    assert submit_data["revisit_status"] == "Updated Revisited"
    assert submit_data["updated_coordinates"] == "11.012400, 76.987700"
    assert "construction progressing well" in submit_data["updated_information"]


def test_qc_coordinates_edit_and_re_audited_status(client, admin_token, test_user, db_session):
    """In QC part, editing wrong coordinates updates coordinates and sets QC decision to RE_AUDITED."""
    record = CaptureRecord(
        user_id=test_user.id,
        name="QC Wrong Coordinates Site",
        status="COMPLETED",
        audit_status="APPROVAL",
        coordinates="11.000000, 76.000000",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    # Auditor edits coordinates and submits decision
    res = client.patch(
        f"/api/admin/records/{record.id}/audit",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "audit_status": "RE_AUDITED",
            "audit_comment": "Pin location corrected to exact survey boundary",
            "qc_vhr_comment": "Cleared site",
            "qc_street_details": "Road access verified",
            "coordinates": "11.016844, 76.955832",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["audit_status"] == "RE_AUDITED"
    assert data["coordinates"] == "11.016844, 76.955832"
    assert data["qc_vhr_comment"] == "Cleared site"

    db_session.refresh(record)
    assert record.audit_status == "RE_AUDITED"
    assert record.coordinates == "11.016844, 76.955832"


def test_reassign_to_qc_user_preserves_qc_details(
    client, admin_token, test_user, db_session
):
    """When reassigning records to QC user (auditor),
    all QC details, comments, and inspection data must be preserved.
    """
    # Create an auditor user
    auditor = User(
        email="qc_tester@example.com",
        password_hash=hash_password("Password123!"),
        full_name="QC Auditor User",
        role=UserRole.AUDITOR,
        is_active=True,
    )
    db_session.add(auditor)
    db_session.commit()
    db_session.refresh(auditor)

    # Record was previously completed, approved, and had QC done
    record = CaptureRecord(
        user_id=test_user.id,
        name="Previously Completed & Audited Record",
        status="COMPLETED",
        audit_status="APPROVAL",
        qc_completed_at=datetime.now(timezone.utc),
        qc_vhr_comment="Previously inspected and cleared",
        qc_street_details="Clear street view",
        qc_builder_contact="9876543210",
        assigned_auditor_id=auditor.id,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    # Reassign to same QC user
    res = client.post(
        "/api/admin/records/assign-auditor",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"record_ids": [record.id], "auditor_id": auditor.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["reassigned_count"] == 1

    # Verify state: auditor assigned, QC details and audit_status preserved
    db_session.refresh(record)
    assert record.assigned_auditor_id == auditor.id
    assert record.audit_status == "APPROVAL"
    assert record.qc_completed_at is not None
    assert record.qc_vhr_comment == "Previously inspected and cleared"
    assert record.qc_street_details == "Clear street view"
    assert record.qc_builder_contact == "9876543210"


def test_reassign_to_field_verifier_even_same_user_preserves_qc_and_sets_reassigned(
    client, admin_token, test_user, db_session
):
    """When reassigning records to Field Verifier even same user,
    Verification Status is NOT_COMPLETED and REASSIGNED, and QC details are fully preserved.
    """
    # Record was previously completed with QC done
    record = CaptureRecord(
        user_id=test_user.id,
        name="Completed Site For Same Verifier Reassign",
        status="COMPLETED",
        audit_status="APPROVAL",
        qc_completed_at=datetime.now(timezone.utc),
        qc_vhr_comment="QC done: active construction",
        qc_street_details="Excavation visible",
        qc_builder_contact="Site Engr 9988776655",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    # Reassign to same user
    res = client.post(
        "/api/admin/records/assign-verifier",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"record_ids": [record.id], "verifier_id": test_user.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["reassigned_count"] == 1

    # Both Verification Status and revisit_status must reflect reassigned, and QC details must NOT be wiped
    db_session.refresh(record)
    assert record.status == "NOT_COMPLETED"  # Verification Status: Pending / Reassigned
    assert record.revisit_status == "REASSIGNED"
    assert record.user_id == test_user.id
    assert record.reassigned_to_id == test_user.id

    # QC details and audit decision must NOT be wiped!
    assert record.audit_status == "APPROVAL"
    assert record.qc_completed_at is not None
    assert record.qc_vhr_comment == "QC done: active construction"
    assert record.qc_street_details == "Excavation visible"
    assert record.qc_builder_contact == "Site Engr 9988776655"
