import math
import time
from typing import Optional

from app.core.config import get_settings

settings = get_settings()


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two GPS coordinates using Haversine formula."""
    R = 6371000  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


class CacheEntry:
    """Single cache entry with location data and metadata."""

    def __init__(
        self,
        latitude: float,
        longitude: float,
        location_name: Optional[str],
        formatted_address: Optional[str],
        place_id: Optional[str],
        resolved_at: float,
    ):
        self.latitude = latitude
        self.longitude = longitude
        self.location_name = location_name
        self.formatted_address = formatted_address
        self.place_id = place_id
        self.resolved_at = resolved_at


class LocationCacheService:
    """
    Two-tier location cache: session (in-memory) and persistent.
    Uses geographic distance for matching, not exact equality.
    """

    def __init__(self):
        self.session_cache: list[CacheEntry] = []
        self.distance_cache: dict[tuple[float, float, float, float], dict] = {}
        self.threshold_meters = settings.LOCATION_CACHE_DISTANCE_THRESHOLD_METERS
        self.staleness_seconds = settings.LOCATION_CACHE_STALENESS_DAYS * 86400

    def find_distance(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> Optional[dict]:
        """Find cached distance result for coordinate pair."""
        key = (round(lat1, 5), round(lon1, 5), round(lat2, 5), round(lon2, 5))
        return self.distance_cache.get(key)

    def add_distance(
        self, lat1: float, lon1: float, lat2: float, lon2: float, data: dict
    ) -> None:
        """Cache distance calculation result."""
        key = (round(lat1, 5), round(lon1, 5), round(lat2, 5), round(lon2, 5))
        self.distance_cache[key] = data

    def find_in_session(
        self, latitude: float, longitude: float
    ) -> Optional[CacheEntry]:
        """Find a matching entry in the session cache."""
        for entry in self.session_cache:
            distance = haversine_distance(latitude, longitude, entry.latitude, entry.longitude)
            if distance <= self.threshold_meters:
                return entry
        return None

    def add_to_session(self, entry: CacheEntry) -> None:
        """Add an entry to the session cache."""
        self.session_cache.append(entry)

    def is_stale(self, entry: CacheEntry) -> bool:
        """Check if a cache entry is too old."""
        age_seconds = time.time() - entry.resolved_at
        return age_seconds > self.staleness_seconds

    def resolve(
        self,
        latitude: float,
        longitude: float,
        geocode_func=None,
    ) -> Optional[CacheEntry]:
        """
        Resolve location with cache-first strategy:
        1. Session cache (always valid within session)
        2. If geocode_func provided, call it for fresh data
        """
        # Check session cache first
        session_hit = self.find_in_session(latitude, longitude)
        if session_hit and not self.is_stale(session_hit):
            return session_hit

        # No valid cache hit — call geocoding if available
        if geocode_func:
            result = geocode_func(latitude, longitude)
            if result:
                entry = CacheEntry(
                    latitude=latitude,
                    longitude=longitude,
                    location_name=result.get("location_name"),
                    formatted_address=result.get("formatted_address"),
                    place_id=result.get("place_id"),
                    resolved_at=time.time(),
                )
                self.add_to_session(entry)
                return entry

        return None


_shared_location_cache: Optional[LocationCacheService] = None


def get_location_cache_service() -> LocationCacheService:
    global _shared_location_cache
    if _shared_location_cache is None:
        _shared_location_cache = LocationCacheService()
    return _shared_location_cache
