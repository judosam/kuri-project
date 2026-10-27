import pytest
from tests.conftest import auth_header
from app.models.user import User, UserRole
from app.core.security import hash_password


class TestRoleHierarchyAndPermissions:
    """Verify 2-tier permissions: ADMIN and USER."""

    def test_admin_can_access_audit_logs(self, client, admin_token):
        response = client.get("/api/admin/logs", headers=auth_header(admin_token))
        assert response.status_code == 200
        assert "items" in response.json()

    def test_admin_can_access_standard_admin_endpoints(self, client, admin_token):
        # 1. Dashboard
        dash_res = client.get("/api/admin/dashboard", headers=auth_header(admin_token))
        assert dash_res.status_code == 200

        # 2. Records
        rec_res = client.get("/api/admin/records", headers=auth_header(admin_token))
        assert rec_res.status_code == 200

        # 3. Users
        user_res = client.get("/api/admin/users", headers=auth_header(admin_token))
        assert user_res.status_code == 200

        # 4. Locations
        loc_res = client.get("/api/admin/locations", headers=auth_header(admin_token))
        assert loc_res.status_code == 200

    def test_user_cannot_access_any_admin_endpoints(self, client, user_token):
        for endpoint in ["/api/admin/dashboard", "/api/admin/records", "/api/admin/users", "/api/admin/logs", "/api/admin/locations"]:
            res = client.get(endpoint, headers=auth_header(user_token))
            assert res.status_code == 403
            detail = res.json().get("detail", "")
            assert "Admin" in detail or "Administrator" in detail

    def test_admin_can_create_another_admin(self, client, admin_token):
        res = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={
                "email": "new_admin@example.com",
                "password": "Password123!",
                "full_name": "New Admin User",
                "role": "ADMIN",
            },
        )
        assert res.status_code == 201
        assert res.json()["role"] == "ADMIN"

    def test_admin_can_create_regular_user(self, client, admin_token):
        res = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={
                "email": "new_user@example.com",
                "password": "Password123!",
                "full_name": "New Field User",
                "role": "USER",
            },
        )
        assert res.status_code == 201
        assert res.json()["role"] == "USER"

    def test_cannot_create_user_with_invalid_role(self, client, admin_token):
        res = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={
                "email": "invalid_role@example.com",
                "password": "Password123!",
                "full_name": "Invalid Role User",
                "role": "SUPERADMIN",
            },
        )
        assert res.status_code in (400, 422)

    def test_admin_cannot_deactivate_self(self, client, admin_token, test_admin):
        res = client.post(
            f"/api/admin/users/{test_admin.id}/deactivate",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 400
        assert "Cannot deactivate your own account" in res.json()["detail"]

    def test_admin_can_deactivate_other_user(self, client, admin_token, test_user):
        res = client.post(
            f"/api/admin/users/{test_user.id}/deactivate",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["is_active"] is False

    def test_admin_can_deactivate_other_admin(self, client, admin_token, db_session):
        other_admin = User(
            email="other_adm@example.com",
            password_hash=hash_password("pass123"),
            full_name="Other Admin",
            role=UserRole.ADMIN,
            is_active=True,
        )
        db_session.add(other_admin)
        db_session.commit()
        db_session.refresh(other_admin)

        res = client.post(
            f"/api/admin/users/{other_admin.id}/deactivate",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["is_active"] is False

    def test_public_mobile_reset_disabled_for_all(self, client, test_admin, test_user):
        res_adm = client.post(
            "/api/auth/reset-password",
            json={"email": test_admin.email, "new_password": "NewSecret123!"},
        )
        assert res_adm.status_code == 400
        assert "disabled" in res_adm.json()["detail"].lower()

        res_usr = client.post(
            "/api/auth/reset-password",
            json={"email": test_user.email, "new_password": "NewPassword123!"},
        )
        assert res_usr.status_code == 400
        assert "disabled" in res_usr.json()["detail"].lower()

