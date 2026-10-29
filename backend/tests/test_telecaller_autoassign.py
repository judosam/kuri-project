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

    # Non-phone notes should NOT be treated as valid contacts
    rec.qc_builder_contact = "Temple"
    assert not has_valid_contact(rec)
    rec.qc_builder_contact = "CIT clg"
    assert not has_valid_contact(rec)
    rec.qc_builder_contact = "Greenfield Daffodil Apartment"
    assert not has_valid_contact(rec)

    # Multi-number / formatted numbers with 10 digits
    rec.qc_builder_contact = "Might be part of Sirila Life Spaces, 98439 65000, 90434 65000"
    assert has_valid_contact(rec)
    rec.qc_builder_contact = "8270056005"
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

def test_eligible_contact_filter_excludes_non_numbers_and_includes_qc_builder():
    db = SessionLocal()
    try:
        r_valid_qc = CaptureRecord(
            name="Valid QC Contact",
            unique_id="TST-QC-001",
            qc_builder_contact="8270056005",
        )
        r_multi_qc = CaptureRecord(
            name="Multi QC Contact",
            unique_id="TST-QC-002",
            qc_builder_contact="Sirila Life Spaces, 98439 65000, 90434 65000",
        )
        r_invalid_text = CaptureRecord(
            name="Invalid Text QC",
            unique_id="TST-QC-003",
            qc_builder_contact="Temple",
        )
        db.add_all([r_valid_qc, r_multi_qc, r_invalid_text])
        db.commit()

        # Query using the telecaller eligible contact filter
        matched_ids = [
            r.id for r in db.query(CaptureRecord)
            .filter(
                _eligible_contact_filter(),
                CaptureRecord.id.in_([r_valid_qc.id, r_multi_qc.id, r_invalid_text.id]),
            )
            .all()
        ]

        assert r_valid_qc.id in matched_ids
        assert r_multi_qc.id in matched_ids
        assert r_invalid_text.id not in matched_ids

        # Clean up
        db.delete(r_valid_qc)
        db.delete(r_multi_qc)
        db.delete(r_invalid_text)
        db.commit()
    finally:
        db.close()
