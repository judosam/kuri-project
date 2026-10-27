import pytest

from tests.conftest import auth_header


class TestBrokenObjectLevelAuthorization:
    """Test that users cannot access other users' resources."""

    def test_user_cannot_access_other_user_record_via_url(
        self, client, user_token, db_session
    ):
        """Attempt to access another user's record by changing the ID."""
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from app.models.capture_record import CaptureRecord

        other = User(
            email="victim@example.com",
            password_hash=hash_password("pass"),
            full_name="Victim",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        db_session.refresh(other)

        record = CaptureRecord(
            user_id=other.id, name="Secret Record", description="Private data"
        )
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        # Attacker tries to access victim's record
        response = client.get(
            f"/api/records/{record.id}",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403

    def test_user_cannot_modify_other_user_record(
        self, client, user_token, db_session
    ):
        """Attempt to update another user's record."""
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from app.models.capture_record import CaptureRecord

        other = User(
            email="victim2@example.com",
            password_hash=hash_password("pass"),
            full_name="Victim2",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        db_session.refresh(other)

        record = CaptureRecord(
            user_id=other.id, name="Original", description=""
        )
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        # No PUT endpoint for regular users, but verify via admin endpoint
        # that a non-admin cannot use admin endpoints
        response = client.put(
            f"/api/admin/records/{record.id}",
            json={"name": "Hacked"},
            headers=auth_header(user_token),
        )
        assert response.status_code == 403


class TestTokenSecurity:
    def test_expired_token_rejected(self, client, test_user):
        """Expired tokens should be rejected."""
        from app.core.security import create_access_token
        from datetime import timedelta

        token = create_access_token(
            {"sub": str(test_user.id), "role": "USER"},
            expires_delta=timedelta(seconds=-1),  # Already expired
        )
        response = client.get(
            "/api/auth/me", headers=auth_header(token)
        )
        assert response.status_code == 401

    def test_tampered_token_rejected(self, client, test_user):
        """Tampered tokens should be rejected."""
        from app.core.security import create_access_token

        token = create_access_token(
            {"sub": str(test_user.id), "role": "USER"}
        )
        # Tamper with the token
        tampered = token[:-5] + "XXXXX"
        response = client.get(
            "/api/auth/me", headers=auth_header(tampered)
        )
        assert response.status_code == 401

    def test_missing_bearer_prefix(self, client, user_token):
        """Tokens without Bearer prefix should still work."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": user_token},
        )
        # Should work with or without Bearer prefix
        assert response.status_code == 200


class TestAdminSecurity:
    def test_non_admin_cannot_create_users(self, client, user_token):
        response = client.post(
            "/api/admin/users",
            json={
                "email": "newuser@example.com",
                "password": "pass",
                "full_name": "New",
                "role": "ADMIN",
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 403

    def test_non_admin_cannot_delete_records(self, client, user_token):
        response = client.delete(
            "/api/admin/records/1",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403

    def test_admin_cannot_deactivate_self(
        self, client, admin_token, test_admin
    ):
        """Prevent admin from deactivating their own account."""
        response = client.post(
            f"/api/admin/users/{test_admin.id}/deactivate",
            headers=auth_header(admin_token),
        )
        assert response.status_code == 400
        assert "Cannot deactivate your own account" in response.json()["detail"]



class TestInputValidation:
    def test_invalid_email_rejected(self, client, admin_token):
        response = client.post(
            "/api/admin/users",
            json={
                "email": "not-an-email",
                "password": "pass",
                "full_name": "Test",
            },
            headers=auth_header(admin_token),
        )
        assert response.status_code == 422

    def test_empty_password_rejected(self, client, admin_token):
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": ""},
        )
        assert response.status_code == 401

    def test_invalid_role_rejected(self, client, admin_token):
        response = client.post(
            "/api/admin/users",
            json={
                "email": "test@example.com",
                "password": "pass",
                "full_name": "Test",
                "role": "SUPERADMIN",  # Invalid role
            },
            headers=auth_header(admin_token),
        )
        assert response.status_code == 422
