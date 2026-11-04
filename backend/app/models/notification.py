from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    recipient_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    recipient_role: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True, index=True
    )  # e.g. 'ADMIN', 'AUDITOR', 'FIELD_VERIFIER', 'TELECALLER'
    type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # e.g. 'qa_assigned', 'verifier_assigned', 'telecaller_assigned', 'qa_done', 'verifier_activity'
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    record_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    unique_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    with_sound: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    recipient = relationship("User", foreign_keys=[recipient_id])

    def __repr__(self) -> str:
        return f"<Notification id={self.id} recipient_id={self.recipient_id} type={self.type} title={self.title} with_sound={self.with_sound}>"
