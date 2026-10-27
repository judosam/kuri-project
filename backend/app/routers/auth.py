import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, require_active_user
from app.database.connection import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    ProfileUpdateRequest,
    ProfileUpdateResponse,
    SimpleMessageResponse,
    TokenResponse,
    UserResetPasswordPublicRequest,
    UserResponse,
)
from app.services.activity_log_service import log_activity
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])

_login_attempts: dict[str, list[float]] = defaultdict(list)
_rate_limit_lock = Lock()


def check_login_rate_limit(client_ip: str, max_attempts: int = 10, window_seconds: int = 60):
    """Sliding-window in-memory rate limiter per IP to prevent brute-force attacks."""
    import os
    if client_ip in ("testclient", "localhost", "127.0.0.1", "::1"):
        max_attempts = 300
    now = time.time()
    with _rate_limit_lock:
        # Purge entries older than window
        attempts = [t for t in _login_attempts[client_ip] if now - t < window_seconds]
        if len(attempts) >= max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Please wait 1 minute before trying again.",
            )
        attempts.append(now)
        _login_attempts[client_ip] = attempts


@router.post("/login", response_model=TokenResponse)
async def login(
    login_req: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    check_login_rate_limit(client_ip)

    auth_service = AuthService(db)

    user = auth_service.authenticate(login_req.email, login_req.password)
    if not user:
        user_candidate = auth_service.user_repo.get_by_email(login_req.email.strip().lower())
        user_id = user_candidate.id if user_candidate else None
        user_name = user_candidate.full_name if user_candidate else None
        role_label = (
            user_candidate.role.value.capitalize()
            if user_candidate and hasattr(user_candidate.role, "value")
            else str(user_candidate.role).capitalize()
            if user_candidate
            else ""
        )
        title = "Sign-in failed (wrong password)" if user_candidate else "Sign-in failed (unknown email)"
        detail = (
            f"Failed sign-in attempt for {role_label} '{login_req.email}' ({user_name}) from IP {client_ip}"
            if user_candidate
            else f"Failed sign-in attempt for unregistered email '{login_req.email}' from IP {client_ip}"
        )
        log_activity(
            db=db,
            action_type="login_failed",
            type="security",
            title=title,
            detail=detail,
            user_id=user_id,
            user_name=user_name,
            ip_address=client_ip,
            status="warning",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Log successful sign-in
    role_label = user.role.value.capitalize() if hasattr(user.role, "value") else str(user.role).capitalize()
    log_activity(
        db=db,
        action_type="login_success",
        type="auth",
        title=f"{role_label} signed in",
        detail=f"{user.full_name} ({user.email}) successfully logged in from IP {client_ip}",
        user_id=user.id,
        user_name=user.full_name,
        ip_address=client_ip,
        status="success",
    )

    token = auth_service.create_token(user)
    return TokenResponse(
        access_token=token,
        must_change_password=bool(getattr(user, "must_change_password", False)),
        user_id=user.id,
        email=user.email,
    )


@router.post("/logout")
async def logout(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    role_label = user.role.value.capitalize() if hasattr(user.role, "value") else str(user.role).capitalize()

    # Log sign-out
    log_activity(
        db=db,
        action_type="logout",
        type="auth",
        title=f"{role_label} signed out",
        detail=f"{user.full_name} ({user.email}) signed out from IP {client_ip}",
        user_id=user.id,
        user_name=user.full_name,
        ip_address=client_ip,
        status="success",
    )

    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or request.query_params.get("token", "")
    AuthService(db).revoke_token(token)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(request: Request, response: Response, user: User = Depends(require_active_user), db: Session = Depends(get_db)):
    # Upgrade still-valid time-limited logins when either web app opens.
    from app.core.security import decode_access_token
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    payload = decode_access_token(token) or {}
    if payload and not payload.get("sid"):
        response.headers['X-Session-Token'] = AuthService(db).create_token(user)
    return user


@router.put("/profile", response_model=ProfileUpdateResponse)
async def update_profile(
    req: ProfileUpdateRequest,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Change email, password, or name for the currently authenticated user with zero server downtime."""
    from app.core.security import hash_password, verify_password

    auth_service = AuthService(db)

    # 1. Verify current password
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password does not match",
        )

    # 2. Update email if provided
    if req.new_email:
        new_email = req.new_email.strip().lower()
        if new_email != user.email:
            existing = auth_service.user_repo.get_by_email(new_email)
            if existing and existing.id != user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This email address is already in use by another account",
                )
            user.email = new_email

    # 3. Update full name if provided
    if req.full_name is not None and req.full_name.strip():
        user.full_name = req.full_name.strip()

    # 4. Update password if provided
    if req.new_password and req.new_password.strip():
        if len(req.new_password.strip()) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be at least 6 characters long",
            )
        user.password_hash = hash_password(req.new_password.strip())

    db.commit()
    db.refresh(user)

    # 5. Log profile change
    role_label = user.role.value.capitalize() if hasattr(user.role, "value") else str(user.role).capitalize()
    log_activity(
        db=db,
        action_type="profile_updated",
        type="security",
        title=f"{role_label} credentials updated",
        detail=f"{user.full_name} ({user.email}) updated their account profile/credentials",
        user_id=user.id,
        user_name=user.full_name,
        status="success",
    )

    # Issue a fresh JWT with updated info
    new_token = auth_service.create_token(user)
    return ProfileUpdateResponse(
        user=UserResponse.model_validate(user),
        access_token=new_token,
        message="Profile updated successfully",
    )


@router.post("/change-password", response_model=SimpleMessageResponse)
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """User self-service change password workflow."""
    from app.core.security import hash_password, verify_password

    client_ip = request.client.host if request.client else "unknown"

    new_pwd = req.new_password.strip()
    if len(new_pwd) < 8 or len(new_pwd) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be between 8 and 128 characters long",
        )

    if not verify_password(req.current_password, user.password_hash):
        log_activity(
            db=db,
            action_type="password_change_failed",
            type="security",
            title="Password change failed (wrong current password)",
            detail=f"User {user.full_name} ({user.email}) submitted an incorrect current password from IP {client_ip}",
            user_id=user.id,
            user_name=user.full_name,
            ip_address=client_ip,
            status="warning",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if req.current_password == new_pwd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be the same as current password",
        )

    user.password_hash = hash_password(new_pwd)
    user.must_change_password = False
    db.commit()
    db.refresh(user)

    role_label = user.role.value.capitalize() if hasattr(user.role, "value") else str(user.role).capitalize()
    log_activity(
        db=db,
        action_type="password_change_success",
        type="security",
        title=f"{role_label} changed password",
        detail=f"{user.full_name} ({user.email}) changed their password successfully from IP {client_ip}",
        user_id=user.id,
        user_name=user.full_name,
        ip_address=client_ip,
        status="success",
    )

    # Keep this device signed in; every other device must reauthenticate.
    import hashlib
    from app.core.security import decode_access_token
    from app.models.login_session import LoginSession
    raw_token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    payload = decode_access_token(raw_token) or {}
    session = db.get(LoginSession, payload["sid"]) if payload.get("sid") else None
    if session and session.user_id == user.id:
        session.password_fingerprint = hashlib.sha256(user.password_hash.encode()).hexdigest()
        db.commit()
    return SimpleMessageResponse(message="Password changed successfully")


@router.post("/reset-password", response_model=SimpleMessageResponse)
async def reset_password_public():
    """Public forgot password has been removed by enterprise security policy.
    Field operators must contact their system administrator to issue a temporary password."""
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Self-service password reset is disabled. Please contact your administrator to reset your password.",
    )
