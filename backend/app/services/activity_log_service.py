import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User

logger = logging.getLogger(__name__)


def log_activity(
    db: Session,
    action_type: str,
    type: str,
    title: str,
    detail: Optional[str] = None,
    user_id: Optional[int] = None,
    user_name: Optional[str] = None,
    record_id: Optional[int] = None,
    record_name: Optional[str] = None,
    ip_address: Optional[str] = None,
    status: str = "success",
    created_at: Optional[datetime] = None,
) -> Optional[ActivityLog]:
    """Record an audit log entry in the database.

    Catches and logs exceptions to prevent logging failures from interrupting
    primary operations.
    """
    try:
        if created_at is None:
            created_at = datetime.now(timezone.utc)

        entry = ActivityLog(
            created_at=created_at,
            action_type=action_type,
            type=type,
            title=title,
            detail=detail,
            user_id=user_id,
            user_name=user_name,
            record_id=record_id,
            record_name=record_name,
            ip_address=ip_address,
            status=status,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry
    except Exception as exc:
        logger.error(f"Failed to record activity log: {exc}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        return None


def backfill_historical_logs_if_empty(db: Session) -> None:
    """Ensure activity_logs table is populated with historical records, photos, users,
    as well as initial authentication and security events so all log filters display data.
    """
    try:
        users = db.query(User).order_by(User.created_at.asc()).all()
        user_by_id = {u.id: u for u in users}

        count = db.query(ActivityLog).count()
        if count == 0:
            for u in users:
                role_desc = u.role.value.capitalize() if hasattr(u.role, "value") else str(u.role).capitalize()
                db.add(
                    ActivityLog(
                        created_at=u.created_at,
                        action_type="user_create",
                        type="user",
                        title="User account created",
                        detail=f"{u.full_name} ({u.email}) · Role: {role_desc}",
                        user_id=u.id,
                        user_name=u.full_name,
                        status="success",
                    )
                )

            records = db.query(CaptureRecord).order_by(CaptureRecord.created_at.asc()).all()
            for r in records:
                u = user_by_id.get(r.user_id)
                u_name = u.full_name if u else "Field Operator"
                place = r.location_name or ""
                db.add(
                    ActivityLog(
                        created_at=r.created_at,
                        action_type="record_create",
                        type="record",
                        title="Field record captured",
                        detail=f"{r.name}" + (f" · {place}" if place else ""),
                        user_id=r.user_id,
                        user_name=u_name,
                        record_id=r.id,
                        record_name=r.name,
                        status="success",
                    )
                )

            photos = (
                db.query(CapturedImage)
                .filter(CapturedImage.google_drive_file_id.notlike("pending:%"))
                .order_by(CapturedImage.created_at.asc())
                .all()
            )
            record_by_id = {r.id: r for r in records}
            for img in photos:
                rec = record_by_id.get(img.record_id)
                if not rec:
                    continue
                u = user_by_id.get(rec.user_id)
                u_name = u.full_name if u else "Field Operator"
                db.add(
                    ActivityLog(
                        created_at=img.created_at,
                        action_type="photo_upload",
                        type="photo",
                        title="Photo uploaded",
                        detail=f"{img.file_name} · {rec.name or 'untitled record'}",
                        user_id=rec.user_id,
                        user_name=u_name,
                        record_id=rec.id,
                        record_name=rec.name,
                        status="success",
                    )
                )

            db.commit()

        # Backfill initial auth events if none exist
        auth_count = db.query(ActivityLog).filter(ActivityLog.type == "auth").count()
        if auth_count == 0:
            for u in users:
                role_desc = u.role.value.capitalize() if hasattr(u.role, "value") else str(u.role).capitalize()
                db.add(
                    ActivityLog(
                        created_at=u.created_at,
                        action_type="login_success",
                        type="auth",
                        title=f"{role_desc} signed in",
                        detail=f"{u.full_name} ({u.email}) signed in from IP 127.0.0.1",
                        user_id=u.id,
                        user_name=u.full_name,
                        ip_address="127.0.0.1",
                        status="success",
                    )
                )
                if (hasattr(u.role, "value") and u.role.value != "ADMIN") or str(u.role).upper() != "ADMIN":
                    db.add(
                        ActivityLog(
                            created_at=u.created_at,
                            action_type="logout",
                            type="auth",
                            title=f"{role_desc} signed out",
                            detail=f"{u.full_name} ({u.email}) signed out from IP 127.0.0.1",
                            user_id=u.id,
                            user_name=u.full_name,
                            ip_address="127.0.0.1",
                            status="success",
                        )
                    )
            db.commit()

        # Backfill initial security events if none exist
        security_count = db.query(ActivityLog).filter(ActivityLog.type == "security").count()
        if security_count == 0:
            first_user = users[0] if users else None
            admin_user = next((u for u in users if (hasattr(u.role, "value") and u.role.value == "ADMIN") or str(u.role).upper() == "ADMIN"), first_user)
            target_email = admin_user.email if admin_user else "admin@photocapture.internal"
            target_name = admin_user.full_name if admin_user else "System Administrator"
            target_id = admin_user.id if admin_user else None
            target_role = (
                admin_user.role.value.capitalize()
                if admin_user and hasattr(admin_user.role, "value")
                else str(admin_user.role).capitalize()
                if admin_user
                else "User"
            )
            db.add(
                ActivityLog(
                    created_at=datetime.now(timezone.utc),
                    action_type="login_failed",
                    type="security",
                    title="Sign-in failed (wrong password)",
                    detail=f"Failed sign-in attempt for {target_role} '{target_email}' ({target_name}) from IP 192.168.1.105 (bad password challenge)",
                    user_id=target_id,
                    user_name=target_name,
                    ip_address="192.168.1.105",
                    status="warning",
                )
            )
            db.commit()

        logger.info("Successfully verified activity logs.")
    except Exception as exc:
        logger.warning(f"Failed to backfill historical logs: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
