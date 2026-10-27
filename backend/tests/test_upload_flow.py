"""Test the create_record → upload flow to verify pending rows are updated, not duplicated."""
import io
import pytest
from PIL import Image


def _make_jpeg(width=100, height=100):
    """Create a minimal JPEG in memory."""
    img = Image.new("RGB", (width, height), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    return buf.getvalue()


class TestUploadFlow:
    def test_create_record_creates_pending_rows(self, client, user_token):
        """Creating a record with photos should create pending: image rows."""
        resp = client.post(
            "/api/records",
            json={
                "name": "Upload Test",
                "description": "Testing pending rows",
                "photos": [
                    {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "location_accuracy": 5.0,
                        "captured_at": "2025-01-15T10:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                    {
                        "latitude": 40.7129,
                        "longitude": -74.0061,
                        "location_accuracy": 4.5,
                        "captured_at": "2025-01-15T10:00:05Z",
                        "file_name": "photo_2.jpg",
                    },
                ],
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["images"]) == 2

        # Both images should be pending
        for img in data["images"]:
            assert img["google_drive_file_id"].startswith("pending:")

    def test_upload_updates_pending_rows_no_duplicates(self, client, user_token):
        """Upload should UPDATE existing pending rows, not create new ones."""
        # Step 1: Create record with 2 photos
        resp = client.post(
            "/api/records",
            json={
                "name": "No Duplicates",
                "description": "",
                "photos": [
                    {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "location_accuracy": 5.0,
                        "captured_at": "2025-01-15T10:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                    {
                        "latitude": 40.7129,
                        "longitude": -74.0061,
                        "location_accuracy": 4.5,
                        "captured_at": "2025-01-15T10:00:05Z",
                        "file_name": "photo_2.jpg",
                    },
                ],
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 201
        record_id = resp.json()["id"]

        # Step 2: Upload actual files
        jpeg = _make_jpeg()
        resp = client.post(
            f"/api/records/{record_id}/upload",
            files=[
                ("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg")),
                ("files", ("photo_2.jpg", io.BytesIO(jpeg), "image/jpeg")),
            ],
            data={
                "latitudes": "40.7128,40.7129",
                "longitudes": "-74.0060,-74.0061",
                "accuracies": "5.0,4.5",
                "captured_ats": "2025-01-15T10:00:00Z,2025-01-15T10:00:05Z",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()

        # KEY ASSERTION: still exactly 2 images (no duplicates)
        assert len(data["images"]) == 2, f"Expected 2 images, got {len(data['images'])}"

        # No image should still be pending
        for img in data["images"]:
            assert not img["google_drive_file_id"].startswith("pending:"), \
                f"Image {img['id']} still has pending status"

    def test_upload_without_prior_create_record(self, client, user_token):
        """Upload to a record without pending rows should still create image rows."""
        # Create a minimal record without photos
        resp = client.post(
            "/api/records",
            json={"name": "No Photos", "description": ""},
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 201
        record_id = resp.json()["id"]

        # Upload a file directly (no pending rows exist)
        jpeg = _make_jpeg()
        resp = client.post(
            f"/api/records/{record_id}/upload",
            files=[("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg"))],
            data={
                "latitudes": "40.7128",
                "longitudes": "-74.0060",
                "accuracies": "5.0",
                "captured_ats": "2025-01-15T10:00:00Z",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["images"]) == 1
        assert not data["images"][0]["google_drive_file_id"].startswith("pending:")

    def test_image_serving_after_upload(self, client, user_token):
        """After upload, the image serving endpoint should return the actual JPEG file."""
        # Create record + upload
        resp = client.post(
            "/api/records",
            json={
                "name": "Serve Test",
                "description": "",
                "photos": [
                    {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "location_accuracy": 5.0,
                        "captured_at": "2025-01-15T10:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                ],
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        record_id = resp.json()["id"]
        image_id = resp.json()["images"][0]["id"]

        jpeg = _make_jpeg()
        client.post(
            f"/api/records/{record_id}/upload",
            files=[("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg"))],
            data={
                "latitudes": "40.7128",
                "longitudes": "-74.0060",
                "accuracies": "5.0",
                "captured_ats": "2025-01-15T10:00:00Z",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )

        # Serve the image
        resp = client.get(
            f"/api/records/{record_id}/image/{image_id}",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        # Should be actual JPEG bytes (processed + watermarked), not empty
        assert len(resp.content) > 100

    def test_upload_preserves_gps_from_pending_row(self, client, user_token):
        """Upload without GPS form fields must NOT zero out capture-time GPS.
        This regressed because GPS params weren't declared as Form() and the
        handler overwrote pending-row GPS with 0.0."""
        # Create record with GPS
        resp = client.post(
            "/api/records",
            json={
                "name": "GPS Preserve",
                "description": "",
                "photos": [{
                    "latitude": 28.6139,
                    "longitude": 77.2090,
                    "location_accuracy": 4.2,
                    "captured_at": "2025-01-15T10:00:00Z",
                    "file_name": "photo_1.jpg",
                }],
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 201
        record_id = resp.json()["id"]

        # Upload bytes WITHOUT GPS form fields (like the real client does)
        jpeg = _make_jpeg()
        resp = client.post(
            f"/api/records/{record_id}/upload",
            files=[("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg"))],
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 200
        img = resp.json()["images"][0]

        # GPS must survive the upload
        assert img["latitude"] == 28.6139, f"GPS lat lost: {img['latitude']}"
        assert img["longitude"] == 77.2090, f"GPS lng lost: {img['longitude']}"
        assert img["location_accuracy"] == 4.2, f"Accuracy lost: {img['location_accuracy']}"

    def test_upload_binds_gps_form_fields(self, client, user_token):
        """GPS sent as multipart form fields must bind (they're Form() params now)."""
        resp = client.post(
            "/api/records",
            json={"name": "GPS Fields", "description": ""},
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 201
        record_id = resp.json()["id"]

        # No pending rows exist — upload provides GPS via form fields
        jpeg = _make_jpeg()
        resp = client.post(
            f"/api/records/{record_id}/upload",
            files=[("files", ("photo_1.jpg", io.BytesIO(jpeg), "image/jpeg"))],
            data={
                "latitudes": "40.7128",
                "longitudes": "-74.0060",
                "accuracies": "3.1",
                "captured_ats": "2025-01-15T10:00:00Z",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 200
        img = resp.json()["images"][0]
        assert img["latitude"] == 40.7128, f"lat not bound: {img['latitude']}"
        assert img["longitude"] == -74.0060, f"lng not bound: {img['longitude']}"

    def test_pending_image_returns_404(self, client, user_token):
        """Image serving for pending (not yet uploaded) images should return 404."""
        resp = client.post(
            "/api/records",
            json={
                "name": "Pending Test",
                "description": "",
                "photos": [
                    {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "location_accuracy": 5.0,
                        "captured_at": "2025-01-15T10:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                ],
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        record_id = resp.json()["id"]
        image_id = resp.json()["images"][0]["id"]

        # Try to serve before upload — should 404
        resp = client.get(
            f"/api/records/{record_id}/image/{image_id}",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert resp.status_code == 404
        assert "not yet uploaded" in resp.json()["detail"].lower() or "not found" in resp.json()["detail"].lower()
