from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False
    user_id: Optional[int] = None
    email: Optional[str] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    must_change_password: bool = False
    last_login_at: Optional[datetime] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str




class AdminResetPasswordResponse(BaseModel):
    id: int
    user_id: int
    email: str
    temporary_password: str
    message: str = "Temporary password generated. Share securely with user."
    must_change_password: bool = True


class ProfileUpdateRequest(BaseModel):
    current_password: str
    new_email: Optional[str] = None
    new_password: Optional[str] = None
    full_name: Optional[str] = None


class ProfileUpdateResponse(BaseModel):
    user: UserResponse
    access_token: str
    message: str


class UserResetPasswordPublicRequest(BaseModel):
    email: str
    new_password: str


class SimpleMessageResponse(BaseModel):
    message: str

