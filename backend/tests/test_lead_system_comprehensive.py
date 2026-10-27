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
