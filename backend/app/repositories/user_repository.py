from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User, UserRole


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_by_email(self, email: str) -> Optional[User]:
        if not email:
            return None
        clean_email = email.strip().lower()
        return self.db.query(User).filter(func.lower(User.email) == clean_email).first()

    def create(
        self,
        email: str,
        password_hash: str,
        full_name: str,
        role: UserRole = UserRole.USER,
        is_active: bool = True,
        must_change_password: bool = False,
    ) -> User:
        user = User(
            email=email.strip().lower() if email else email,
            password_hash=password_hash,
            full_name=full_name,
            role=role,
            is_active=is_active,
            must_change_password=must_change_password,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def list_users(
        self,
        page: int = 1,
        page_size: int = 20,
        search: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> tuple[List[User], int]:
        query = self.db.query(User)

        if search:
            search_filter = f"%{search}%"
            query = query.filter(
                (User.email.ilike(search_filter))
                | (User.full_name.ilike(search_filter))
            )

        if is_active is not None:
            query = query.filter(User.is_active == is_active)

        total = query.count()
        users = (
            query.order_by(User.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return users, total

    def update(self, user: User, **kwargs) -> User:
        for key, value in kwargs.items():
            if value is not None and hasattr(user, key):
                setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def activate(self, user: User) -> User:
        user.is_active = True
        self.db.commit()
        self.db.refresh(user)
        return user

    def deactivate(self, user: User) -> User:
        user.is_active = False
        self.db.commit()
        self.db.refresh(user)
        return user

    def count(self) -> int:
        return self.db.query(User).count()
