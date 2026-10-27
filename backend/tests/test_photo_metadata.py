"""Test that photo metadata with GPS is saved correctly."""
import pytest
from tests.conftest import auth_header


class TestPhotoMetadata:
    def test_record_with_photo_metadata(self, client, user_token):
        """Create a record with photo metadata including GPS."""
        response = client.post(
            "/api/records",
            json={
                "name": "GPS Test Record",
                "description": "Testing GPS metadata",
                "photos": [
                    {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "location_accuracy": 5.0,
                        "captured_at": "2026-09-02T12:00:00Z",
                        "file_name": "photo_1.jpg",
                    },
                    {
                        "latitude": 40.7130,
                        "longitude": -74.0058,
                        "location_accuracy": 3.2,
                        "captured_at": "2026-09-02T12:00:05Z",
                        "file_name": "photo_2.jpg",
                    },
                ],
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "GPS Test Record"
        assert len(data["images"]) == 2

        # Verify GPS data is saved per photo
        img1 = data["images"][0]
        assert img1["latitude"] == 40.7128
        assert img1["longitude"] == -74.0060
        assert img1["location_accuracy"] == 5.0
        assert img1["photo_order"] == 1

        img2 = data["images"][1]
        assert img2["latitude"] == 40.7130
        assert img2["longitude"] == -74.0058
        assert img2["location_accuracy"] == 3.2
        assert img2["photo_order"] == 2

    def test_record_without_photos(self, client, user_token):
        """Create a record without photos should still work."""
        response = client.post(
            "/api/records",
            json={"name": "Empty Record", "description": "", "photos": []},
            headers=auth_header(user_token),
        )
        assert response.status_code == 201
        assert len(response.json()["images"]) == 0

    def test_locations_endpoint_returns_gps_data(self, client, user_token, admin_token):
        """Locations endpoint should return GPS data from records."""
        # Create record with photos
        client.post(
            "/api/records",
            json={
                "name": "Location Test",
                "description": "",
                "photos": [
                    {
                        "latitude": 51.5074,
                        "longitude": -0.1278,
                        "location_accuracy": 10.0,
                        "captured_at": "2026-09-02T14:00:00Z",
                        "file_name": "london.jpg",
                    }
                ],
            },
            headers=auth_header(user_token),
        )

        # Admin should see the location
        response = client.get(
            "/api/admin/locations",
            headers=auth_header(admin_token),
        )
        assert response.status_code == 200
        locations = response.json()
        assert len(locations) >= 1
        assert locations[0]["latitude"] == 51.5074
        assert locations[0]["longitude"] == -0.1278
