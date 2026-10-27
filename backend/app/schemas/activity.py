from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, field_serializer


def _utc_iso(dt_val: datetime) -> str:
    """Format datetime as UTC ISO 8601 string ending with Z."""
    if dt_val.tzinfo is None:
        dt_val = dt_val.replace(tzinfo=timezone.utc)
    return dt_val.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class ActivityEntry(BaseModel):
    """One row in the activity feed (record captured / photo uploaded / user joined)."""

    id: str  # stable synthetic key, e.g. "record-40" | "photo-34" | "user-2"
    ts: datetime
    type: str  # "record" | "photo" | "user"
    title: str
    detail: Optional[str] = None
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    record_id: Optional[int] = None
    record_name: Optional[str] = None

    @field_serializer("ts", when_used="json")
    def serialize_dt(self, dt_val: datetime) -> str:
        return _utc_iso(dt_val)


class ActivitySummary(BaseModel):
    today: int
    week: int
    month: int


class ActivityLogResponse(BaseModel):
    items: List[ActivityEntry]
    total: int
    summary: ActivitySummary
