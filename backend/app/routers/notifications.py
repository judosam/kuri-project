from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import require_active_user
from app.database.connection import get_db
from app.models.user import User
from app.schemas.notification import (
    NotificationDetail,
    NotificationListResponse,
    NotificationPollResponse,
)
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Get paginated notifications for current user with unread count."""
    notifs, total, unread_count = notification_service.get_user_notifications(
        db, user=user, page=page, page_size=page_size
    )
    return NotificationListResponse(
        notifications=[NotificationDetail.model_validate(n) for n in notifs],
        total=total,
        unread_count=unread_count,
        page=page,
        page_size=page_size,
    )


@router.get("/poll", response_model=NotificationPollResponse)
async def poll_notifications(
    last_id: int = Query(0, ge=0),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Lightweight poll endpoint for new notifications since last_id."""
    notifs, unread_count, has_sound = notification_service.poll_user_notifications(
        db, user=user, last_id=last_id
    )
    return NotificationPollResponse(
        notifications=[NotificationDetail.model_validate(n) for n in notifs],
        unread_count=unread_count,
        has_sound=has_sound,
    )


@router.post("/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: int,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification as read."""
    success = notification_service.mark_notification_read(
        db, notification_id=notification_id, user=user
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    return {"success": True, "message": "Notification marked as read"}


@router.post("/read-all")
async def mark_all_notifications_as_read(
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Mark all unread notifications for the current user as read."""
    count = notification_service.mark_all_notifications_read(db, user=user)
    return {"success": True, "count": count, "message": f"Marked {count} notifications as read"}
