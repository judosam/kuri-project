from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, field_serializer


def _utc_iso(dt_val: Optional[datetime]) -> Optional[str]:
    if dt_val is None:
        return None
    return dt_val.isoformat()


class NotificationDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    recipient_id: Optional[int] = None
    recipient_role: Optional[str] = None
    type: str
    title: str
    message: str
    record_id: Optional[int] = None
    unique_id: Optional[str] = None
    with_sound: bool = False
    is_read: bool = False
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_dt(self, dt_val: Optional[datetime]) -> Optional[str]:
        return _utc_iso(dt_val)


class NotificationListResponse(BaseModel):
    notifications: List[NotificationDetail]
    total: int
    unread_count: int
    page: int
    page_size: int


class NotificationPollResponse(BaseModel):
    notifications: List[NotificationDetail]
    unread_count: int
    has_sound: bool = False
