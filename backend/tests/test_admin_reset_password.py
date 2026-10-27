import pytest
from tests.conftest import auth_header

class TestAdminResetPassword:
    def test_admin_can_reset_user_password_without_viewing_or_knowing_old_password(
        self, client, admin_token, test_user
    ):
        # 1. Admin resets user's password to a brand new password
        new_secret = "BrandNewSecret99!"
        response = client.post(
            f"/api/admin/users/{test_user.id}/reset-password",
            headers=auth_header(admin_token),
            json={"new_password": new_secret},
        )
        assert response.status_code == 200
        data = response.json()
        # Verify sanitized user data is returned and NO password hash is exposed
        assert data["id"] == test_user.id
        assert data["email"] == test_user.email
        assert "password" not in data
        assert "password_hash" not in data

        # 2. Verify old password no longer works
        old_login_resp = client.post(
            "/api/auth/login",
            json={"email": test_user.email, "password": "testpass123"},
        )
        assert old_login_resp.status_code == 401

        # 3. Verify user can now log in with new password
        new_login_resp = client.post(
            "/api/auth/login",
            json={"email": test_user.email, "password": new_secret},
        )
        assert new_login_resp.status_code == 200
        new_token_data = new_login_resp.json()
        assert "access_token" in new_token_data

    def test_regular_user_cannot_reset_passwords(self, client, user_token, test_user):
        response = client.post(
            f"/api/admin/users/{test_user.id}/reset-password",
            headers=auth_header(user_token),
            json={"new_password": "NewSecret123!"},
        )
        assert response.status_code == 403

    def test_reset_password_too_short(self, client, admin_token, test_user):
        response = client.post(
            f"/api/admin/users/{test_user.id}/reset-password",
            headers=auth_header(admin_token),
            json={"new_password": "123"},
        )
        assert response.status_code == 400
        assert "at least 6 characters" in response.json()["detail"]


class TestAdminCreateUserAutoPassword:
    def test_admin_create_user_auto_generates_password(self, client, admin_token):
        # Admin creates account without password
        response = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={
                "email": "autogen_test@example.com",
                "full_name": "Auto Gen User",
                "role": "USER",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "autogen_test@example.com"
        assert data["must_change_password"] is True
        assert "temporary_password" in data
        temp_pwd = data["temporary_password"]
        assert len(temp_pwd) == 16
        # Must contain uppercase, lowercase, digit, and special symbol
        assert any(c.isupper() for c in temp_pwd)
        assert any(c.islower() for c in temp_pwd)
        assert any(c.isdigit() for c in temp_pwd)
        assert any(c in "!@#$%^&*()-_=+" for c in temp_pwd)

        # Verify user can log in with this auto-generated temporary password
        login_resp = client.post(
            "/api/auth/login",
            json={"email": "autogen_test@example.com", "password": temp_pwd},
        )
        assert login_resp.status_code == 200
        login_data = login_resp.json()
        assert "access_token" in login_data
        assert login_data["must_change_password"] is True

