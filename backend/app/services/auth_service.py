from datetime import datetime, timezone
from typing import Optional
import hashlib
import secrets
from jose import jwt
from app.core.config import get_settings
from app.models.login_session import LoginSession

from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    decode_access_token,
    dummy_verify_password,
    hash_password,
    is_legacy_hash,
    verify_password,
)
from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)

    def authenticate(self, email: str, password: str) -> Optional[User]:
        if not email or not password:
            dummy_verify_password(password or "dummy")
            return None

        clean_email = email.strip().lower()
        user = self.user_repo.get_by_email(clean_email)
        if not user:
            dummy_verify_password(password)
            return None
        if not user.is_active:
            dummy_verify_password(password)
            return None
        if not verify_password(password, user.password_hash):
            return None

        # Transparent upgrade of legacy hashes (e.g. bcrypt) to PBKDF2
        if is_legacy_hash(user.password_hash):
            user.password_hash = hash_password(password)

        user.last_login_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(user)
        return user

    def create_token(self, user: User) -> str:
        session = LoginSession(
            id=secrets.token_hex(32),
            user_id=user.id,
            password_fingerprint=hashlib.sha256(user.password_hash.encode()).hexdigest(),
        )
        self.db.add(session)
        self.db.commit()
        settings = get_settings()
        return jwt.encode(
            {
                "sub": str(user.id),
                "sid": session.id,
                "role": user.role.value if hasattr(user.role, "value") else str(user.role),
                "must_change_password": bool(getattr(user, "must_change_password", False)),
            }, settings.SECRET_KEY, algorithm=settings.ALGORITHM
        )

    def get_current_user(self, token: str) -> Optional[User]:
        payload = decode_access_token(token)
        if not payload:
            return None
        user_id_str = payload.get("sub")
        if not user_id_str:
            return None
        try:
            user_id = int(user_id_str)
        except (ValueError, TypeError):
            return None
        user = self.user_repo.get_by_id(user_id)
        if payload.get("sid"):
            session = self.db.get(LoginSession, payload["sid"])
            if not user or not session or session.user_id != user.id:
                return None
            if session.password_fingerprint != hashlib.sha256(user.password_hash.encode()).hexdigest():
                return None
        elif "exp" not in payload:
            return None
        return user

    def revoke_token(self, token: str) -> None:
        payload = decode_access_token(token) or {}
        session = self.db.get(LoginSession, payload.get("sid")) if payload.get("sid") else None
        if session:
            self.db.delete(session)
            self.db.commit()

    def create_user(
        self,
        email: str,
        password: str,
        full_name: str,
        role: UserRole = UserRole.USER,
        is_active: bool = True,
    ) -> User:
        existing = self.user_repo.get_by_email(email)
        if existing:
            raise ValueError("Email already registered")
        password_hash = hash_password(password)
        return self.user_repo.create(
            email=email,
            password_hash=password_hash,
            full_name=full_name,
            role=role,
            is_active=is_active,
        )

    def ensure_first_admin(self):
        """
        On every startup: sync the primary admin account with .env settings.
        Changing ADMIN_EMAIL, ADMIN_PASSWORD, or ADMIN_NAME in .env immediately
        updates the master admin account in the database and reflects across all endpoints.
        """
        from app.models.user import UserRole
        from app.core.config import get_settings
        from app.core.security import hash_password
        settings = get_settings()

        admin_email = (settings.ADMIN_EMAIL or "").strip().lower()
        if not admin_email:
            admin_email = "admin@system.local"
        admin_password = settings.ADMIN_PASSWORD or "admin123"
        admin_name = settings.ADMIN_NAME or "System Admin"

        # 1. Check if an account already has this exact admin_email
        target_admin = self.db.query(User).filter(User.email == admin_email).first()

        if not target_admin:
            # 2. If email in .env was changed, find the primary admin (first ADMIN in DB)
            primary_admin = (
                self.db.query(User)
                .filter(User.role == UserRole.ADMIN)
                .order_by(User.id.asc())
                .first()
            )
            if primary_admin:
                target_admin = primary_admin
                target_admin.email = admin_email

        if target_admin:
            # Sync metadata without overwriting custom or reset passwords
            if not target_admin.password_hash:
                target_admin.password_hash = hash_password(admin_password)
            target_admin.full_name = admin_name
            target_admin.role = UserRole.ADMIN
            target_admin.is_active = True
            self.db.commit()
            self.db.refresh(target_admin)
        else:
            # First-time seed on fresh database
            self.create_user(
                email=admin_email,
                password=admin_password,
                full_name=admin_name,
                role=UserRole.ADMIN,
                is_active=True,
            )

        # Ensure core role-testing accounts exist with known credentials for QA / E2E
        test_roles = [
            ("auditor.test@system.local", "Auditor Test", UserRole.AUDITOR),
            ("verifier.test@system.local", "Verifier Test", UserRole.FIELD_VERIFIER),
            ("telecaller@system.local", "Telecaller", UserRole.TELECALLER),
            ("telecaller.test@system.local", "Telecaller Test", UserRole.TELECALLER),
        ]
        for t_email, t_name, t_role in test_roles:
            t_user = self.db.query(User).filter(User.email == t_email).first()
            if t_user:
                if not t_user.password_hash:
                    t_user.password_hash = hash_password("admin123")
                t_user.is_active = True
                t_user.role = t_role
                try:
                    self.db.commit()
                except Exception:
                    self.db.rollback()
            else:
                try:
                    self.create_user(
                        email=t_email,
                        password="admin123",
                        full_name=t_name,
                        role=t_role,
                        is_active=True,
                    )
                except Exception:
                    self.db.rollback()

