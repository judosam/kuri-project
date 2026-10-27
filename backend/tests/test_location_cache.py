import time

import pytest

from app.services.location_cache_service import (
    CacheEntry,
    LocationCacheService,
    haversine_distance,
)


class TestHaversineDistance:
    def test_same_point(self):
        assert haversine_distance(0.0, 0.0, 0.0, 0.0) == 0.0

    def test_known_distance(self):
        # ~111km between these points
        d = haversine_distance(0.0, 0.0, 1.0, 0.0)
        assert 110000 < d < 112000

    def test_symmetric(self):
        d1 = haversine_distance(40.7128, -74.0060, 34.0522, -118.2437)
        d2 = haversine_distance(34.0522, -118.2437, 40.7128, -74.0060)
        assert abs(d1 - d2) < 1.0


class TestLocationCacheService:
    def test_session_cache_miss(self):
        cache = LocationCacheService()
        result = cache.find_in_session(40.7128, -74.0060)
        assert result is None

    def test_session_cache_hit(self):
        cache = LocationCacheService()
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="New York",
            formatted_address="New York, NY",
            place_id="abc123",
            resolved_at=time.time(),
        )
        cache.add_to_session(entry)

        # Same location should hit
        result = cache.find_in_session(40.7128, -74.0060)
        assert result is not None
        assert result.location_name == "New York"

    def test_session_cache_miss_different_location(self):
        cache = LocationCacheService()
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="New York",
            formatted_address="New York, NY",
            place_id="abc123",
            resolved_at=time.time(),
        )
        cache.add_to_session(entry)

        # LA should not hit NY cache
        result = cache.find_in_session(34.0522, -118.2437)
        assert result is None

    def test_nearby_location_within_threshold(self):
        cache = LocationCacheService()
        # ~30m offset
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="Building A",
            formatted_address="123 Main St",
            place_id="xyz",
            resolved_at=time.time(),
        )
        cache.add_to_session(entry)

        # ~30m away should still hit
        result = cache.find_in_session(40.712827, -74.0060)
        assert result is not None

    def test_stale_entry_detection(self):
        cache = LocationCacheService()
        # Entry from 2 years ago
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="Old Place",
            formatted_address="Old Address",
            place_id="old",
            resolved_at=time.time() - (400 * 86400),  # 400 days
        )
        assert cache.is_stale(entry) is True

    def test_fresh_entry_not_stale(self):
        cache = LocationCacheService()
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="Recent Place",
            formatted_address="Recent Address",
            place_id="recent",
            resolved_at=time.time(),
        )
        assert cache.is_stale(entry) is False

    def test_resolve_with_session_cache(self):
        cache = LocationCacheService()
        entry = CacheEntry(
            latitude=40.7128,
            longitude=-74.0060,
            location_name="Cached",
            formatted_address="Cached Address",
            place_id="cached",
            resolved_at=time.time(),
        )
        cache.add_to_session(entry)

        result = cache.resolve(40.7128, -74.0060)
        assert result is not None
        assert result.location_name == "Cached"

    def test_resolve_with_geocode_func(self):
        cache = LocationCacheService()

        def mock_geocode(lat, lng):
            return {
                "location_name": "Geocoded Place",
                "formatted_address": "Geocoded Address",
                "place_id": "geo123",
            }

        result = cache.resolve(40.7128, -74.0060, geocode_func=mock_geocode)
        assert result is not None
        assert result.location_name == "Geocoded Place"

        # Second call should hit session cache
        result2 = cache.resolve(40.7128, -74.0060, geocode_func=mock_geocode)
        assert result2 is not None
        assert result2.location_name == "Geocoded Place"
