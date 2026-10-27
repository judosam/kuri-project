import pytest
from tests.conftest import auth_header


class TestActivityLogs:
    def test_login_and_wrong_password_logged(self, client, test_user, admin_token):
        # 1. Attempt login with wrong password
        failed_res = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "incorrect_password"},
        )
        assert failed_res.status_code == 401

        # 2. Login successfully
        success_res = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "testpass123"},
        )
        assert success_res.status_code == 200
        user_tok = success_res.json()["access_token"]

        # 3. Logout
        logout_res = client.post("/api/auth/logout", headers=auth_header(user_tok))
        assert logout_res.status_code == 200

        # 4. Check admin activity logs
        logs_res = client.get("/api/admin/logs", headers=auth_header(admin_token))
        assert logs_res.status_code == 200
        items = logs_res.json()["items"]

        titles = [item["title"] for item in items]
        assert any("Sign-in failed" in t for t in titles)
        assert any("signed in" in t.lower() for t in titles)
        assert any("signed out" in t.lower() for t in titles)

    def test_record_edit_and_delete_logged(self, client, admin_token, test_user):
        # 1. Create a record as admin
        create_res = client.post(
            "/api/records",
            headers=auth_header(admin_token),
            json={"name": "Test Site Audit", "description": "Initial note", "photos": []},
        )
        assert create_res.status_code == 201
        rec_id = create_res.json()["id"]

        # 2. Edit the record
        update_res = client.put(
            f"/api/admin/records/{rec_id}",
            headers=auth_header(admin_token),
            json={"name": "Renamed Site Audit", "description": "Updated note"},
        )
        assert update_res.status_code == 200

        # 3. Delete the record
        delete_res = client.delete(
            f"/api/admin/records/{rec_id}",
            headers=auth_header(admin_token),
        )
        assert delete_res.status_code == 204

        # 4. Verify activity logs contain edit and delete events
        logs_res = client.get("/api/admin/logs", headers=auth_header(admin_token))
        assert logs_res.status_code == 200
        items = logs_res.json()["items"]

        titles = [item["title"] for item in items]
        assert any("Field record updated" in t for t in titles)
        assert any("Field record deleted" in t for t in titles)

    def test_admin_image_download_logged(self, client, admin_token, test_user, db_session):
        from app.models.capture_record import CaptureRecord
        from app.models.captured_image import CapturedImage
        from datetime import datetime, timezone

        # Create record and image
        rec = CaptureRecord(user_id=test_user.id, name="Audit Record for Download", description="Testing downloads")
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        img = CapturedImage(
            record_id=rec.id,
            google_drive_file_id="simulated-test-download",
            file_name="Record_1_Photo_1.jpg",
            photo_order=1,
            latitude=13.0827,
            longitude=80.2707,
            location_accuracy=10.0,
            captured_at=datetime.now(timezone.utc),
        )
        db_session.add(img)
        db_session.commit()
        db_session.refresh(img)

        # 1. Admin logs image download via POST endpoint
        log_res = client.post(
            f"/api/admin/records/{rec.id}/image/{img.id}/log-download",
            headers=auth_header(admin_token),
        )
        assert log_res.status_code == 200
        assert log_res.json()["message"] == "Download logged successfully"

        # 2. Check admin activity logs for photo download entry
        logs_res = client.get("/api/admin/logs?entry_type=photo", headers=auth_header(admin_token))
        assert logs_res.status_code == 200

        items = logs_res.json()["items"]
        assert any("Photo downloaded by Admin" in item["title"] for item in items)
        download_entry = next(item for item in items if "Photo downloaded by Admin" in item["title"])
        assert "Record_1_Photo_1.jpg" in download_entry["detail"]
        assert "Audit Record for Download" in download_entry["detail"]

        # 3. Regular users cannot log admin image downloads
        user_res = client.post(
            f"/api/admin/records/{rec.id}/image/{img.id}/log-download",
            headers=auth_header("invalid_token"),
        )
        assert user_res.status_code == 401

