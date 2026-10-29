import pytest
from app.database.connection import SessionLocal
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.record_service import (
    has_valid_contact,
    get_target_telecaller,
    auto_assign_telecaller_if_contact,
)
from app.routers.telecaller import sync_unassigned_telecaller_leads, _eligible_contact_filter

def test_has_valid_contact():
    class DummyRecord:
        contact_number = None
        site_contractor_architect_number = None
        qc_builder_contact = None

    rec = DummyRecord()
    assert not has_valid_contact(rec)

    rec.contact_number = "-"
    rec.site_contractor_architect_number = "N/A"
    assert not has_valid_contact(rec)

    rec.contact_number = "9876543210"
    assert has_valid_contact(rec)

    rec.contact_number = None
    rec.site_contractor_architect_number = "9123456780"
    assert has_valid_contact(rec)

    rec.site_contractor_architect_number = None
    rec.qc_builder_contact = "Builder John 9840123456"
    assert has_valid_contact(rec)

def test_get_target_telecaller_and_auto_assign():
    db = SessionLocal()
    try:
        telecaller = get_target_telecaller(db)
        assert telecaller is not None
        assert telecaller.role == UserRole.TELECALLER
        assert telecaller.is_active

        # Test auto-assign helper on a record with contact
        dummy = CaptureRecord(
            name="AutoAssign Test",
            unique_id="TST-AUTO-001",
            contact_number="9876543210",
        )
        db.add(dummy)
        db.commit()
        db.refresh(dummy)

        assigned_id = auto_assign_telecaller_if_contact(db, dummy)
        assert dummy.assigned_telecaller_id == telecaller.id

        # Clean up
        db.delete(dummy)
        db.commit()
    finally:
        db.close()
