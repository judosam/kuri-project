from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator

from app.models.user import UserRole


def _basic_email(v: str) -> str:
    """Minimal email check — just x@y. Full RFC/reserved-domain validation is overkill here."""
    v = v.strip().lower()
    local, _, domain = v.partition("@")
    if not local or not domain or "@" in domain or " " in v:
        raise ValueError("Enter a valid email address")
    return v


def _utc_iso(dt_val: datetime) -> str:
    """Format datetime as UTC ISO 8601 string ending with Z."""
    if dt_val.tzinfo is None:
        dt_val = dt_val.replace(tzinfo=timezone.utc)
    return dt_val.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")



class UserCreate(BaseModel):
    email: str
    password: Optional[str] = None
    full_name: str
    role: str = "USER"

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        trimmed = v.strip()
        if len(trimmed) < 2:
            raise ValueError("Full name must be at least 2 characters long")
        if len(trimmed) > 100:
            raise ValueError("Full name cannot exceed 100 characters")
        return trimmed

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _basic_email(v)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        valid_roles = {r.value for r in UserRole}
        if v not in valid_roles:
            raise ValueError(f"Role must be one of: {', '.join(sorted(valid_roles))}")
        return v


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if len(trimmed) < 2:
                raise ValueError("Full name must be at least 2 characters long")
            if len(trimmed) > 100:
                raise ValueError("Full name cannot exceed 100 characters")
            return trimmed
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        return _basic_email(v) if v is not None else v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            valid_roles = {r.value for r in UserRole}
            if v not in valid_roles:
                raise ValueError(f"Role must be one of: {', '.join(sorted(valid_roles))}")
        return v


class UserResetPasswordRequest(BaseModel):
    new_password: Optional[str] = None
    must_change_password: Optional[bool] = None



class UserDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    must_change_password: bool = False
    last_login_at: Optional[datetime] = None
    temporary_password: Optional[str] = None
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_dt(self, dt_val: datetime) -> str:
        return _utc_iso(dt_val)


class UserListResponse(BaseModel):
    users: list[UserDetail]
    total: int
    page: int
    page_size: int
