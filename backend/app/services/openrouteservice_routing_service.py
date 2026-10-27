"""
Route and Travel Time Calculator using OpenRouteService (ORS) v2 API.
Supports both:
1. Self-Hosted / On-Premise OpenRouteService (0 € / No API key required / Unlimited)
2. Cloud OpenRouteService API (api.openrouteservice.org with API key)

API Reference: https://openrouteservice.org/dev/#/api-docs/openrouteservice/v2/directions/{profile}/json/post
"""

import math
import logging
from typing import List, Tuple, Dict, Any, Optional
import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_ORS_LOCAL_URL = "http://localhost:8080/ors"


class OpenRouteServiceError(Exception):
    """Raised when an OpenRouteService API call fails."""
    pass


def format_duration(seconds: Optional[float]) -> str:
    """Formats duration in seconds into human-readable hours and minutes."""
    if seconds is None:
        return "N/A"
    total_seconds = int(round(seconds))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    remaining_secs = total_seconds % 60

    parts = []
    if hours > 0:
        parts.append(f"{hours} hr" if hours == 1 else f"{hours} hrs")
    if minutes > 0:
        parts.append(f"{minutes} min" if minutes == 1 else f"{minutes} mins")
    if not parts or (hours == 0 and minutes == 0):
        parts.append(f"{remaining_secs} sec" if remaining_secs == 1 else f"{remaining_secs} secs")
    return " ".join(parts)


def format_distance(meters: Optional[float]) -> str:
    """Formats distance in meters into kilometers / meters."""
    if meters is None:
        return "N/A"
    km = meters / 1000.0
    if km >= 1.0:
        return f"{km:.2f} km"
    return f"{int(round(meters))} m"


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate straight-line (great-circle) distance in meters using Haversine formula."""
    r = 6371000.0  # Earth's radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def calculate_distance_ors(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    api_key: Optional[str] = None,
    profile: str = "driving-car",
    base_url: Optional[str] = None,
    timeout: float = 10.0,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Calculate point-to-point road distance (meters) and duration (seconds) via ORS Directions API.
    Supports Self-Hosted OpenRouteService without API key, or Cloud ORS with API key.
    Returns (distance_meters, duration_seconds) or (None, None) on failure.
    """
    settings = get_settings()
    base = (base_url or settings.OPENROUTESERVICE_BASE_URL or DEFAULT_ORS_LOCAL_URL).rstrip("/")
    is_self_hosted = not ("api.openrouteservice.org" in base or "api.heigit.org" in base)
    key = api_key or settings.OPENROUTESERVICE_API_KEY

    if not key and not is_self_hosted:
        raise OpenRouteServiceError(
            "OpenRouteService API key not configured for public API. Please set OPENROUTESERVICE_API_KEY."
        )

    url = f"{base}/v2/directions/{profile}/json"
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "User-Agent": "PhotoCapture-ORS/1.0",
    }
    if key:
        headers["Authorization"] = key

    # ORS coordinates are [lon, lat]
    payload = {
        "coordinates": [[lon1, lat1], [lon2, lat2]],
        "instructions": False,
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, headers=headers, json=payload)
            if resp.status_code in (401, 403):
                raise OpenRouteServiceError("OpenRouteService API key is invalid or unauthorized (401/403).")
            if resp.status_code == 429:
                raise OpenRouteServiceError("OpenRouteService rate limit exceeded (429). Please retry later.")
            resp.raise_for_status()
            data = resp.json()

            routes = data.get("routes", [])
            if routes and "summary" in routes[0]:
                summary = routes[0]["summary"]
                dist = float(summary.get("distance", 0.0))
                dur = float(summary.get("duration", 0.0))
                return dist, dur
    except OpenRouteServiceError:
        raise
    except Exception as e:
        logger.warning("ORS point-to-point calculation error: %s", e)
        raise OpenRouteServiceError(f"OpenRouteService error: {e}") from e

    return None, None


async def plan_nearest_from_origin_ors(
    origin: Tuple[float, float],
    destinations: List[Tuple[float, float]],
    profile: str = "driving-car",
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 12.0,
) -> Tuple[Dict[int, Dict[str, float]], str]:
    """
    Computes road distance and travel time from a single GPS origin to N destinations
    using OpenRouteService v2 Matrix API.
    Supports Self-Hosted OpenRouteService without API key, or Cloud ORS with API key.
    
    Returns:
        (results_dict, source_label)
        where results_dict[dest_index] = {"distance_meters": float, "duration_seconds": float}
    """
    settings = get_settings()
    base = (base_url or settings.OPENROUTESERVICE_BASE_URL or DEFAULT_ORS_LOCAL_URL).rstrip("/")
    is_self_hosted = not ("api.openrouteservice.org" in base or "api.heigit.org" in base)
    key = api_key or settings.OPENROUTESERVICE_API_KEY

    if not key and not is_self_hosted:
        raise OpenRouteServiceError(
            "OpenRouteService API key not configured for public API. Please set OPENROUTESERVICE_API_KEY."
        )

    label = "Self-Hosted OpenRouteService" if is_self_hosted else "OpenRouteService (ORS)"
    url = f"{base}/v2/matrix/{profile}"

    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "User-Agent": "PhotoCapture-ORS/1.0",
    }
    if key:
        headers["Authorization"] = key

    results: Dict[int, Dict[str, float]] = {}
    total_dests = len(destinations)
    if total_dests == 0:
        return results, label

    # In self-hosted mode, we can use larger chunk sizes (e.g. 100). For public API, cap at 45.
    CHUNK_SIZE = 100 if is_self_hosted else 45

    async with httpx.AsyncClient(timeout=timeout) as client:
        for chunk_start in range(0, total_dests, CHUNK_SIZE):
            chunk = destinations[chunk_start:chunk_start + CHUNK_SIZE]
            locations = [[origin[1], origin[0]]] + [[d[1], d[0]] for d in chunk]
            sources = [0]
            dest_indices = list(range(1, len(locations)))

            payload = {
                "locations": locations,
                "sources": sources,
                "destinations": dest_indices,
                "metrics": ["distance", "duration"],
            }

            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code in (401, 403):
                    raise OpenRouteServiceError("OpenRouteService API key invalid or unauthorized (401/403).")
                if resp.status_code == 429:
                    raise OpenRouteServiceError("OpenRouteService rate limit exceeded (429). Please switch to Google Maps.")
                resp.raise_for_status()
                data = resp.json()

                distances = data.get("distances", [[]])[0]
                durations = data.get("durations", [[]])[0]

                for i, (dist, dur) in enumerate(zip(distances, durations)):
                    dest_idx = chunk_start + i
                    if dist is not None and dist >= 0:
                        results[dest_idx] = {
                            "distance_meters": float(dist),
                            "duration_seconds": float(dur) if dur is not None else (float(dist) / 11.1),
                        }
            except OpenRouteServiceError:
                raise
            except Exception as e:
                logger.warning("ORS Matrix chunk error (%d-%d): %s", chunk_start, chunk_start + len(chunk), e)
                # Fallback to geodesic straight-line distance for this chunk
                for i, d in enumerate(chunk):
                    dest_idx = chunk_start + i
                    if dest_idx not in results:
                        geo_dist = haversine_distance(origin[0], origin[1], d[0], d[1])
                        results[dest_idx] = {
                            "distance_meters": float(round(geo_dist, 1)),
                            "duration_seconds": float(round(geo_dist / 11.1, 1)),
                        }

    return results, label
