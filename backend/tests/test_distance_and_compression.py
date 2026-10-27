import io
import pytest
from PIL import Image
from datetime import datetime, timezone

from app.services.location_service import LocationService
from app.services.location_cache_service import LocationCacheService, haversine_distance
from app.services.image_service import ImageService
from app.services.record_service import _parse_coordinates, compute_record_deviation
from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage


class TestCoordinateParsing:
    def test_comma_separated(self):
        assert _parse_coordinates("11.040756, 77.030313") == (11.040756, 77.030313)

    def test_space_separated(self):
        assert _parse_coordinates("11.040756 77.030313") == (11.040756, 77.030313)

    def test_semicolon_separated(self):
        assert _parse_coordinates("11.040756; 77.030313") == (11.040756, 77.030313)

    def test_degree_symbols(self):
        assert _parse_coordinates("11.040756° N, 77.030313° E") == (11.040756, 77.030313)

    def test_null_island_rejected(self):
        assert _parse_coordinates("0, 0") is None
        assert _parse_coordinates("0.0, 0.0") is None

    def test_invalid_coords(self):
        assert _parse_coordinates("invalid") is None
        assert _parse_coordinates("") is None
        assert _parse_coordinates(None) is None
        assert _parse_coordinates("95.0, 77.0") is None  # lat out of bounds


class TestDistanceCalculation:
    def test_calculate_distance_geodesic_fallback(self):
        service = LocationService()
        # Coimbatore locations ~100m apart
        res = service.calculate_distance(11.040756, 77.030313, 11.041608, 77.029650)
        assert res["distance_meters"] > 0
        assert res["formatted"] != ""
        assert res["status"] in ("exact", "close", "far")

    def test_distance_caching(self):
        service = LocationService()
        res1 = service.calculate_distance(11.040756, 77.030313, 11.041608, 77.029650)
        res2 = service.calculate_distance(11.040756, 77.030313, 11.041608, 77.029650)
        assert res1 == res2

    def test_distance_endpoint(self, client, user_token):
        response = client.get(
            "/api/location/distance",
            params={
                "lat1": 11.040756,
                "lon1": 77.030313,
                "lat2": 11.041608,
                "lon2": 77.029650,
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "distance_meters" in data
        assert "formatted" in data
        assert "status" in data


class TestImageCompressionUnder300KB:
    def test_large_image_compressed_strictly_under_300kb(self):
        # Create a large high-resolution RGB image with random noise so it doesn't compress away
        import os
        random_bytes = os.urandom(800 * 800 * 3)
        img = Image.frombytes("RGB", (800, 800), random_bytes)

        raw_bytes = io.BytesIO()
        img.save(raw_bytes, format="PNG")  # raw PNG of random bytes is ~1.9 MB
        raw_val = raw_bytes.getvalue()
        assert len(raw_val) > 300 * 1024

        service = ImageService()
        processed = service.process_image(
            image_bytes=raw_val,
            latitude=11.040756,
            longitude=77.030313,
            captured_at=datetime.now(timezone.utc),
            location_name="Coimbatore Site",
            formatted_address="Nehru Nagar, Coimbatore",
            accuracy=12.5,
        )

        assert len(processed) <= 300 * 1024, f"Image size was {len(processed)} bytes, exceeding 300 KB!"
        assert processed[:2] == b"\xff\xd8"  # valid JPEG header
