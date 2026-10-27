"""Live-location endpoints.

Read-only helpers for the client's GPS telemetry: given a fresh device fix,
return the human-readable place the operator is standing in. Reverse geocoding
for stored records stays in the records router — this one never touches a
record, so the dashboard can resolve its own position on every page load.
"""
import logging
import re
import time
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_active_user
from app.models.user import User
from app.database.connection import get_db
from app.models.capture_record import CaptureRecord
from app.services.road_route_service import RoadRouteService, RoadRouteError
from app.schemas.record import AddressResolveResponse
from app.services.location_cache_service import get_location_cache_service
from app.services.location_service import LocationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/location", tags=["Location"])

# Street View metadata lookups are billed per request — cache per ~1m grid
# cell for a day so reopening the same popup never re-bills Google.
_STREETVIEW_CACHE: dict[str, tuple[float, dict]] = {}
_STREETVIEW_CACHE_TTL_SECONDS = 86400
_STREETVIEW_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _streetview_month_year(raw: object) -> Optional[str]:
    """Normalize Google's capture date ("2023-04" or ISO) to "April 2023"."""
    if not raw:
        return None
    s = str(raw).strip()
    m = re.match(r"^(\d{4})-(\d{2})", s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return f"{_MONTH_NAMES[month - 1]} {year}"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return f"{_MONTH_NAMES[dt.month - 1]} {dt.year}"
    except ValueError:
        return s


class RouteOrigin(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class RoadRouteRequest(BaseModel):
    origin: RouteOrigin
    record_ids: list[int] = Field(min_length=1, max_length=1000)
    provider: str = Field(default="ors", description="Routing provider: 'ors' (OpenRouteService) or 'gmap' (Google Maps)")


@router.post("/route")
async def plan_motorcycle_route(
    request: RoadRouteRequest,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    ids = list(dict.fromkeys(request.record_ids))
    records = db.query(CaptureRecord).filter(
        CaptureRecord.id.in_(ids), CaptureRecord.user_id == user.id,
        CaptureRecord.status == "NOT_COMPLETED",
    ).all()
    if len(records) != len(ids):
        raise HTTPException(404, "Some pending records are no longer available to you. Refresh and retry.")
    by_id = {record.id: record for record in records}
    try:
        try:
            return await RoadRouteService().plan(
                (request.origin.latitude, request.origin.longitude),
                [by_id[id] for id in ids],
                provider=request.provider,
            )
        except TypeError:
            return await RoadRouteService().plan(
                (request.origin.latitude, request.origin.longitude),
                [by_id[id] for id in ids],
            )
    except RoadRouteError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/streetview-meta")
async def streetview_metadata(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    user: User = Depends(require_active_user),
):
    """Street View capture info for a coordinate (month/year it was photographed).

    Proxied through the backend because Google blocks browser CORS on the
    Street View metadata endpoint. Uses the Street View key, falling back to
    the Geocoding key; a missing key or Google outage degrades gracefully.
    """
    from app.core.config import get_settings

    settings = get_settings()
    api_key = settings.GOOGLE_STREETVIEW_API_KEY or settings.GOOGLE_GEOCODING_API_KEY
    if not api_key:
        return {"available": False, "month_year": None, "message": "Street View lookup not configured (no API key)"}

    cache_key = f"{round(latitude, 5)},{round(longitude, 5)}"
    now = time.time()
    cached = _STREETVIEW_CACHE.get(cache_key)
    if cached and now - cached[0] < _STREETVIEW_CACHE_TTL_SECONDS:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                _STREETVIEW_URL,
                params={"location": f"{latitude},{longitude}", "source": "outdoor", "key": api_key},
            )
        data = resp.json()
    except Exception:
        logger.warning("Street View metadata lookup failed for %s,%s", latitude, longitude, exc_info=True)
        return {"available": False, "month_year": None, "message": "Street View lookup failed"}

    status = data.get("status")
    if status == "OK":
        result: dict = {
            "available": True,
            "month_year": _streetview_month_year(data.get("date")),
            "captured_at": data.get("date"),
            "copyright": data.get("copyright"),
        }
        _STREETVIEW_CACHE[cache_key] = (now, result)
        return result

    messages = {
        "ZERO_RESULTS": "No Street View coverage at this location",
        "NOT_FOUND": "No Street View coverage at this location",
        "REQUEST_DENIED": "Street View lookup denied — check the API key",
        "OVER_QUERY_LIMIT": "Street View quota exceeded — try again later",
    }
    return {"available": False, "month_year": None, "message": messages.get(status, f"Street View unavailable ({status or 'unknown'})")}


@router.get("/reverse-geocode", response_model=AddressResolveResponse)
async def reverse_geocode_live_fix(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    user: User = Depends(require_active_user),
):
    """Resolve the client's current GPS position to a place name.

    Shares the session location cache with record creation, so a moving operator
    re-bills Google only after covering the cache's distance threshold. A
    missing API key or a Google outage returns ``resolved=False``; the client
    keeps showing raw coordinates rather than failing.
    """
    entry = get_location_cache_service().resolve(
        latitude,
        longitude,
        geocode_func=LocationService().reverse_geocode,
    )
    if not entry:
        return AddressResolveResponse(resolved=False, error="Could not resolve this position")

    return AddressResolveResponse(
        resolved=True,
        address=entry.formatted_address,
        place_name=entry.location_name,
    )


@router.get("/distance")
async def calculate_distance_endpoint(
    lat1: float = Query(None, description="Origin latitude"),
    lon1: float = Query(None, description="Origin longitude"),
    lat2: float = Query(None, description="Destination latitude"),
    lon2: float = Query(None, description="Destination longitude"),
    origin: str = Query(None, description="Origin coordinates 'lat,lon'"),
    destination: str = Query(None, description="Destination coordinates 'lat,lon'"),
    user: User = Depends(require_active_user),
):
    """Calculate distance/deviation using Google Maps Distance Matrix API.
    Supports either separate lat1, lon1, lat2, lon2 or 'lat,lon' origin/destination strings.
    """
    def parse_str(val: str) -> tuple[float, float] | None:
        if not val:
            return None
        cleaned = val.replace(";", ",").replace("/", ",")
        parts = [p.strip() for p in cleaned.split(",") if p.strip()]
        if len(parts) == 1:
            parts = cleaned.split()
        if len(parts) >= 2:
            try:
                p0 = float(parts[0].rstrip("°NnSsEeWw,"))
                p1 = float(parts[1].rstrip("°NnSsEeWw,"))
                return p0, p1
            except ValueError:
                return None
        return None

    if origin and (lat1 is None or lon1 is None):
        parsed = parse_str(origin)
        if parsed:
            lat1, lon1 = parsed

    if destination and (lat2 is None or lon2 is None):
        parsed = parse_str(destination)
        if parsed:
            lat2, lon2 = parsed

    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return {
            "distance_meters": 0,
            "formatted": "—",
            "status": "far",
            "source": "invalid",
        }

    return LocationService().calculate_distance(lat1, lon1, lat2, lon2)
