"""Test the per-user dashboard endpoint (/records/dashboard)."""

import io
import pytest
from PIL import Image

from tests.conftest import auth_header


def _make_jpeg(width=100, height=100):
    img = Image.new("RGB", (width, height), color=(0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    return buf.getvalue()


class TestUserDashboard:
    def test_dashboard_empty_for_new_user(self, client, user_token):
        resp = client.get("/api/records/dashboard", headers=auth_header(user_token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_records"] == 0
        assert data["today_records"] == 0
        assert data["month_records"] == 0
        assert data["total_photos"] == 0
        assert data["recent_records"] == []

    def test_dashboard_counts_own_records(self, client, user_token):
        headers = auth_header(user_token)
        for i in range(3):
            resp = client.post(
                "/api/records",
                json={"name": f"Dash {i}", "description": ""},
                headers=headers,
            )
            assert resp.status_code == 201

        resp = client.get("/api/records/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_records"] == 3
        assert data["total_photos"] == 0
        assert len(data["recent_records"]) == 3
        # Newest first
        assert data["recent_records"][0]["name"] == "Dash 2"

    def test_dashboard_isolates_users(self, client, user_token, db_session):
        """User A's dashboard must not include user B's records."""
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from app.models.capture_record import CaptureRecord

        other = User(
            email="otherdash@example.com",
            password_hash=hash_password("pass"),
            full_name="Other",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        db_session.refresh(other)

        db_session.add(CaptureRecord(user_id=other.id, name="Other's record", description=""))
        db_session.commit()

        resp = client.get(
            "/api/records/dashboard",
            headers=auth_header(user_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_records"] == 0, "Dashboard leaked another user's records"
        assert data["recent_records"] == []

    def test_dashboard_photo_count_skips_pending(self, client, user_token):
        """total_photos counts uploaded rows only — pending: rows are excluded."""
        headers = auth_header(user_token)

        # Record with 2 pending (metadata-only) images — not uploaded yet
        resp = client.post(
            "/api/records",
            json={
                "name": "Pending Photos",
                "description": "",
                "photos": [
                    {
                        "latitude": 28.6139,
                        "longitude": 77.2090,
                        "location_accuracy": 4.2,
                        "captured_at": "2025-01-15T10:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                    {
                        "latitude": 28.6139,
                        "longitude": 77.2090,
                        "location_accuracy": 4.2,
                        "captured_at": "2025-01-15T10:00:01Z",
                        "file_name": "photo_2.jpg",
                    },
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 201
        record_id = resp.json()["id"]

        resp = client.get("/api/records/dashboard", headers=headers)
        assert resp.json()["total_photos"] == 0, "Pending photos counted as uploaded"

        # Upload 1 of the 2 files
        jpeg = _make_jpeg()
        resp = client.post(
            f"/api/records/{record_id}/upload",
            files=[("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg"))],
            headers=headers,
        )
        assert resp.status_code == 200

        resp = client.get("/api/records/dashboard", headers=headers)
        data = resp.json()
        assert data["total_photos"] == 1, f"Expected 1 uploaded photo, got {data['total_photos']}"

    def test_dashboard_requires_auth(self, client):
        resp = client.get("/api/records/dashboard")
        assert resp.status_code == 401

    def test_dashboard_not_confused_with_record_id(self, client, user_token):
        """/records/dashboard must return metrics, not 422 (record_id parse)."""
        resp = client.get("/api/records/dashboard", headers=auth_header(user_token))
        assert resp.status_code == 200
        assert "total_records" in resp.json()


class TestLocationsFilter:
    def test_locations_skip_zero_coordinates(self, client, user_token, admin_token):
        headers = auth_header(user_token)

        # Record with a real GPS image
        resp = client.post(
            "/api/records",
            json={
                "name": "Real GPS",
                "description": "",
                "photos": [{
                    "latitude": 28.6139,
                    "longitude": 77.2090,
                    "location_accuracy": 4.2,
                    "captured_at": "2025-01-15T10:00:00Z",
                    "file_name": "photo_1.jpg",
                }],
            },
            headers=headers,
        )
        assert resp.status_code == 201

        # Record with zero GPS (like the old zeroed-upload bug)
        resp = client.post(
            "/api/records",
            json={
                "name": "Zero GPS",
                "description": "",
                "photos": [{
                    "latitude": 0.0,
                    "longitude": 0.0,
                    "location_accuracy": 0.0,
                    "captured_at": "2025-01-15T10:00:00Z",
                    "file_name": "photo_1.jpg",
                }],
            },
            headers=headers,
        )
        assert resp.status_code == 201

        resp = client.get("/api/admin/locations", headers=auth_header(admin_token))
        assert resp.status_code == 200
        locs = resp.json()
        assert len(locs) == 1, f"Expected only real-GPS location, got {locs}"
        assert locs[0]["latitude"] == 28.6139
        assert locs[0]["longitude"] == 77.2090