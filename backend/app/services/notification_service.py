import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from sqlalchemy import and_, or_, desc
from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


def create_notification(
    db: Session,
    type: str,
    title: str,
    message: str,
    recipient_id: Optional[int] = None,
    recipient_role: Optional[str] = None,
    record_id: Optional[int] = None,
    unique_id: Optional[str] = None,
    with_sound: bool = False,
) -> Notification:
    """Create and persist a new notification."""
    notif = Notification(
        recipient_id=recipient_id,
        recipient_role=recipient_role,
        type=type,
        title=title,
        message=message,
        record_id=record_id,
        unique_id=unique_id,
        with_sound=with_sound,
        is_read=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(notif)
    try:
        db.commit()
        db.refresh(notif)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create notification: {e}")
        raise
    return notif


def _user_notification_filter(user: User):
    """Build the SQL filter for notifications directed to a specific user or user's role.
    Strictly enforces account and role isolation so that QA and Telecallers only see
    their own notifications and never field verifier reminders or other roles' alerts.
    """
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val == "ADMIN":
        # Admins see notifications directly sent to them, role ADMIN, or system-wide due reminders
        return or_(
            Notification.recipient_id == user.id,
            Notification.recipient_role == "ADMIN",
            and_(
                Notification.recipient_id.is_(None),
                Notification.type.in_(["admin_due_reminder", "verifier_due_reminder"]),
            ),
        )
    elif role_val in ("FIELD_VERIFIER", "USER"):
        # Field verifiers see notifications targeted to their user ID, or broadcast to FIELD_VERIFIER/USER,
        # or due reminders for field verifications
        return or_(
            Notification.recipient_id == user.id,
            and_(
                Notification.recipient_id.is_(None),
                Notification.recipient_role.in_(["FIELD_VERIFIER", "USER"]),
            ),
            and_(
                Notification.recipient_id.is_(None),
                Notification.type.in_(["admin_due_reminder", "verifier_due_reminder"]),
            ),
        )
    elif role_val == "AUDITOR":
        # QA / Auditors ONLY see notifications associated with their account:
        # direct assignments (recipient_id == user.id) or AUDITOR-specific announcements
        return or_(
            Notification.recipient_id == user.id,
            and_(
                Notification.recipient_id.is_(None),
                Notification.recipient_role == "AUDITOR",
            ),
        )
    elif role_val == "TELECALLER":
        # Telecallers ONLY see notifications associated with their account:
        # direct assignments (recipient_id == user.id) or TELECALLER-specific announcements
        return or_(
            Notification.recipient_id == user.id,
            and_(
                Notification.recipient_id.is_(None),
                Notification.recipient_role == "TELECALLER",
            ),
        )
    else:
        # Non-admins see notifications targeted to their user ID or their specific role
        return or_(
            Notification.recipient_id == user.id,
            and_(
                Notification.recipient_id.is_(None),
                Notification.recipient_role == role_val,
            ),
        )


def check_and_create_overdue_reminders(db: Session, user: User) -> None:
    """Check for pending records assigned yesterday or earlier that are still not completed,
    and create daily reminder notifications for field verifiers and admin only."""
    try:
        from app.models.capture_record import CaptureRecord
        from datetime import timedelta, timezone

        # Strictly limit overdue checks to ADMIN and FIELD_VERIFIERS; never run or generate for QA / Telecallers
        role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
        if role_val not in ("ADMIN", "FIELD_VERIFIER", "USER"):
            return

        # Calculate midnight IST today in UTC (IST is UTC+5:30)
        ist_offset = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist_offset)
        today_midnight_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
        today_midnight_utc = today_midnight_ist.astimezone(timezone.utc)

        # Check total overdue records across all assigned field verifiers
        total_overdue = (
            db.query(CaptureRecord)
            .filter(
                CaptureRecord.user_id.isnot(None),
                CaptureRecord.status == "NOT_COMPLETED",
                or_(
                    CaptureRecord.assigned_at < today_midnight_utc,
                    (CaptureRecord.assigned_at.is_(None) & (CaptureRecord.created_at < today_midnight_utc)),
                ),
            )
            .count()
        )

        if total_overdue > 0:
            already_reminded = (
                db.query(Notification)
                .filter(
                    Notification.type.in_(["admin_due_reminder", "verifier_due_reminder"]),
                    Notification.recipient_id.is_(None),
                    Notification.created_at >= today_midnight_utc,
                )
                .first()
            )
            if not already_reminded:
                unit = "Site" if total_overdue == 1 else "Site(s)"
                create_notification(
                    db=db,
                    type="admin_due_reminder",
                    title=f"⚠️ Field Verification Due: {total_overdue} Overdue {unit}",
                    message=f"There are {total_overdue} pending field inspection(s) assigned yesterday or earlier that have not been completed.",
                    recipient_role="FIELD_VERIFIER",
                    with_sound=True,
                )
    except Exception as e:
        logger.warning(f"Error checking overdue reminders: {e}")


def get_user_notifications(
    db: Session,
    user: User,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Notification], int, int]:
    """Return paginated notifications for the user, total count, and unread count."""
    check_and_create_overdue_reminders(db, user)
    cond = _user_notification_filter(user)
    base_query = db.query(Notification).filter(cond)

    total = base_query.count()
    unread_count = base_query.filter(Notification.is_read.is_(False)).count()

    notifications = (
        base_query.order_by(desc(Notification.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return notifications, total, unread_count


def poll_user_notifications(
    db: Session,
    user: User,
    last_id: int = 0,
) -> Tuple[List[Notification], int, bool]:
    """Poll for new notifications with id > last_id for the user."""
    check_and_create_overdue_reminders(db, user)
    cond = _user_notification_filter(user)
    base_query = db.query(Notification).filter(cond)

    unread_count = base_query.filter(Notification.is_read.is_(False)).count()

    query = base_query
    if last_id > 0:
        query = query.filter(Notification.id > last_id)

    new_notifs = query.order_by(desc(Notification.id)).limit(30).all()
    has_sound = any(n.with_sound for n in new_notifs)

    return new_notifs, unread_count, has_sound


def mark_notification_read(db: Session, notification_id: int, user: User) -> bool:
    """Mark a specific notification as read."""
    cond = _user_notification_filter(user)
    notif = db.query(Notification).filter(cond, Notification.id == notification_id).first()
    if not notif:
        return False
    notif.is_read = True
    db.commit()
    return True


def mark_all_notifications_read(db: Session, user: User) -> int:
    """Mark all unread notifications for a user as read."""
    cond = _user_notification_filter(user)
    unread_query = db.query(Notification).filter(cond, Notification.is_read.is_(False))
    count = unread_query.count()
    unread_query.update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return count
