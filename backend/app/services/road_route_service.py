"""Nearest-first road distances from one GPS origin to every pending location.

Cost controls (Routes API bills per matrix element, origins x destinations):
  * route-plan cache — an identical pending set from the same operator within
    ROUTE_PLAN_CACHE_MINUTES reuses the computed plan for free;
  * coordinate deduplication — stops sharing a rounded coordinate are priced
    once and share a stop in the result;
  * one origin — N unique destinations cost N elements, not (N + 1) x N.
"""
import asyncio
import logging
import math
import re
import time
from collections import Counter

import httpx

from app.core.config import get_settings
from app.services.openrouteservice_routing_service import plan_nearest_from_origin_ors, OpenRouteServiceError

logger = logging.getLogger(__name__)

class RoadRouteError(Exception):
    pass


def parse_coordinates(value):
    if not value:
        return None
    parts = re.split(r"[,;/]", value.strip())
    if len(parts) == 1:
        parts = value.split()
    if len(parts) != 2:
        return None
    numbers = []
    for part in parts:
        match = re.fullmatch(r"\s*([-+]?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew]?)\s*", part)
        if not match:
            return None
        number = float(match[1])
        if match[2].upper() in ("S", "W"):
            number = -abs(number)
        numbers.append(number)
    lat, lon = numbers
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return lat, lon


def waypoint(point):
    return {"location": {"latLng": {"latitude": point[0], "longitude": point[1]}}}


def route_values(data):
    distance = float(data.get("distanceMeters", 0))
    raw_duration = data["duration"]
    if not isinstance(raw_duration, str) or not raw_duration.endswith("s"):
        raise ValueError("Invalid duration")
    duration = float(raw_duration.removesuffix("s"))
    if not all(math.isfinite(n) and n >= 0 for n in (distance, duration)):
        raise ValueError("Invalid route values")
    return {"distance_meters": distance, "duration_seconds": duration}


class RoadRouteService:
    # Traffic-aware optimal routing: Google caps matrices at origins ×
    # destinations <= 100 under this preference (verified against the live API:
    # an 11×11 matrix is rejected with INVALID_ARGUMENT).
    ROUTING_PREFERENCE = "TRAFFIC_AWARE_OPTIMAL"
    MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
    BATCH_SIZE = 100  # One GPS origin x 100 destinations = 100 elements.

    def __init__(self, api_key=None, transport=None):
        settings = get_settings()
        self.api_key = api_key if api_key is not None else (
            settings.GOOGLE_ROUTES_API_KEY or settings.GOOGLE_GEOCODING_API_KEY
        )
        self.transport = transport
        self.travel_mode = settings.ROUTE_TRAVEL_MODE
        self.cache_ttl_seconds = settings.ROUTE_PLAN_CACHE_MINUTES * 60

    async def plan(self, origin, records, provider: str = None):
        if provider:
            norm_provider = provider.lower().strip()
            if norm_provider in ("gmap", "google", "google_maps"):
                provider_type = "gmap"
            else:
                provider_type = "ors"
        else:
            if not self.api_key:
                raise RoadRouteError("Google Routes API key is not configured. Please set GOOGLE_ROUTES_API_KEY or GOOGLE_GEOCODING_API_KEY.")
            provider_type = "gmap"

        located, skipped = [], []
        for record in records:
            point = parse_coordinates(record.coordinates)
            if point is None:
                skipped.append({"record_id": record.id, "reason": "Missing or invalid coordinates"})
            else:
                located.append((record.id, point))
        if not located:
            return self._result([], skipped, provider=provider_type)

        # Deduplicate stops that share a coordinate (same rounded lat/lon):
        # the matrix bills per origin x destination, so pricing identical
        # points once directly shrinks the billed element count.
        by_point: dict[tuple, list[int]] = {}
        for record_id, point in located:
            by_point.setdefault((round(point[0], 5), round(point[1], 5)), []).append(record_id)
        unique_points = list(by_point.keys())
        # Map each unique point back to a representative ordered group.
        groups = [by_point[key] for key in unique_points]

        cached = self._cache_get(origin, unique_points, provider_type)
        if cached is not None:
            ordered, unrouted, is_proximate = cached
            stops = self._expand_cached(ordered, groups)
            skipped.extend({"record_id": record_id, "reason": reason}
                           for index, reason in unrouted for record_id in groups[index])
            label = "OpenRouteService (ORS)" if provider_type == "ors" else "Google Maps"
            if is_proximate:
                label += " (cached, 0 API calls)"
            return self._result(stops, skipped, provider=provider_type, source_label=label)

        # -------------------------------------------------------------
        # Option 1: OpenRouteService (ORS)
        # Open source routing engine (https://openrouteservice.org)
        # -------------------------------------------------------------
        if provider_type == "ors":
            profile = "driving-car"
            if self.travel_mode in ("BICYCLE", "bike", "TWO_WHEELER"):
                profile = "cycling-regular"
            elif self.travel_mode in ("WALKING", "walking"):
                profile = "foot-walking"

            try:
                ors_map, source_label = await plan_nearest_from_origin_ors(
                    origin, unique_points, profile=profile, timeout=15.0
                )
                reachable = [i for i in range(len(unique_points)) if i in ors_map]
                reachable.sort(key=lambda i: (ors_map[i]["distance_meters"], groups[i][0]))
                remaining = [i for i in range(len(unique_points)) if i not in ors_map]

                ordered_groups = [(i, ors_map[i]) for i in reachable]
                stops = self._expand_cached(ordered_groups, groups)
                unrouted = [(i, "No road route found from your location") for i in remaining]
                skipped.extend({"record_id": record_id, "reason": reason}
                               for i, reason in unrouted for record_id in groups[i])

                self._cache_put(origin, unique_points, ordered_groups, unrouted, provider_type)
                return self._result(stops, skipped, provider="ors", source_label=source_label)
            except OpenRouteServiceError as exc:
                logger.warning("OpenRouteService plan failed: %s. Checking Google Maps fallback.", exc)
                if self.api_key:
                    provider_type = "gmap"
                else:
                    raise RoadRouteError(str(exc))
            except Exception as exc:
                logger.warning("OpenRouteService plan unexpected error: %s", exc)
                if self.api_key:
                    provider_type = "gmap"
                else:
                    raise RoadRouteError(f"Could not calculate routes via OpenRouteService: {exc}")

        # -------------------------------------------------------------
        # Option 2: Google Maps Routes API (gmap)
        # -------------------------------------------------------------
        if not self.api_key:
            raise RoadRouteError("Google Routes API key is not configured. Please set GOOGLE_ROUTES_API_KEY or GOOGLE_GEOCODING_API_KEY.")

        origins = [origin]
        destinations = [tuple(p) for p in unique_points]
        matrix = {}
        failed_pairs = set()
        failure_codes = Counter()
        headers = {"X-Goog-Api-Key": self.api_key}
        semaphore = asyncio.Semaphore(4)
        try:
            async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
                # Match computeRoutes for a single destination; batch multi-stop comparisons.
                if len(unique_points) == 1:
                    response = await client.post(self.ROUTES_URL, headers={
                        **headers, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
                    }, json={"origin": waypoint(origin), "destination": waypoint(destinations[0]),
                             "travelMode": self.travel_mode,
                             "routingPreference": self.ROUTING_PREFERENCE,
                             "computeAlternativeRoutes": False})
                    response.raise_for_status()
                    routes = response.json().get("routes", [])
                    matrix[0, 0] = route_values(routes[0]) if routes else None
                else:
                    async def batch(oi, di):
                        oslice = origins[oi:oi + self.BATCH_SIZE]
                        dslice = destinations[di:di + self.BATCH_SIZE]
                        async with semaphore:
                            response = await client.post(self.MATRIX_URL, headers={
                                **headers, "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
                            }, json={
                                "origins": [{"waypoint": waypoint(p)} for p in oslice],
                                "destinations": [{"waypoint": waypoint(p)} for p in dslice],
                                "travelMode": self.travel_mode,
                                "routingPreference": self.ROUTING_PREFERENCE,
                            })
                            response.raise_for_status()
                            elements = response.json()
                        seen = set()
                        for item in elements:
                            # Protobuf JSON may omit an index whose value is zero.
                            i, j = item.get("originIndex", 0), item.get("destinationIndex", 0)
                            if not (0 <= i < len(oslice) and 0 <= j < len(dslice)):
                                raise ValueError("Invalid matrix index")
                            if (i, j) in seen:
                                raise ValueError("Duplicate matrix index")
                            seen.add((i, j))
                            code = item.get("status", {}).get("code", 0)
                            if code:
                                if code in (7, 8, 16):
                                    logger.warning("Google route matrix access/quota failure: status=%s", code)
                                    raise RoadRouteError("Could not calculate motorcycle routes. Check Routes API access, billing and quota, then retry.")
                                failure_codes[code] += 1
                                failed_pairs.add((oi + i, di + j))
                                matrix[oi + i, di + j] = None
                                continue
                            if item.get("condition") not in ("ROUTE_EXISTS", "ROUTE_NOT_FOUND"):
                                raise ValueError("Missing route condition")
                            matrix[oi + i, di + j] = route_values(item) if item["condition"] == "ROUTE_EXISTS" else None
                        if len(seen) != len(oslice) * len(dslice):
                            raise ValueError("Incomplete route matrix")

                    outcomes = await asyncio.wait_for(asyncio.gather(*(
                        batch(i, j) for i in range(0, len(origins), self.BATCH_SIZE)
                        for j in range(0, len(destinations), self.BATCH_SIZE)
                    ), return_exceptions=True), timeout=60)
                    for outcome in outcomes:
                        if isinstance(outcome, Exception):
                            raise outcome
        except (httpx.HTTPError, ValueError, KeyError, TypeError, TimeoutError) as exc:
            raise RoadRouteError("Could not calculate motorcycle routes. Check Routes API access, billing and quota, then retry.") from exc

        if failure_codes:
            logger.warning("Google route matrix failed comparisons by status: %s", dict(failure_codes))

        reachable = [i for i in range(len(unique_points)) if matrix[0, i] is not None]
        reachable.sort(key=lambda i: (matrix[0, i]["distance_meters"], groups[i][0]))
        remaining = [i for i in range(len(unique_points)) if matrix[0, i] is None]
        ordered_groups = [(i, matrix[0, i]) for i in reachable]
        stops = self._expand_cached(ordered_groups, groups)
        if not stops and failed_pairs:
            raise RoadRouteError("Google could not calculate routes from your location. Please retry.")
        unrouted = [(i, "Google could not calculate this route. Click Route to retry."
                     if (0, i) in failed_pairs else "No road route from your location")
                    for i in remaining]
        skipped.extend({"record_id": record_id, "reason": reason}
                       for i, reason in unrouted for record_id in groups[i])

        if not failed_pairs:
            self._cache_put(origin, unique_points, ordered_groups, unrouted, "gmap")
        return self._result(stops, skipped, provider="gmap", source_label="Google Maps")

    def _result(self, stops, skipped, provider="ors", source_label=None):
        label = source_label or ("OpenRouteService (ORS)" if provider == "ors" else "Google Maps")
        return {
            "travel_mode": self.travel_mode,
            "ordering": "nearest_from_origin",
            "provider": provider,
            "provider_label": label,
            "stops": stops,
            "unrouted": skipped,
        }

    # ---- Route-plan cache: identical pending sets reuse the computed plan. ----

    _plan_cache: dict[tuple, tuple[float, tuple[float, float], list, list]] = {}

    def _cache_key(self, origin, points, provider="ors"):
        rounded = tuple((round(p[0], 5), round(p[1], 5)) for p in points)
        return ("nearest_from_origin", provider, self.travel_mode, self.ROUTING_PREFERENCE,
                round(origin[0], 5), round(origin[1], 5), rounded)

    def _cache_get(self, origin, points, provider="ors", max_origin_drift_meters=100.0):
        """Return (ordered, unrouted, is_proximate), if fresh and within drift threshold."""
        now = time.time()
        # 1. Exact match lookup
        key = self._cache_key(origin, points, provider)
        entry = self._plan_cache.get(key)
        if entry:
            stored_at, cached_origin, ordered, unrouted = entry
            if now - stored_at <= self.cache_ttl_seconds:
                return ordered, unrouted, False
            else:
                self._plan_cache.pop(key, None)

        # 2. Proximity lookup: check if route was already computed for the same destination points
        # where the origin is within max_origin_drift_meters (default 100m drift)
        from app.services.location_cache_service import haversine_distance
        rounded_points = tuple((round(p[0], 5), round(p[1], 5)) for p in points)
        for cache_k, entry in list(self._plan_cache.items()):
            _, p_type, travel, pref, _, _, pts = cache_k
            if (
                p_type == provider
                and travel == self.travel_mode
                and pref == self.ROUTING_PREFERENCE
                and pts == rounded_points
            ):
                stored_at, cached_origin, ordered, unrouted = entry
                if now - stored_at <= self.cache_ttl_seconds:
                    drift = haversine_distance(origin[0], origin[1], cached_origin[0], cached_origin[1])
                    if drift <= max_origin_drift_meters:
                        logger.info(
                            "Cache hit for %s route with %.1fm origin drift <= %.1fm (0 API calls)",
                            provider, drift, max_origin_drift_meters
                        )
                        return ordered, unrouted, True
                else:
                    self._plan_cache.pop(cache_k, None)

        return None

    @staticmethod
    def _expand_cached(ordered, groups):
        """Rebuild per-record stops from a cached unique-point plan."""
        stops = []
        for nearest, from_origin in ordered:
            for record_id in groups[nearest]:
                stops.append({"record_id": record_id, "stop_order": len(stops) + 1,
                              "leg_distance_meters": None, "leg_duration_seconds": None,
                              "distance_from_origin_meters": from_origin["distance_meters"],
                              "duration_from_origin_seconds": from_origin["duration_seconds"]})
        return stops

    def _cache_put(self, origin, points, ordered, unrouted, provider="ors"):
        now = time.time()
        if now - getattr(self, '_cache_sweeped_at', 0) > self.cache_ttl_seconds:
            expired = [k for k, entry in self._plan_cache.items() if now - entry[0] > self.cache_ttl_seconds]
            for k in expired:
                self._plan_cache.pop(k, None)
            self._cache_sweeped_at = now
        self._plan_cache[self._cache_key(origin, points, provider)] = (now, origin, ordered, unrouted)
