import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    USER = "USER"
    # Office role for the audit workflow: auditors review and release (or
    # block) staged work before operators ever see it. Staging a task sheet
    # and routing it to an auditor is an admin action.
    AUDITOR = "AUDITOR"
    # Dedicated field-verification role: assigned released records by the
    # Record Assigner and completes inspections from the mobile app — same
    # field powers as USER, but a distinct directory entry so verifiers can
    # be managed separately from legacy operator accounts.
    FIELD_VERIFIER = "FIELD_VERIFIER"
    # Telecaller office role: calls contacts and contractors to confirm construction
    TELECALLER = "TELECALLER"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole), nullable=False, default=UserRole.USER
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    # foreign_keys pinned: capture_records now carries several user FKs
    # (audited_by_id, staged_operator_id) besides user_id itself.
    capture_records = relationship(
        "CaptureRecord",
        back_populates="user",
        foreign_keys="CaptureRecord.user_id",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email} role={self.role}>"
