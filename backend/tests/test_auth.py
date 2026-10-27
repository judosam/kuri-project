import pytest

from tests.conftest import auth_header


class TestLogin:
    def test_login_success(self, client, test_user):
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "testpass123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client, test_user):
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "wrongpass"},
        )
        assert response.status_code == 401

    def test_login_nonexistent_user(self, client):
        response = client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "pass"},
        )
        assert response.status_code == 401


class TestMe:
    def test_get_me_authenticated(self, client, user_token):
        response = client.get("/api/auth/me", headers=auth_header(user_token))
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@example.com"
        assert data["full_name"] == "Test User"
        assert data["role"] == "USER"
        assert data["is_active"] is True

    def test_get_me_no_token(self, client):
        response = client.get("/api/auth/me")
        assert response.status_code == 401

    def test_get_me_invalid_token(self, client):
        response = client.get(
            "/api/auth/me", headers={"Authorization": "Bearer invalid"}
        )
        assert response.status_code == 401


class TestInactiveUser:
    def test_inactive_user_cannot_login(self, client, db_session):
        from app.models.user import User, UserRole
        from app.core.security import hash_password

        user = User(
            email="inactive@example.com",
            password_hash=hash_password("pass123"),
            full_name="Inactive User",
            role=UserRole.USER,
            is_active=False,
        )
        db_session.add(user)
        db_session.commit()

        response = client.post(
            "/api/auth/login",
            json={"email": "inactive@example.com", "password": "pass123"},
        )
        assert response.status_code == 401


class TestPublicResetDisabled:
    def test_public_reset_password_is_disabled(self, client, test_user):
        response = client.post(
            "/api/auth/reset-password",
            json={"email": test_user.email, "new_password": "NewSecurePass88!"},
        )
        assert response.status_code == 400
        assert "disabled" in response.json()["detail"].lower()


class TestChangePassword:
    def test_change_password_success(self, client, test_user, user_token):
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "testpass123",
                "new_password": "NewSecurePass88!",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "Password changed successfully" in data["message"]

        # Old password must fail login
        old_resp = client.post(
            "/api/auth/login",
            json={"email": test_user.email, "password": "testpass123"},
        )
        assert old_resp.status_code == 401

        # New password must succeed login
        new_resp = client.post(
            "/api/auth/login",
            json={"email": test_user.email, "password": "NewSecurePass88!"},
        )
        assert new_resp.status_code == 200
        assert "access_token" in new_resp.json()
        assert new_resp.json()["must_change_password"] is False

    def test_change_password_wrong_current_password(self, client, test_user, user_token):
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "WrongPassword123!",
                "new_password": "NewSecurePass88!",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()

    def test_change_password_same_password_rejected(self, client, test_user, user_token):
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "testpass123",
                "new_password": "testpass123",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 400
        assert "cannot be the same" in response.json()["detail"].lower()

    def test_change_password_too_short(self, client, test_user, user_token):
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "testpass123",
                "new_password": "short",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 400
        assert "between 8 and 128 characters" in response.json()["detail"].lower()

    def test_change_password_unauthenticated(self, client):
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "testpass123",
                "new_password": "NewSecurePass88!",
            },
        )
        assert response.status_code == 401


