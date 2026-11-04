import pytest
from app.models.notification import Notification
from app.models.user import User, UserRole
from app.services.notification_service import (
    create_notification,
    get_user_notifications,
    poll_user_notifications,
    mark_notification_read,
    mark_all_notifications_read,
)


def test_qa_assignment_notification_with_sound(db_session):
    """1. Test QA assignment: Ensure QA receives notification with with_sound=True."""
    db = db_session
    qa_user = db.query(User).filter(User.role == UserRole.AUDITOR).first()
    if not qa_user:
        qa_user = User(
            email="test_qa_notif@example.com",
            full_name="Test QA Auditor",
            password_hash="fakehash",
            role=UserRole.AUDITOR,
            is_active=True,
        )
        db.add(qa_user)
        db.commit()

    notif = create_notification(
        db=db,
        type="qa_assigned",
        title="New QA Task: 5 Record(s) Assigned",
        message="Admin assigned 5 record(s) to you for QA verification.",
        recipient_id=qa_user.id,
        recipient_role="AUDITOR",
        with_sound=True,
    )

    assert notif.id is not None
    assert notif.with_sound is True
    assert notif.type == "qa_assigned"

    # Verify poll returns with_sound=True for QA user
    polled, unread, has_sound = poll_user_notifications(db, user=qa_user, last_id=0)
    assert any(n.id == notif.id for n in polled)
    assert has_sound is True
    assert unread >= 1

    # Cleanup
    db.delete(notif)
    db.commit()


def test_field_verifier_assignment_notification_with_sound(db_session):
    """2. Test Field Verifier assignment: Ensure verifier receives notification with with_sound=True."""
    db = db_session
    verifier = db.query(User).filter(User.role.in_([UserRole.FIELD_VERIFIER, UserRole.USER])).first()
    if not verifier:
        verifier = User(
            email="test_verifier_notif@example.com",
            full_name="Test Verifier",
            password_hash="fakehash",
            role=UserRole.FIELD_VERIFIER,
            is_active=True,
        )
        db.add(verifier)
        db.commit()

    notif = create_notification(
        db=db,
        type="verifier_assigned",
        title="New Field Tasks: 3 Record(s) Assigned",
        message="Admin assigned 3 site inspection(s) to you.",
        recipient_id=verifier.id,
        recipient_role="FIELD_VERIFIER",
        with_sound=True,
    )

    assert notif.id is not None
    assert notif.with_sound is True

    polled, unread, has_sound = poll_user_notifications(db, user=verifier, last_id=0)
    assert any(n.id == notif.id for n in polled)
    assert has_sound is True

    # Cleanup
    db.delete(notif)
    db.commit()


def test_telecaller_assignment_notification_with_sound(db_session):
    """3. Test Telecaller assignment: Ensure telecaller receives notification with with_sound=True."""
    db = db_session
    telecaller = db.query(User).filter(User.role == UserRole.TELECALLER).first()
    if not telecaller:
        telecaller = User(
            email="test_telecaller_notif@example.com",
            full_name="Test Telecaller",
            password_hash="fakehash",
            role=UserRole.TELECALLER,
            is_active=True,
        )
        db.add(telecaller)
        db.commit()

    notif = create_notification(
        db=db,
        type="telecaller_assigned",
        title="New Calling Queue: 10 Record(s) Assigned",
        message="Admin assigned 10 lead record(s) to you for telecalling.",
        recipient_id=telecaller.id,
        recipient_role="TELECALLER",
        with_sound=True,
    )

    assert notif.id is not None
    assert notif.with_sound is True

    polled, unread, has_sound = poll_user_notifications(db, user=telecaller, last_id=0)
    assert any(n.id == notif.id for n in polled)
    assert has_sound is True

    # Cleanup
    db.delete(notif)
    db.commit()


def test_admin_activity_notification_without_sound(db_session):
    """4. Test Admin activity: When QA marks record 'Done', notification for Admin is with_sound=False."""
    db = db_session
    admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
    if not admin:
        admin = User(
            email="test_admin_notif@example.com",
            full_name="Test Administrator",
            password_hash="fakehash",
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()

    notif = create_notification(
        db=db,
        type="qa_done",
        title="QA Assessment Saved: CBE-518294",
        message="QA reviewer completed desk review for CBE-518294.",
        recipient_role="ADMIN",
        record_id=101,
        unique_id="CBE-518294",
        with_sound=False,
    )

    assert notif.id is not None
    assert notif.with_sound is False
    assert notif.recipient_role == "ADMIN"

    # Poll by admin user
    polled, unread, has_sound = poll_user_notifications(db, user=admin, last_id=notif.id - 1)
    matching = [n for n in polled if n.id == notif.id]
    assert len(matching) == 1
    assert matching[0].with_sound is False

    # Mark as read
    success = mark_notification_read(db, notif.id, user=admin)
    assert success is True

    # Cleanup
    db.delete(notif)
    db.commit()


def test_activity_entries_and_groups_feed(db_session):
    """5. Verify Activity feed returns logs with action_type, user_role, unique_id."""
    db = db_session
    from app.routers.admin import _build_activity_entries
    entries = _build_activity_entries(db)
    assert isinstance(entries, list)
    assert len(entries) > 0

    # Ensure action_type, user_role or unique_id are present on entries
    sample_with_record = next((e for e in entries if e.record_id is not None), None)
    if sample_with_record:
        assert sample_with_record.action_type is not None
        if sample_with_record.unique_id:
            assert sample_with_record.unique_id.startswith("CBE-")


def test_field_verifier_and_admin_receive_due_reminder(db_session):
    """6. Ensure Field Verifiers and Admins both receive the due reminder notification."""
    db = db_session
    from datetime import datetime, timedelta, timezone
    from app.models.capture_record import CaptureRecord
    from app.services.notification_service import check_and_create_overdue_reminders

    admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
    if not admin:
        admin = User(
            email="test_due_admin@example.com",
            full_name="Due Admin",
            password_hash="fakehash",
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()

    verifier = db.query(User).filter(User.role.in_([UserRole.FIELD_VERIFIER, UserRole.USER])).first()
    if not verifier:
        verifier = User(
            email="test_due_verifier@example.com",
            full_name="Due Verifier",
            password_hash="fakehash",
            role=UserRole.FIELD_VERIFIER,
            is_active=True,
        )
        db.add(verifier)
        db.commit()

    # Create an overdue pending record assigned yesterday
    yesterday = datetime.now(timezone.utc) - timedelta(days=2)
    record = CaptureRecord(
        name="Overdue Test Record",
        unique_id="CBE-999999",
        status="NOT_COMPLETED",
        user_id=verifier.id,
        assigned_at=yesterday,
        created_at=yesterday,
    )
    db.add(record)
    db.commit()

    # Check and generate reminders
    check_and_create_overdue_reminders(db, verifier)

    # Poll notifications as field verifier
    polled_v, unread_v, has_sound_v = poll_user_notifications(db, user=verifier, last_id=0)
    due_notifs_v = [n for n in polled_v if "Field Verification Due" in n.title or n.type in ("admin_due_reminder", "verifier_due_reminder")]
    assert len(due_notifs_v) > 0, "Field verifier must receive the due reminder notification"
    assert due_notifs_v[0].with_sound is True
    assert "Overdue" in due_notifs_v[0].title

    # Poll notifications as admin
    polled_a, unread_a, has_sound_a = poll_user_notifications(db, user=admin, last_id=0)
    due_notifs_a = [n for n in polled_a if "Field Verification Due" in n.title or n.type in ("admin_due_reminder", "verifier_due_reminder")]
    assert len(due_notifs_a) > 0, "Admin must receive the due reminder notification"
    assert due_notifs_a[0].with_sound is True

    # Poll notifications as QA / Auditor (must NEVER receive field verification due reminder)
    qa_user = db.query(User).filter(User.role == UserRole.AUDITOR).first()
    if not qa_user:
        qa_user = User(
            email="test_due_qa@example.com",
            full_name="Due QA",
            password_hash="fakehash",
            role=UserRole.AUDITOR,
            is_active=True,
        )
        db.add(qa_user)
        db.commit()
    polled_qa, unread_qa, _ = poll_user_notifications(db, user=qa_user, last_id=0)
    due_notifs_qa = [n for n in polled_qa if "Field Verification Due" in n.title or n.type in ("admin_due_reminder", "verifier_due_reminder")]
    assert len(due_notifs_qa) == 0, "QA portal must NEVER receive field verifier due reminders"

    # Poll notifications as Telecaller (must NEVER receive field verification due reminder)
    tc_user = db.query(User).filter(User.role == UserRole.TELECALLER).first()
    if not tc_user:
        tc_user = User(
            email="test_due_tc@example.com",
            full_name="Due Telecaller",
            password_hash="fakehash",
            role=UserRole.TELECALLER,
            is_active=True,
        )
        db.add(tc_user)
        db.commit()
    polled_tc, unread_tc, _ = poll_user_notifications(db, user=tc_user, last_id=0)
    due_notifs_tc = [n for n in polled_tc if "Field Verification Due" in n.title or n.type in ("admin_due_reminder", "verifier_due_reminder")]
    assert len(due_notifs_tc) == 0, "Telecaller portal must NEVER receive field verifier due reminders"

