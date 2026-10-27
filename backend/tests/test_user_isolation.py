import pytest

from tests.conftest import auth_header


class TestUserIsolation:
    """Test that users cannot access each other's records."""

    def _create_user_with_record(self, client, email, name, record_name):
        """Helper to create a user, login, and create a record."""
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        # Register via admin
        # We'll use the DB directly for test setup
        response = client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": "adminpass123"},
        )
        admin_token = response.json()["access_token"]

        # Create user via admin API
        client.post(
            "/api/admin/users",
            json={
                "email": email,
                "password": "password123",
                "full_name": name,
                "role": "USER",
            },
            headers=auth_header(admin_token),
        )

        # Login as new user
        response = client.post(
            "/api/auth/login",
            json={"email": email, "password": "password123"},
        )
        token = response.json()["access_token"]

        # Create record
        response = client.post(
            "/api/records",
            json={"name": record_name, "description": "", "photos": []},
            headers=auth_header(token),
        )
        record_id = response.json()["id"]
        return token, record_id

    def test_users_cannot_see_each_others_records(
        self, client, test_admin
    ):
        token_a, record_a = self._create_user_with_record(
            client, "userA@example.com", "User A", "Record A"
        )
        token_b, record_b = self._create_user_with_record(
            client, "userB@example.com", "User B", "Record B"
        )

        # User A should not see Record B
        response = client.get(
            f"/api/records/{record_b}",
            headers=auth_header(token_a),
        )
        assert response.status_code == 403

        # User B should not see Record A
        response = client.get(
            f"/api/records/{record_a}",
            headers=auth_header(token_b),
        )
        assert response.status_code == 403

        # User A should only see their own record in list
        response = client.get(
            "/api/records",
            headers=auth_header(token_a),
        )
        assert response.status_code == 200
        records = response.json()["records"]
        record_ids = [r["id"] for r in records]
        assert record_a in record_ids
        assert record_b not in record_ids


class TestAdminAuthorization:
    def test_non_admin_cannot_access_admin_endpoints(self, client, user_token):
        endpoints = [
            "/api/admin/dashboard",
            "/api/admin/users",
            "/api/admin/records",
            "/api/admin/locations",
        ]
        for endpoint in endpoints:
            response = client.get(endpoint, headers=auth_header(user_token))
            assert response.status_code == 403, f"{endpoint} should be admin-only"

    def test_admin_can_access_admin_endpoints(self, client, admin_token):
        response = client.get(
            "/api/admin/dashboard", headers=auth_header(admin_token)
        )
        assert response.status_code == 200

        response = client.get(
            "/api/admin/users", headers=auth_header(admin_token)
        )
        assert response.status_code == 200


class TestDeactivatedUser:
    def test_deactivated_user_cannot_create_records(self, client, test_user, admin_token):
        # Deactivate user
        client.post(
            f"/api/admin/users/{test_user.id}/deactivate",
            headers=auth_header(admin_token),
        )

        # Login (should fail for inactive)
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "testpass123"},
        )
        assert response.status_code == 401
