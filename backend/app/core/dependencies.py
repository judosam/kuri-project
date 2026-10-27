from typing import Optional

from fastapi import Depends, Header, Query, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService


async def get_current_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate JWT token from Authorization header or ?token= query parameter."""
    raw_token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            raw_token = parts[1]
        else:
            raw_token = authorization
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header or token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    auth_service = AuthService(db)
    user = auth_service.get_current_user(raw_token)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def require_active_user(user: User = Depends(get_current_user)) -> User:
    """Ensure the authenticated user is active."""
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )
    return user


async def require_admin(user: User = Depends(require_active_user)) -> User:
    """Ensure the authenticated user is an active administrator (ADMIN)."""
    if user.role.value != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def require_record_manager(user: User = Depends(require_active_user)) -> User:
    """Viewing/managing records is shared with managers and auditors."""
    if user.role.value not in ("ADMIN", "MANAGER", "AUDITOR"):
        raise HTTPException(status_code=403, detail="Admin, manager or auditor access required")
    return user


async def require_auditor(user: User = Depends(require_active_user)) -> User:
    """QC assessment is available to administrators and QA reviewers."""
    if user.role.value not in ("ADMIN", "AUDITOR"):
        raise HTTPException(status_code=403, detail="Admin or auditor access required")
    return user


async def require_admin_or_manager(user: User = Depends(require_active_user)) -> User:
    """Record mutation (reassign etc.) stays with admins and managers only —
    auditors are read-only reviewers."""
    if user.role.value not in ("ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Admin or manager access required")
    return user


async def require_record_writer(user: User = Depends(require_active_user)) -> User:
    """Only roles that capture field work create records: field operators
    (USER) and dedicated FIELD_VERIFIERs. Managers can view and reassign;
    auditors are read-only reviewers."""
    if user.role.value == "MANAGER":
        raise HTTPException(status_code=403, detail="Managers can only view and assign records")
    if user.role.value == "AUDITOR":
        raise HTTPException(status_code=403, detail="Auditors can only view records")
    return user


async def require_telecaller(user: User = Depends(require_active_user)) -> User:
    """Telecalling workflow is available to telecallers, admins and managers."""
    if user.role.value not in ("ADMIN", "MANAGER", "TELECALLER"):
        raise HTTPException(status_code=403, detail="Telecaller access required")
    return user
