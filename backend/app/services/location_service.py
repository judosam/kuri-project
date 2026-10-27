import logging
from typing import Optional

import httpx

from app.core.config import get_settings
from app.services.location_cache_service import haversine_distance

logger = logging.getLogger(__name__)
settings = get_settings()


class LocationService:
    """Service for Google Geocoding reverse geocoding and Google Maps Distance Matrix."""

    GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json"
    DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"

    def __init__(self):
        self.api_key = settings.GOOGLE_GEOCODING_API_KEY

    def calculate_distance(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> dict:
        """
        Calculate distance between two GPS coordinates using Google Maps Distance Matrix API.
        Falls back to geodesic Haversine distance if offline, API key not set, or error occurs.
        Returns dict with:
          distance_meters: int
          formatted: str
          status: 'exact' (<=10m) | 'close' (<=30m) | 'far' (>30m)
          source: 'google_maps' | 'geodesic'
        """
        from app.services.location_cache_service import (
            get_location_cache_service,
            haversine_distance,
        )

        # Check cache first
        cache_service = get_location_cache_service()
        cached = cache_service.find_distance(lat1, lon1, lat2, lon2)
        if cached:
            return cached

        # Validate coordinates bounds
        if not (-90 <= lat1 <= 90 and -180 <= lon1 <= 180 and -90 <= lat2 <= 90 and -180 <= lon2 <= 180):
            return {
                "distance_meters": 0,
                "formatted": "—",
                "status": "far",
                "source": "invalid",
            }

        # Null Island checks
        if (lat1 == 0 and lon1 == 0) or (lat2 == 0 and lon2 == 0):
            return {
                "distance_meters": 0,
                "formatted": "—",
                "status": "far",
                "source": "invalid",
            }

        distance_meters: Optional[int] = None
        formatted: Optional[str] = None
        source = "geodesic"

        if self.api_key:
            try:
                response = httpx.get(
                    self.DISTANCE_MATRIX_URL,
                    params={
                        "origins": f"{lat1},{lon1}",
                        "destinations": f"{lat2},{lon2}",
                        "key": self.api_key,
                    },
                    timeout=8.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "OK" and data.get("rows"):
                        row = data["rows"][0]
                        elements = row.get("elements", [])
                        if elements and elements[0].get("status") == "OK":
                            elem = elements[0]
                            distance_meters = int(elem["distance"]["value"])
                            formatted = elem["distance"]["text"]
                            source = "google_maps"
            except Exception as e:
                logger.warning(f"Google Distance Matrix API call failed: {e}")

        # Geodesic fallback
        if distance_meters is None:
            raw_meters = haversine_distance(lat1, lon1, lat2, lon2)
            distance_meters = int(round(raw_meters))
            if distance_meters < 1000:
                formatted = f"{distance_meters} m"
            else:
                formatted = f"{(distance_meters / 1000.0):.2f} km ({distance_meters:,} m)"
            source = "geodesic"

        status = "exact" if distance_meters <= 10 else ("close" if distance_meters <= 30 else "far")
        result = {
            "distance_meters": distance_meters,
            "formatted": formatted,
            "status": status,
            "source": source,
        }

        cache_service.add_distance(lat1, lon1, lat2, lon2, result)
        return result

    def calculate_deviation(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> dict:
        """
        Calculate authoritative spatial ground-truth geodesic displacement (deviation)
        between planned admin coordinates and actual field-captured GPS in meters.
        """
        if any(v is None for v in [lat1, lon1, lat2, lon2]):
            return {
                "distance_meters": 0,
                "formatted": "—",
                "status": "far",
                "source": "invalid",
            }

        if (lat1 == 0 and lon1 == 0) or (lat2 == 0 and lon2 == 0):
            return {
                "distance_meters": 0,
                "formatted": "—",
                "status": "far",
                "source": "invalid",
            }

        raw_meters = haversine_distance(lat1, lon1, lat2, lon2)
        distance_meters = int(round(raw_meters))

        if distance_meters < 1000:
            formatted = f"{distance_meters} m"
        else:
            formatted = f"{(distance_meters / 1000.0):.2f} km ({distance_meters:,} m)"

        status = "exact" if distance_meters <= 10 else ("close" if distance_meters <= 30 else "far")
        return {
            "distance_meters": distance_meters,
            "formatted": formatted,
            "status": status,
            "source": "geodesic",
        }

    def reverse_geocode(self, latitude: float, longitude: float) -> Optional[dict]:
        """
        Convert GPS coordinates to human-readable location.
        Returns dict with location_name, formatted_address, place_id.
        Returns None on failure.
        """
        if not self.api_key:
            logger.warning("Google Geocoding API key not configured")
            return None

        try:
            response = httpx.get(
                self.GEOCODING_URL,
                params={
                    "latlng": f"{latitude},{longitude}",
                    "language": "en",  # always return English place names
                    "key": self.api_key,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "OK" or not data.get("results"):
                logger.warning(f"Geocoding returned status: {data.get('status')}")
                return None

            result = data["results"][0]
            formatted_address = result.get("formatted_address", "")
            place_id = result.get("place_id", "")

            # Extract a meaningful location name from address components
            location_name = self._extract_location_name(result)

            return {
                "location_name": location_name,
                "formatted_address": formatted_address,
                "place_id": place_id,
            }

        except Exception as e:
            logger.error(f"Geocoding failed for ({latitude}, {longitude}): {e}")
            return None

    def _extract_location_name(self, geocode_result: dict) -> Optional[str]:
        """Extract a meaningful name from geocoding result components."""
        components = geocode_result.get("address_components", [])

        # Prefer point_of_interest, establishment, or premise
        for comp_type in ["point_of_interest", "establishment", "premise"]:
            for comp in components:
                if comp_type in comp.get("types", []):
                    return comp.get("long_name")

        # Fall back to neighborhood or locality
        for comp_type in ["neighborhood", "locality", "sublocality"]:
            for comp in components:
                if comp_type in comp.get("types", []):
                    return comp.get("long_name")

        return None
