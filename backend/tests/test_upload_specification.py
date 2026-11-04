"""
Tests for Authoritative Kuri Upload Specification & Cadastral Auto-Enrichment.

Verifies:
1. Upload file with "Site ID" column -> reject batch.
2. Upload lat=12.5 -> all-or-nothing rollback with row error.
3. Upload area_sqm=100 -> imports with "Not Eligible" warning flag.
4. Upload site 15m from existing site -> updates metadata without duplicate (40m spatial deduplication).
5. Valid records receive 6-digit CBE-XXXXXX ID and qc_status="QC Pending".
"""

import csv
import io
import random
import pytest
from app.database.connection import SessionLocal
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.upload_specification_service import UploadSpecificationService


@pytest.fixture
def db():
    session = SessionLocal()
    created_ids = []
    try:
        yield (session, created_ids)
    finally:
        if created_ids:
            session.query(CaptureRecord).filter(CaptureRecord.id.in_(created_ids)).delete(synchronize_session=False)
            session.commit()
        session.close()


@pytest.fixture
def admin_user(db):
    session, _ = db
    user = session.query(User).filter(User.role == UserRole.ADMIN).first()
    if not user:
        user = User(
            email="test_admin@kuri.test",
            full_name="Test Admin",
            role=UserRole.ADMIN,
            is_active=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def make_csv_bytes(rows, fieldnames=None):
    if not fieldnames and rows:
        fieldnames = list(rows[0].keys())
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    return output.getvalue().encode("utf-8")


def test_1_site_id_column_rejects_batch(db):
    """If the file has a Site ID / unique_id column with values, halt batch immediately."""
    session, _ = db
    service = UploadSpecificationService(session)
    rows = [
        {
            "unique_id": "CBE-999999",
            "lat": 11.0168,
            "lon": 76.9558,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 200,
        }
    ]
    file_bytes = make_csv_bytes(rows)
    res = service.validate_batch(file_bytes, "test.csv")
    assert res["valid"] is False
    assert res["rejected"] is True
    assert "Site ID" in res["reject_reason"] or "unique_id" in res["reject_reason"]


def test_2_out_of_bounds_coordinate_rejects_batch(db):
    """lat=12.5 (outside Coimbatore 10.6-11.4) triggers all-or-nothing rejection."""
    session, _ = db
    service = UploadSpecificationService(session)
    rows = [
        {
            "lat": 12.5000,
            "lon": 76.9558,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 200,
        },
        {
            "lat": 11.0168,
            "lon": 76.9558,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 200,
        },
    ]
    file_bytes = make_csv_bytes(rows)
    res = service.validate_batch(file_bytes, "test.csv")
    assert res["valid"] is False
    assert res["rejected"] is True
    assert any("envelope" in err["reason"].lower() or "outside" in err["reason"].lower() for err in res["errors"])


def test_3_sub_threshold_area_warns_and_imports_not_eligible(db, admin_user):
    """area_sqm=100 (< 1500 sq.ft threshold) imports with Not Eligible flag."""
    session, tracker = db
    service = UploadSpecificationService(session)
    # Pick a fresh coordinate to avoid 40m overlap
    rand_lat = round(11.2000 + random.uniform(0.01, 0.05), 5)
    rand_lon = round(76.8000 + random.uniform(0.01, 0.05), 5)
    rows = [
        {
            "lat": rand_lat,
            "lon": rand_lon,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 100,  # ~1076 sq ft (< 1500)
            "detection_type": "greenfield",
        }
    ]
    file_bytes = make_csv_bytes(rows)
    val = service.validate_batch(file_bytes, "test.csv")
    assert val["valid"] is True
    assert len(val["warnings"]) >= 1
    assert any("Sub-threshold" in w["message"] for w in val["warnings"])

    # Commit
    report = service.commit_batch(val, admin_user)
    assert report["success"] is True
    assert report["created_count"] == 1
    rec_info = report["committed_records"][0]
    tracker.append(rec_info["record_id"])
    assert rec_info["is_eligible"] is False

    # Check DB record
    db_rec = session.query(CaptureRecord).filter(CaptureRecord.id == rec_info["record_id"]).first()
    assert db_rec is not None
    assert db_rec.is_eligible is False
    assert db_rec.qc_status == "QC Pending"
    assert db_rec.unique_id.startswith("CBE-")
    assert len(db_rec.unique_id) == 10  # "CBE-" + 6 digits


def test_4_spatial_deduplication_40m(db, admin_user):
    """A site uploaded ~15m from an existing record updates metadata rather than duplicating."""
    session, tracker = db
    service = UploadSpecificationService(session)

    base_lat = round(11.1500 + random.uniform(0.01, 0.04), 5)
    base_lon = round(76.8500 + random.uniform(0.01, 0.04), 5)

    # 1. Create a base record
    rows1 = [
        {
            "lat": base_lat,
            "lon": base_lon,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 250,
            "priority_tier": "Tier-1",
            "detection_type": "greenfield",
        }
    ]
    val1 = service.validate_batch(make_csv_bytes(rows1), "test1.csv")
    rep1 = service.commit_batch(val1, admin_user)
    assert rep1["created_count"] == 1
    orig_rec_id = rep1["committed_records"][0]["record_id"]
    orig_uid = rep1["committed_records"][0]["unique_id"]
    tracker.append(orig_rec_id)

    # 2. Upload a site ~11m away (0.0001 deg lat is ~11.1m)
    rows2 = [
        {
            "lat": round(base_lat + 0.00010, 5),
            "lon": base_lon,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 350,  # updated area
            "priority_tier": "Tier-2",  # updated tier
            "detection_type": "infill",
        }
    ]
    val2 = service.validate_batch(make_csv_bytes(rows2), "test2.csv")
    assert val2["valid"] is True
    assert len(val2["merged_candidates"]) == 1
    assert val2["merged_candidates"][0]["existing_record_id"] == orig_rec_id
    assert val2["merged_candidates"][0]["distance_m"] <= 40.0

    # Commit should update existing record, not create a new one
    rep2 = service.commit_batch(val2, admin_user)
    assert rep2["created_count"] == 0
    assert rep2["merged_count"] == 1

    # Verify existing record was updated
    updated_rec = session.query(CaptureRecord).filter(CaptureRecord.id == orig_rec_id).first()
    assert updated_rec.unique_id == orig_uid
    assert updated_rec.area_sqm == 350.0
    assert updated_rec.priority_tier == "Tier-2"
    assert updated_rec.detection_type == "infill"


def test_5_valid_record_mints_cbe_id_and_qc_pending(db, admin_user):
    """Valid record receives standard 6-digit CBE-XXXXXX ID, qc_status='QC Pending', no verifiers assigned."""
    session, tracker = db
    service = UploadSpecificationService(session)

    fresh_lat = round(11.2500 + random.uniform(0.01, 0.04), 5)
    fresh_lon = round(76.7500 + random.uniform(0.01, 0.04), 5)

    rows = [
        {
            "lat": fresh_lat,
            "lon": fresh_lon,
            "Village": "Saravanampatti",
            "Taluk": "Coimbatore North",
            "area_sqm": 220,
            "detection_type": "greenfield",
            "model_confidence_score": 0.92,
            "priority_tier": "Tier-1",
        }
    ]
    val = service.validate_batch(make_csv_bytes(rows), "test.csv")
    assert val["valid"] is True

    rep = service.commit_batch(val, admin_user)
    assert rep["created_count"] == 1
    rec_info = rep["committed_records"][0]
    tracker.append(rec_info["record_id"])
    assert rec_info["unique_id"].startswith("CBE-")
    assert len(rec_info["unique_id"]) == 10

    rec = session.query(CaptureRecord).filter(CaptureRecord.id == rec_info["record_id"]).first()
    assert rec.qc_status == "QC Pending"
    assert rec.status == "NOT_COMPLETED"
    assert rec.audit_status == "PENDING"
    assert rec.user_id is None
    assert rec.assigned_auditor_id is None
    assert f"https://maps.google.com/?q={fresh_lat},{fresh_lon}" == rec.gmaps_link
