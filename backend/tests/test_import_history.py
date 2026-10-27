import io

import openpyxl
import pytest

from tests.conftest import auth_header


def _sheet(rows: list[dict]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(list(rows[0].keys()))
    for r in rows:
        ws.append(list(r.values()))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def field_user(db_session):
    from app.core.security import hash_password
    from app.models.user import User, UserRole

    u = User(
        email="hist.op@example.com",
        password_hash=hash_password("pass12345"),
        full_name="Hist Op",
        role=UserRole.USER,
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


def test_history_mode_creates_completed_records(client, admin_token, field_user):
    content = _sheet([
        {
            "operator_email": "hist.op@example.com",
            "unique_id": "UID-001",
            "coordinates": "11.0168, 76.9558",
            "site_address": "12 Main St",
            "date_of_visit": "2026-09-01",
            "construction_happening": "Yes",
            "remarks": "Old work done before launch",
        }
    ])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("hist.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mode": "history"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is True
    assert data["mode"] == "history"
    assert data["total_dispatched"] == 1
    rec_id = data["created_ids"][0]
    assert data["record_coordinates"][str(rec_id)] == "11.0168, 76.9558"

    detail = client.get(f"/api/records/{rec_id}", headers=auth_header(admin_token)).json()
    assert detail["status"] == "COMPLETED"
    assert detail["unique_id"] == "UID-001"
    assert detail["date_of_visit"] == "2026-09-01"
    assert detail["construction_happening"] == "Yes"
    assert detail["remarks"] == "Old work done before launch"


def test_history_photo_upload_watermarks_and_names(client, admin_token, field_user):
    content = _sheet([
        {
            "operator_email": "hist.op@example.com",
            "unique_id": "UID-002",
            "coordinates": "11.0168, 76.9558",
            "site_address": "14 Main St",
        }
    ])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("hist.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mode": "history"},
        headers=auth_header(admin_token),
    )
    rec_id = res.json()["created_ids"][0]

    # Tiny valid JPEG (1x1 red pixel)
    from PIL import Image

    img_buf = io.BytesIO()
    Image.new("RGB", (1, 1), (255, 0, 0)).save(img_buf, format="JPEG")
    jpg = img_buf.getvalue()

    up = client.post(
        f"/api/records/{rec_id}/upload",
        files=[("files", ("photo1.jpg", jpg, "image/jpeg"))],
        data={"latitudes": "11.0168", "longitudes": "76.9558"},
        headers=auth_header(admin_token),
    )
    assert up.status_code == 200, up.text
    detail = up.json()
    assert detail["status"] == "COMPLETED"
    assert len(detail["images"]) == 1
    assert detail["images"][0]["file_name"] == f"Record_{rec_id}_Photo_1.jpg"

    img_bytes = client.get(
        f"/api/records/{rec_id}/image/{detail['images'][0]['id']}",
        headers=auth_header(admin_token),
    ).content
    stored = Image.open(io.BytesIO(img_bytes))
    assert stored.format == "JPEG"
    assert stored.width >= 1 and stored.height >= 1


def test_invalid_mode_rejected(client, admin_token):
    content = _sheet([{"operator_email": "hist.op@example.com", "site_address": "x"}])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("h.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mode": "bogus"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400


def test_dispatch_mode_default_unchanged(client, admin_token, field_user):
    content = _sheet([
        {"operator_email": "hist.op@example.com", "unique_id": "UID-003", "site_address": "16 Main St"}
    ])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("tasks.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "dispatch"
    rec_id = data["created_ids"][0]
    detail = client.get(f"/api/records/{rec_id}", headers=auth_header(admin_token)).json()
    assert detail["status"] == "NOT_COMPLETED"
    # Audit workflow: dispatch tasks are staged for audit, not assigned.
    assert detail["audit_status"] == "PENDING"
    assert detail["user_id"] is None
