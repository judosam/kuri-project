import pytest
from jose import jwt
from tests.conftest import auth_header


class TestSqlInjectionProtection:
    """Verify system is resilient against SQL injection vectors."""

    @pytest.mark.parametrize(
        "malicious_email",
        [
            "' OR '1'='1",
            "admin' --",
            "' UNION SELECT * FROM users --",
            "'; DROP TABLE users; --",
            "admin' OR 1=1#",
            "' OR ''='",
        ],
    )
    def test_sql_injection_in_login_rejected(self, client, malicious_email):
        response = client.post(
            "/api/auth/login",
            json={"email": malicious_email, "password": "password123"},
        )
        assert response.status_code in [401, 422]
        # Ensure error detail doesn't leak raw SQL errors
        if response.status_code == 401:
            assert "Invalid email or password" in response.json()["detail"]


class TestPathTraversalProtection:
    """Verify local storage service blocks path traversal attempts."""

    def test_local_storage_blocks_parent_directory_traversal(self):
        from app.services.local_storage_service import LocalStorageService

        storage = LocalStorageService()
        # Attempt traversal outside UPLOAD_DIR
        assert storage.get_file_path("../../etc/passwd") is None
        assert storage.get_file_path("..\\..\\Windows\\System32\\calc.exe") is None
        assert storage.get_file_path("/etc/shadow") is None
        assert storage.delete_file("../../etc/passwd") is False

    def test_image_serving_enforces_user_isolation_idor(
        self, client, user_token, test_user, db_session
    ):
        """User A cannot access User B's photo even if they guess record and image IDs."""
        from app.models.user import User, UserRole
        from app.models.capture_record import CaptureRecord
        from app.models.captured_image import CapturedImage
        from app.core.security import hash_password
        from datetime import datetime, timezone

        other_user = User(
            email="other_field_op@example.com",
            password_hash=hash_password("pass123"),
            full_name="Other Operator",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other_user)
        db_session.commit()
        db_session.refresh(other_user)

        other_rec = CaptureRecord(
            user_id=other_user.id,
            name="Confidential Record",
            description="Restricted site audit",
        )
        db_session.add(other_rec)
        db_session.commit()
        db_session.refresh(other_rec)

        other_img = CapturedImage(
            record_id=other_rec.id,
            google_drive_file_id="simulated-image-key",
            file_name="Record_Secret_Photo_1.jpg",
            photo_order=1,
            latitude=37.7749,
            longitude=-122.4194,
            location_accuracy=5.0,
            captured_at=datetime.now(timezone.utc),
        )
        db_session.add(other_img)
        db_session.commit()
        db_session.refresh(other_img)

        # Attacker tries to download Victim's image
        response = client.get(
            f"/api/records/{other_rec.id}/image/{other_img.id}",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403
        assert "Not authorized" in response.json()["detail"]


class TestSecurityHeaders:
    """Verify production security headers are attached to all HTTP responses."""

    def test_security_headers_present(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        headers = response.headers
        assert headers.get("X-Content-Type-Options") == "nosniff"
        assert headers.get("X-Frame-Options") == "DENY"
        assert headers.get("X-XSS-Protection") == "1; mode=block"
        assert headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


class TestPrivilegeEscalationProtection:
    """Ensure regular users cannot perform administrative actions."""

    def test_regular_user_cannot_access_admin_dashboard(self, client, user_token):
        response = client.get("/api/admin/dashboard", headers=auth_header(user_token))
        assert response.status_code == 403

    def test_regular_user_cannot_view_audit_logs(self, client, user_token):
        response = client.get("/api/admin/logs", headers=auth_header(user_token))
        assert response.status_code == 403


    def test_regular_user_cannot_list_all_users(self, client, user_token):
        response = client.get("/api/admin/users", headers=auth_header(user_token))
        assert response.status_code == 403

    def test_public_reset_endpoint_protects_admin_accounts(self, client, test_admin):
        response = client.post(
            "/api/auth/reset-password",
            json={"email": test_admin.email, "new_password": "NewSecretPassword99!"},
        )
        assert response.status_code == 400
        assert "Self-service password reset is disabled" in response.json()["detail"]


class TestCryptographicIntegrity:
    """Verify cryptographic hashing and non-leakage of secrets."""

    def test_passwords_are_pbkdf2_hashed(self, db_session, test_user):
        from app.models.user import User

        user = db_session.query(User).filter(User.id == test_user.id).first()
        assert user.password_hash.startswith("pbkdf2_sha256$200000$")
        parts = user.password_hash.split("$")
        assert len(parts) == 4
        assert parts[1] == "200000"
        # 16 bytes salt = 32 hex chars
        assert len(parts[2]) == 32
        # SHA256 digest = 64 hex chars
        assert len(parts[3]) == 64
        # Plaintext password is never stored
        assert "testpass123" not in user.password_hash

    def test_password_hash_never_exposed_in_api(self, client, admin_token, user_token, test_user):
        # 1. Check /api/auth/me
        me_resp = client.get("/api/auth/me", headers=auth_header(user_token))
        assert me_resp.status_code == 200
        me_data = me_resp.json()
        assert "password" not in me_data
        assert "password_hash" not in me_data

        # 2. Check /api/admin/users
        users_resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        assert users_resp.status_code == 200
        for u in users_resp.json()["users"]:
            assert "password" not in u
            assert "password_hash" not in u


class TestJwtTamperResistance:
    """Verify JWT tokens cannot be forged or tampered with."""

    def test_forged_role_in_token_rejected(self, client, test_user):
        """Attacker signs token with a fake secret key to escalate role to ADMIN."""
        fake_secret = "attacker-secret-key-1234567890"
        forged_token = jwt.encode(
            {"sub": str(test_user.id), "role": "ADMIN"},
            fake_secret,
            algorithm="HS256",
        )
        response = client.get("/api/admin/dashboard", headers=auth_header(forged_token))
        assert response.status_code == 401


class TestXssPayloadHandling:
    """Verify input fields accept HTML/scripts safely without executing."""

    def test_xss_in_record_name_handled_safely(self, client, user_token):
        xss_payload = "<script>alert('XSS')</script>"
        response = client.post(
            "/api/records",
            headers=auth_header(user_token),
            json={
                "name": xss_payload,
                "description": "<img src=x onerror=alert(1)>",
                "photos": [],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == xss_payload
