import pytest
from app.database.connection import SessionLocal
from app.models.capture_record import CaptureRecord
from app.services.duplicate_detection_service import (
    DuplicateDetectionService,
    get_proximity_threshold_m,
    is_multiunit_property,
    is_already_visited,
)

def test_proximity_threshold_rules():
    # Standard residential site should have 40.0m threshold
    assert get_proximity_threshold_m("Residential", None, None) == 40.0
    assert not is_multiunit_property("Residential")

    # Multiunit / commercial site should have 50.0m threshold
    assert is_multiunit_property("Villa Project")
    assert get_proximity_threshold_m("Villa Project") == 50.0
    assert get_proximity_threshold_m(property_type="Apartment") == 50.0
    assert get_proximity_threshold_m(land_use="Commercial Complex") == 50.0
    assert get_proximity_threshold_m(type_of_construction="Gated Community") == 50.0

def test_already_visited_logic():
    assert is_already_visited("COMPLETED", None, None) is True
    assert is_already_visited("REASSIGNED", None, None) is True
    assert is_already_visited("NOT_COMPLETED", "2026-11-01", None) is True
    assert is_already_visited("NOT_COMPLETED", None, 11.0168) is True
    assert is_already_visited("NOT_COMPLETED", None, None) is False

def test_duplicate_proximity_detection():
    db = SessionLocal()
    created_ids = []
    try:
        # Base site in Coimbatore
        base_lat = 11.02500
        base_lon = 76.96500

        rec1 = CaptureRecord(
            name="CBE-TEST01",
            unique_id="CBE-TEST01",
            latitude=base_lat,
            longitude=base_lon,
            coordinates=f"{base_lat}, {base_lon}",
            village="Perur",
            taluk="Perur",
            district="Coimbatore",
            status="COMPLETED",
            property_type="Residential",
        )
        db.add(rec1)
        db.commit()
        db.refresh(rec1)
        created_ids.append(rec1.id)

        # Point ~20 meters away (1 deg lat ~111,000m -> 0.00018 deg is ~20m)
        close_lat = base_lat + 0.00018
        close_lon = base_lon

        result = DuplicateDetectionService.check_duplicate_proximity(
            db, lat=close_lat, lng=close_lon, property_type="Residential"
        )

        assert result["is_duplicate"] is True
        assert result["duplicate_site_id"] == "CBE-TEST01"
        assert result["duplicate_is_visited"] is True
        assert "Site may be already visited" in result["duplicate_warning"]
        assert result["duplicate_tag"] == "DUPLICATE"

        # Point ~200 meters away (0.002 deg -> ~220m)
        far_lat = base_lat + 0.002
        far_lon = base_lon

        far_result = DuplicateDetectionService.check_duplicate_proximity(
            db, lat=far_lat, lng=far_lon, property_type="Residential"
        )
        assert far_result["is_duplicate"] is False
        assert far_result["duplicate_warning"] is None

    finally:
        for rid in created_ids:
            r = db.query(CaptureRecord).filter(CaptureRecord.id == rid).first()
            if r:
                db.delete(r)
        db.commit()
        db.close()
