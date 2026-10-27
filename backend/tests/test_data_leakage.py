import pytest
from tests.conftest import auth_header


class TestCredentialLeakage:
    """Ensure passwords and password hashes are never exposed in any API response."""

    def test_auth_me_does_not_leak_password_hash(self, client, user_token):
        response = client.get("/api/auth/me", headers=auth_header(user_token))
        assert response.status_code == 200
        text = response.text
        data = response.json()
        assert "password" not in data
        assert "password_hash" not in data
        assert "$2b$" not in text
        assert "$2a$" not in text

    def test_auth_login_does_not_leak_sensitive_info(self, client, test_user):
        response = client.post(
            "/api/auth/login",
            json={"email": test_user.email, "password": "testpass123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "password" not in data
        assert "password_hash" not in data
        assert "$2b$" not in response.text

    def test_auth_profile_update_does_not_leak_password_hash(self, client, user_token):
        response = client.put(
            "/api/auth/profile",
            headers=auth_header(user_token),
            json={
                "current_password": "testpass123",
                "full_name": "Updated Name Leak Test",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "password" not in data["user"]
        assert "password_hash" not in data["user"]
        assert "$2b$" not in response.text

    def test_public_reset_password_does_not_leak_credentials(self, client, test_user):
        response = client.post(
            "/api/auth/reset-password",
            json={"email": test_user.email, "new_password": "newSecurePassword123!"},
        )
        assert response.status_code == 400
        text = response.text
        assert "$2b$" not in text
        assert "pbkdf2_sha256" not in text
        assert "newSecurePassword123!" not in text

    def test_admin_user_endpoints_do_not_leak_password_hash(
        self, client, admin_token, test_user
    ):
        # 1. List users
        resp_list = client.get("/api/admin/users", headers=auth_header(admin_token))
        assert resp_list.status_code == 200
        assert "password_hash" not in resp_list.text
        assert "$2b$" not in resp_list.text
        assert "pbkdf2_sha256" not in resp_list.text

        # 2. Get single user
        resp_user = client.get(
            f"/api/admin/users/{test_user.id}", headers=auth_header(admin_token)
        )
        assert resp_user.status_code == 200
        assert "password_hash" not in resp_user.text
        assert "$2b$" not in resp_user.text
        assert "pbkdf2_sha256" not in resp_user.text

        # 3. Create user (auto-generates temporary password for one-time admin handover)
        resp_create = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={
                "email": "leaktest_created@example.com",
                "full_name": "Created Leak Test",
                "role": "USER",
            },
        )
        assert resp_create.status_code == 201
        assert "password_hash" not in resp_create.text
        assert "$2b$" not in resp_create.text
        assert "pbkdf2_sha256" not in resp_create.text
        assert "temporary_password" in resp_create.json()

        # 4. Admin reset password
        resp_reset = client.post(
            f"/api/admin/users/{test_user.id}/reset-password",
            headers=auth_header(admin_token),
            json={},
        )
        assert resp_reset.status_code == 200
        assert "password_hash" not in resp_reset.text
        assert "$2b$" not in resp_reset.text
        assert "pbkdf2_sha256" not in resp_reset.text
        assert "temporary_password" in resp_reset.json()


class TestActivityLogDataLeakage:
    """Verify passwords or secret credentials are never saved into audit log details."""

    def test_failed_login_does_not_log_attempted_password(self, client, admin_token):
        secret_wrong_pwd = "MySecretAttemptedPassword123!"
        # Attempt failed login
        client.post(
            "/api/auth/login",
            json={"email": "victim@example.com", "password": secret_wrong_pwd},
        )

        # Inspect admin logs
        resp = client.get("/api/admin/logs?limit=50", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert secret_wrong_pwd not in resp.text

    def test_admin_reset_does_not_log_new_password(
        self, client, admin_token, test_user
    ):
        secret_pwd = "NewAdminSetSecretPassword456!"
        client.post(
            f"/api/admin/users/{test_user.id}/reset-password",
            headers=auth_header(admin_token),
            json={"new_password": secret_pwd},
        )

        # Inspect admin logs
        resp = client.get("/api/admin/logs?limit=50", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert secret_pwd not in resp.text



class TestCrossUserIsolationLeakage:
    """Verify User A's private data is completely invisible to User B."""

    def test_user_cannot_see_other_users_records_in_list(
        self, client, test_user, user_token, db_session
    ):
        from app.models.user import User, UserRole
        from app.models.capture_record import CaptureRecord
        from app.core.security import hash_password

        # Create User B
        user_b = User(
            email="user_b_leak@example.com",
            password_hash=hash_password("pass"),
            full_name="User B Confidential",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(user_b)
        db_session.commit()
        db_session.refresh(user_b)

        # Create record belonging to User B
        rec_b = CaptureRecord(
            user_id=user_b.id,
            name="Confidential Military Audit Site 7",
            description="Top secret survey data with sensitive coordinates",
        )
        db_session.add(rec_b)
        db_session.commit()

        # User A calls list_records
        resp = client.get("/api/records", headers=auth_header(user_token))
        assert resp.status_code == 200
        data = resp.json()
        # Verify User A receives 0 records of User B
        assert "Confidential Military Audit Site 7" not in resp.text
        assert "Top secret survey data" not in resp.text
        for r in data["records"]:
            assert r["user_id"] == test_user.id

    def test_user_cannot_see_other_users_records_in_dashboard(
        self, client, test_user, user_token, db_session
    ):
        from app.models.user import User, UserRole
        from app.models.capture_record import CaptureRecord
        from app.core.security import hash_password

        user_b = User(
            email="user_b_dash@example.com",
            password_hash=hash_password("pass"),
            full_name="User B",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(user_b)
        db_session.commit()
        db_session.refresh(user_b)

        rec_b = CaptureRecord(
            user_id=user_b.id,
            name="Private Contract Project Alpha",
            description="Proprietary client assets",
        )
        db_session.add(rec_b)
        db_session.commit()

        # User A calls dashboard
        resp = client.get("/api/records/dashboard", headers=auth_header(user_token))
        assert resp.status_code == 200
        assert "Private Contract Project Alpha" not in resp.text
        assert "Proprietary client assets" not in resp.text

    def test_unauthorized_record_fetch_does_not_leak_metadata(
        self, client, user_token, db_session
    ):
        from app.models.user import User, UserRole
        from app.models.capture_record import CaptureRecord
        from app.core.security import hash_password

        user_b = User(
            email="user_b_direct@example.com",
            password_hash=hash_password("pass"),
            full_name="User B",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(user_b)
        db_session.commit()
        db_session.refresh(user_b)

        rec_b = CaptureRecord(
            user_id=user_b.id,
            name="Restricted Facility Investigation",
            description="Confidential incident report",
            location_name="Classified Zone 9",
            formatted_address="100 Secret Base Way, Nevada",
        )
        db_session.add(rec_b)
        db_session.commit()
        db_session.refresh(rec_b)

        # User A attempts to view record directly
        resp = client.get(f"/api/records/{rec_b.id}", headers=auth_header(user_token))
        assert resp.status_code == 403
        # Response body must not leak any details
        assert "Restricted Facility Investigation" not in resp.text
        assert "Confidential incident report" not in resp.text
        assert "Classified Zone 9" not in resp.text
        assert "100 Secret Base Way" not in resp.text


class TestUnauthenticatedAccessDataLeakage:
    """Verify that unauthenticated callers get zero data from protected endpoints."""

    @pytest.mark.parametrize(
        "endpoint",
        [
            "/api/records",
            "/api/records/dashboard",
            "/api/records/1",
            "/api/records/1/image/1",
            "/api/admin/dashboard",
            "/api/admin/users",
            "/api/admin/logs",
            "/api/admin/records",
            "/api/admin/locations",
            "/api/auth/me",
        ],
    )
    def test_unauthenticated_request_leaks_no_data(self, client, endpoint):
        resp = client.get(endpoint)
        assert resp.status_code == 401
        data = resp.json()
        assert "Missing authorization header or token" in data.get("detail", "")
        # Ensure no accidental data payload in response
        assert "records" not in data
        assert "users" not in data
        assert "items" not in data


class TestEnvironmentAndInternalInfoLeakage:
    """Verify system endpoints do not leak internal config, server filepaths, or database connections."""

    def test_health_check_leaks_no_environment_secrets(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"status": "ok"}
        # Ensure no secrets leak
        text = resp.text
        assert "change-me-in-production" not in text
        assert "sqlite" not in text
        assert "DATABASE_URL" not in text
        assert "SECRET_KEY" not in text

    def test_api_health_check_leaks_no_environment_secrets(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_root_endpoint_leaks_no_secrets(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"app", "docs", "health"}

    def test_error_responses_do_not_leak_stack_traces_or_paths(self, client):
        # Trigger a 404
        resp_404 = client.get("/api/records/99999999")
        assert resp_404.status_code == 401  # Unauthenticated first

        # Trigger a 422 with bad JSON
        resp_422 = client.post("/api/auth/login", json={"bad_field": 123})
        assert resp_422.status_code == 422
        text_422 = resp_422.text
        assert "Traceback" not in text_422
        assert "File \"" not in text_422
        assert "site-packages" not in text_422
        assert "OneDrive" not in text_422
        assert "app.db" not in text_422

    def test_admin_locations_blocked_from_regular_users(self, client, user_token):
        """Field users cannot scrape global coordinates across the organization."""
        resp = client.get("/api/admin/locations", headers=auth_header(user_token))
        assert resp.status_code == 403
