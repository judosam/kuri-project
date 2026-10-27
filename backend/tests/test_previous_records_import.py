"""Tests for the Admin "Import Previous Records" workflow.

Covers the dedicated previous-records import (preview, validation, commit),
the Record Source flag on both workflows, and admin photo uploads that carry
the admin-side "Uploaded" stamp (never the field capture HUD).
"""

import io

import openpyxl
import pytest
from PIL import Image

from tests.conftest import auth_header
from tests.test_watermark import bottom_right_dark_pixels, telemetry_row_dark_pixels

SHEET_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# Canonical column order — every row is written against these headers so a
# sparse row can never shift a value into the wrong column.
HEADERS = [
    "operator_email",
    "unique_id",
    "visit_order",
    "coordinates",
    "site_address",
    "owner_name_en",
    "taluk",
    "village",
    "district",
    "date_of_visit",
    "construction_happening",
    "remarks",
]


def _sheet(rows: list[dict], title: str = "Previous Records") -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = title
    ws.append(HEADERS)
    for row in rows:
        ws.append([row.get(h, "") for h in HEADERS])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _jpeg(width: int = 900, height: int = 600, colour=(255, 255, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def legacy_operator(db_session):
    from app.core.security import hash_password
    from app.models.user import User, UserRole

    user = User(
        email="old.op@example.com",
        password_hash=hash_password("pass12345"),
        full_name="Old Operator",
        role=UserRole.USER,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


OLD_ROWS = [
    {
        "operator_email": "old.op@example.com",
        "unique_id": "OLD-001",
        "visit_order": "1",
        "coordinates": "11.0168, 76.9558",
        "site_address": "12 Main St",
        "owner_name_en": "Ravi Kumar",
        "taluk": "Coimbatore North",
        "village": "Saravanampatti",
        "district": "Coimbatore",
        "date_of_visit": "2024-05-11",
        "construction_happening": "yes",
        "remarks": "Completed before app rollout",
    },
    {
        "operator_email": "old.op@example.com",
        "unique_id": "OLD-002",
        "coordinates": "11.0200, 76.9600",
        "site_address": "14 Main St",
        "date_of_visit": "11-06-2024",
        "construction_happening": "No",
    },
    {
        "operator_email": "missing.op@example.com",
        "unique_id": "OLD-003",
        "coordinates": "not-a-coordinate",
        "site_address": "16 Main St",
        "date_of_visit": "sometime in 2024",
        "construction_happening": "maybe",
    },
]


# ── Preview ───────────────────────────────────────────────────────────
def test_preview_validates_every_row_without_writing(client, admin_token, legacy_operator):
    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["success"] is True
    assert data["total_rows"] == 3
    assert data["valid_count"] == 2
    assert data["invalid_count"] == 1
    assert data["sheet_name"] == "Previous Records"
    assert len(data["rows"]) == 3

    invalid = data["rows"][2]
    assert invalid["valid"] is False
    assert invalid["row"] == 4  # spreadsheet row number, header included
    columns = {e["column"] for e in invalid["errors"]}
    assert {"operator_email", "coordinates", "date_of_visit", "construction_happening"} <= columns
    assert all(e["row"] == 4 for e in data["errors"])

    # Dry run: nothing reached the records table yet.
    listed = client.get("/api/admin/records", headers=auth_header(admin_token)).json()
    assert listed["total"] == 0


def test_preview_normalizes_yes_no_and_keeps_raw_values(client, admin_token, legacy_operator):
    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    first = res.json()["rows"][0]
    assert first["construction_happening"] == "Yes"
    assert first["operator_name"] == "Old Operator"
    assert first["coordinates"] == "11.0168, 76.9558"


def test_preview_flags_duplicate_unique_ids(client, admin_token, legacy_operator):
    rows = [
        {
            "operator_email": "old.op@example.com",
            "unique_id": "DUP-1",
            "site_address": "A",
        },
        {
            "operator_email": "old.op@example.com",
            "unique_id": "DUP-1",
            "site_address": "B",
        },
    ]
    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("dupes.xlsx", _sheet(rows), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    data = res.json()
    assert data["valid_count"] == 1
    assert data["invalid_count"] == 1
    assert data["rows"][1]["errors"][0]["column"] == "unique_id"


# ── Whole-file validation ─────────────────────────────────────────────
def test_csv_is_rejected_with_excel_guidance(client, admin_token):
    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("records.csv", b"operator_email,site_address\n", "text/csv")},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400
    assert "Excel" in res.json()["detail"]


def test_unrecognized_sheet_is_rejected(client, admin_token):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["colour", "size"])
    ws.append(["red", "large"])
    buf = io.BytesIO()
    wb.save(buf)

    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("misc.xlsx", buf.getvalue(), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400
    assert "Unrecognized sheet format" in res.json()["detail"]


def test_field_operator_cannot_use_previous_records_import(client, user_token):
    res = client.post(
        "/api/admin/records/import-previous/preview",
        files={"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)},
        headers=auth_header(user_token),
    )
    assert res.status_code == 403


# ── Commit ────────────────────────────────────────────────────────────
def test_commit_imports_only_valid_rows_and_flags_source(client, admin_token, legacy_operator):
    res = client.post(
        "/api/admin/records/import-previous/commit",
        files={"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    report = res.json()
    assert report["success"] is True
    assert report["imported_count"] == 2
    assert report["skipped_count"] == 1
    assert len(report["errors"]) >= 1

    first_id = report["records"][0]["record_id"]
    detail = client.get(f"/api/admin/records/{first_id}", headers=auth_header(admin_token)).json()
    assert detail["source"] == "imported"
    assert detail["status"] == "COMPLETED"
    assert detail["unique_id"] == "OLD-001"
    assert detail["owner_name_en"] == "Ravi Kumar"
    assert detail["district"] == "Coimbatore"
    assert detail["date_of_visit"] == "2024-05-11"
    assert detail["construction_happening"] == "Yes"
    assert detail["remarks"] == "Completed before app rollout"

    # Same existing records table, clearly marked as uploaded.
    listed = client.get("/api/admin/records", headers=auth_header(admin_token)).json()
    assert listed["total"] == 2
    assert {r["source"] for r in listed["records"]} == {"imported"}


def test_commit_skips_rows_already_imported(client, admin_token, legacy_operator):
    payload = {"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)}
    client.post(
        "/api/admin/records/import-previous/commit",
        files=payload,
        headers=auth_header(admin_token),
    )
    second = client.post(
        "/api/admin/records/import-previous/commit",
        files={"file": ("old_records.xlsx", _sheet(OLD_ROWS), SHEET_MIME)},
        headers=auth_header(admin_token),
    ).json()

    # Every previously imported unique_id is now reported instead of duplicated.
    assert second["imported_count"] == 0
    assert second["skipped_count"] == 3
    listed = client.get("/api/admin/records", headers=auth_header(admin_token)).json()
    assert listed["total"] == 2


def test_history_mode_sheet_import_is_flagged_as_imported(client, admin_token, legacy_operator):
    """The pre-existing history backfill now reports itself as imported too."""
    content = _sheet([
        {
            "operator_email": "old.op@example.com",
            "unique_id": "HIST-1",
            "site_address": "18 Main St",
        }
    ])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("hist.xlsx", content, SHEET_MIME)},
        data={"mode": "history"},
        headers=auth_header(admin_token),
    )
    rec_id = res.json()["created_ids"][0]
    detail = client.get(f"/api/admin/records/{rec_id}", headers=auth_header(admin_token)).json()
    assert detail["source"] == "imported"


# ── Existing field workflow is untouched ──────────────────────────────
def test_direct_field_records_are_marked_manual(client, user_token, admin_token):
    res = client.post(
        "/api/records",
        json={
            "name": "Onsite capture",
            "description": "Captured by the field app",
            "photos": [
                {
                    "latitude": 11.0168,
                    "longitude": 76.9558,
                    "location_accuracy": 8.5,
                    "captured_at": "2026-09-20T10:00:00Z",
                    "file_name": "capture.jpg",
                }
            ],
        },
        headers=auth_header(user_token),
    )
    assert res.status_code == 201, res.text
    assert res.json()["source"] == "manual"
    assert res.json()["is_manually_added"] is True

    rec_id = res.json()["id"]
    detail = client.get(f"/api/records/{rec_id}", headers=auth_header(user_token)).json()
    assert detail["source"] == "manual"

    admin_detail = client.get(f"/api/admin/records/{rec_id}", headers=auth_header(admin_token)).json()
    assert admin_detail["source"] == "manual"


def test_dispatch_tasks_keep_captured_source(client, admin_token, legacy_operator):
    content = _sheet([
        {"operator_email": "old.op@example.com", "unique_id": "TASK-1", "site_address": "20 Main St"}
    ])
    res = client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("tasks.xlsx", content, SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    rec_id = res.json()["created_ids"][0]
    detail = client.get(f"/api/admin/records/{rec_id}", headers=auth_header(admin_token)).json()
    assert detail["source"] == "captured"
    assert detail["status"] == "NOT_COMPLETED"


# ── Imported-record photo upload ──────────────────────────────────────
def _import_one(client, admin_token, legacy_operator) -> int:
    res = client.post(
        "/api/admin/records/import-previous/commit",
        files={"file": ("old_records.xlsx", _sheet([OLD_ROWS[0]]), SHEET_MIME)},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    return res.json()["records"][0]["record_id"]


def test_admin_photo_upload_watermarks_imported_record(client, admin_token, legacy_operator):
    rec_id = _import_one(client, admin_token, legacy_operator)

    res = client.post(
        f"/api/admin/records/{rec_id}/photos",
        files=[("files", ("site.jpg", _jpeg(), "image/jpeg"))],
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["errors"] is None
    assert len(detail["images"]) == 1
    assert detail["images"][0]["file_name"] == f"Record_{rec_id}_Photo_1.jpg"

    stored = client.get(
        f"/api/admin/records/{rec_id}/image/{detail['images'][0]['id']}",
        headers=auth_header(admin_token),
    ).content
    image = Image.open(io.BytesIO(stored))
    assert image.format == "JPEG"
    # Admin-side upload is stamped "Uploaded" — never the device telemetry HUD,
    # because no device ever took this photo.
    assert bottom_right_dark_pixels(stored) > 0
    assert telemetry_row_dark_pixels(stored) == 0
    # Quality/aspect ratio preserved (900x600 source, no upscaling).
    assert image.size == (900, 600)

    # The GPS used comes from the admin-given coordinates of the old record.
    assert detail["images"][0]["latitude"] == pytest.approx(11.0168)
    assert detail["images"][0]["longitude"] == pytest.approx(76.9558)


def test_admin_photo_upload_appends_multiple_frames(client, admin_token, legacy_operator):
    rec_id = _import_one(client, admin_token, legacy_operator)

    first = client.post(
        f"/api/admin/records/{rec_id}/photos",
        files=[("files", ("a.jpg", _jpeg(), "image/jpeg"))],
        headers=auth_header(admin_token),
    ).json()
    second = client.post(
        f"/api/admin/records/{rec_id}/photos",
        files=[
            ("files", ("b.jpg", _jpeg(), "image/jpeg")),
            ("files", ("c.jpg", _jpeg(), "image/jpeg")),
        ],
        headers=auth_header(admin_token),
    ).json()

    orders = [img["photo_order"] for img in second["images"]]
    assert orders == [1, 2, 3]
    assert first["images"][0]["id"] == second["images"][0]["id"]
    assert len(second["images"]) == 3


def test_admin_photo_upload_rejects_bad_file_type(client, admin_token, legacy_operator):
    rec_id = _import_one(client, admin_token, legacy_operator)
    res = client.post(
        f"/api/admin/records/{rec_id}/photos",
        files=[("files", ("notes.txt", b"hello", "text/plain"))],
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    detail = res.json()
    assert detail["errors"] and "invalid type" in detail["errors"][0]
    assert detail["images"] == []


def test_field_operator_cannot_upload_admin_photos(client, admin_token, user_token, legacy_operator):
    rec_id = _import_one(client, admin_token, legacy_operator)
    res = client.post(
        f"/api/admin/records/{rec_id}/photos",
        files=[("files", ("site.jpg", _jpeg(), "image/jpeg"))],
        headers=auth_header(user_token),
    )
    assert res.status_code == 403


# ── Editing an imported record ────────────────────────────────────────
def test_admin_can_update_imported_record_fields(client, admin_token, legacy_operator):
    rec_id = _import_one(client, admin_token, legacy_operator)
    res = client.put(
        f"/api/admin/records/{rec_id}",
        json={
            "site_address": "12A Main St",
            "district": "Erode",
            "coordinates": "11.0500, 76.9800",
            "remarks": "Corrected after field verification",
        },
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["site_address"] == "12A Main St"
    assert detail["district"] == "Erode"
    assert detail["coordinates"] == "11.0500, 76.9800"
    assert detail["remarks"] == "Corrected after field verification"
    assert detail["source"] == "imported"
