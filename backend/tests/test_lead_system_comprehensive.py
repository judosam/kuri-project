import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database.connection import SessionLocal
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.auth_service import AuthService
from app.services.record_service import RecordService
import io
import openpyxl

@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()

@pytest.fixture
def client():
    return TestClient(app)

def test_corrected_lead_location(db):
    """Lead CBE-110154-769878 must be located in Coimbatore, NOT Harur/Dharmapuri."""
    lead = db.query(CaptureRecord).filter(CaptureRecord.unique_id == "CBE-110154-769878").first()
    assert lead is not None, "Lead CBE-110154-769878 must exist"
    assert lead.district == "Coimbatore", f"Expected district Coimbatore, got {lead.district}"
    assert lead.taluk == "Coimbatore North", f"Expected taluk Coimbatore North, got {lead.taluk}"
    assert lead.village == "Pappanaickenpalayam", f"Expected village Pappanaickenpalayam, got {lead.village}"
    assert "Harur" not in (lead.taluk or "")
    assert "Dharmapuri" not in (lead.district or "")

def test_dashboard_reconciliation(db):
    """Total records (751) must reconcile exactly with Completed + Closed + Disapproved + Pending."""
    svc = RecordService(db)
    metrics = svc.get_dashboard_metrics()
    overview = metrics.get("overview") or {}

    total = overview.get("total_records")
    completed = overview.get("completed_verifications")
    closed = overview.get("closed_verifications")
    disapproved = overview.get("disapproved_verifications")
    pending = overview.get("pending_verifications")

    assert total == 751
    assert completed == 599
    assert closed == 60
    assert disapproved == 1
    assert pending == 91
    assert completed + closed + disapproved + pending == total
    assert metrics.get("pending_records") == pending

def test_strict_rbac_matrix(db, client):
    """Strict server-side RBAC: each role accesses only its authorized endpoints, others get 403."""
    auth_svc = AuthService(db)
    admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
    auditor = db.query(User).filter(User.role == UserRole.AUDITOR).first()
    telecaller = db.query(User).filter(User.role == UserRole.TELECALLER).first()
    verifier = db.query(User).filter(User.role == UserRole.FIELD_VERIFIER).first()

    tokens = {
        "admin": auth_svc.create_token(admin),
        "auditor": auth_svc.create_token(auditor),
        "telecaller": auth_svc.create_token(telecaller),
        "verifier": auth_svc.create_token(verifier),
    }

    # Admin Dashboard
    assert client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {tokens['admin']}"}).status_code == 200
    assert client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {tokens['auditor']}"}).status_code == 403
    assert client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {tokens['telecaller']}"}).status_code == 403
    assert client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {tokens['verifier']}"}).status_code == 403

    # Telecaller Records
    assert client.get("/api/telecaller/records", headers={"Authorization": f"Bearer {tokens['telecaller']}"}).status_code == 200
    assert client.get("/api/telecaller/records", headers={"Authorization": f"Bearer {tokens['auditor']}"}).status_code == 403
    assert client.get("/api/telecaller/records", headers={"Authorization": f"Bearer {tokens['verifier']}"}).status_code == 403

    # QA Dashboard
    assert client.get("/api/admin/qa-dashboard", headers={"Authorization": f"Bearer {tokens['auditor']}"}).status_code == 200
    assert client.get("/api/admin/qa-dashboard", headers={"Authorization": f"Bearer {tokens['telecaller']}"}).status_code == 403
    assert client.get("/api/admin/qa-dashboard", headers={"Authorization": f"Bearer {tokens['verifier']}"}).status_code == 403

def test_templates_without_visit_order(db, client):
    """Excel templates must not contain visit_order and must include construction fields."""
    auth_svc = AuthService(db)
    admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
    token = auth_svc.create_token(admin)

    # 1. New leads dispatch template
    r1 = client.get("/api/admin/records/template", headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 200
    wb1 = openpyxl.load_workbook(io.BytesIO(r1.content))
    ws1 = wb1.active
    headers1 = [cell.value for cell in ws1[1]]
    assert "visit_order" not in headers1
    assert "stage_of_construction" in headers1
    assert "no_of_floors" in headers1
    assert "built_up_area" in headers1
    assert "expected_completion" in headers1

    # 2. Bulk edit template
    r2 = client.get("/api/admin/records/bulk-edit/template", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    wb2 = openpyxl.load_workbook(io.BytesIO(r2.content))
    ws2 = wb2.active
    headers2 = [cell.value for cell in ws2[1]]
    assert "unique_id" in headers2
    assert "visit_order" not in headers2
    assert "stage_of_construction" in headers2

def test_telecaller_history_table_format(db, client):
    """Telecaller comments must be split into and saved as table format, not raw paragraphs."""
    from app.services.telecaller_comment_service import (
        parse_comment_to_rows,
        format_rows_to_table,
        append_call_log_entry,
    )

    # 1. Test parsing legacy paragraph format into table rows
    legacy_sample = (
        "[26 Oct 2026, 01:19 PM - Ajithkumar M (Connected Follow Up | Stage: Additional Floor Construction)]\n"
        "Spoke with Sarathi, who is the owner. He said he is interested in solar and would like us to meet him."
    )
    rows = parse_comment_to_rows(legacy_sample)
    assert len(rows) == 1
    assert rows[0]["caller"] == "Ajithkumar M"
    assert rows[0]["status"] == "Connected Follow Up"
    assert "Additional Floor Construction" in rows[0]["details"]
    assert "Spoke with Sarathi" in rows[0]["note"]

    # 2. Test formatting to table format
    tbl = format_rows_to_table(rows)
    assert tbl.startswith("| Date & Time | Caller | Call Status | Stage / Details | Notes / Discussion |")
    assert "| Ajithkumar M | Connected Follow Up |" in tbl

    # 3. Test appending entry returns table format
    appended = append_call_log_entry(
        existing_comment=tbl,
        caller_name="Samuel P",
        status="Construction Confirmed",
        details="Stage: Completed Building",
        note="Customer confirmed completion",
        timestamp_str="27 Oct 2026, 03:00 PM"
    )
    assert "| Samuel P | Construction Confirmed |" in appended
    roundtrip = parse_comment_to_rows(appended)
    assert len(roundtrip) == 2
    assert roundtrip[1]["caller"] == "Samuel P"

    # 4. Test API endpoint saves as table format
    auth_svc = AuthService(db)
    telecaller = db.query(User).filter(User.role == UserRole.TELECALLER).first()
    token = auth_svc.create_token(telecaller)

    record = db.query(CaptureRecord).filter(CaptureRecord.contact_number.isnot(None)).first()
    assert record is not None

    res = client.post(
        f"/api/telecaller/records/{record.id}/feedback",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "telecaller_status": "CONNECTED_FOLLOW_UP",
            "telecaller_comment": "Testing automated table format saving",
            "stage_of_construction": "Additional Floor Construction",
            "follow_up_date": "2026-11-05",
            "overwrite_comment": False
        }
    )
    assert res.status_code == 200
    data = res.json()
    saved_comment = data["telecaller_comment"]
    assert saved_comment is not None
    assert saved_comment.startswith("| Date & Time | Caller |")
    assert "Testing automated table format saving" in saved_comment
    assert "Connected Follow Up" in saved_comment


def test_auto_reassign_on_field_follow_up_date(client, db):
    """When field verifier sets follow_up_date, record must auto-reassign for revisit."""
    auth_svc = AuthService(db)
    verifier = db.query(User).filter(User.role == UserRole.FIELD_VERIFIER).first()
    if not verifier:
        verifier = db.query(User).filter(User.role == UserRole.USER).first()
    token = auth_svc.create_token(verifier)

    record = CaptureRecord(
        user_id=verifier.id,
        name="Auto Reassign Test Site",
        source="captured",
        unique_id="TEST-AUTOREASSIGN-001",
        status="NOT_COMPLETED",
        coordinates="11.012345, 76.987654",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        res = client.post(
            "/api/records",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "task_id": record.id,
                "name": "Auto Reassign Test Site",
                "date_of_visit": "2026-10-27",
                "stage_of_construction": "Roof slab",
                "no_of_floors": "G+2",
                "built_up_area": "3,200 sq.ft",
                "expected_completion": "Dec 2026",
                "follow_up_date": "2026-11-15",
                "remarks": "Site progressing well, revisit scheduled",
                "photos": [],
            },
        )
        assert res.status_code == 201
        db.refresh(record)
        assert record.follow_up_date == "2026-11-15"
        assert record.revisit_status == "PENDING_REVISIT"
        assert record.reassigned_to_id == verifier.id
        assert record.reassigned_at is not None
        assert record.no_of_floors == "G+2"
        assert record.built_up_area == "3,200 sq.ft"
        assert record.expected_completion == "Dec 2026"
        assert record.updated_by_id == verifier.id
    finally:
        db.delete(record)
        db.commit()


def test_cumulative_road_distance_km_removed():
    """cumulative_road_distance_km must be completely removed from CaptureRecord model."""
    assert not hasattr(CaptureRecord, "cumulative_road_distance_km")


def test_excel_export_updater_attribution_and_floors(client, db):
    """Excel export must include No. of Floors, Built-up Area, Expected Completion, and Updater Attribution."""
    admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
    auth_svc = AuthService(db)
    token = auth_svc.create_token(admin)

    res = client.get(
        "/api/admin/records/export",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    sheet = wb["Inspections Report"]
    headers = [cell.value for cell in sheet[1]]

    assert "No. of Floors" in headers
    assert "Built-up Area" in headers
    assert "Expected Completion" in headers
    assert "Data Updated By (Role)" in headers
    assert "Data Updated By (Name)" in headers
    assert "Data Updated Date" in headers
    assert "Road Distance (km)" not in headers
