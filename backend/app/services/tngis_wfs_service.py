"""
TNGIS WFS (GeoServer) Cadastral & Revenue Boundary Resolution Service.

Resolves geographic coordinates (latitude, longitude) into Tamil Nadu cadastral
land details (survey number, sub-division number, ULPIN) and revenue hierarchy
(village, taluk, district) using official TNGIS Web Feature Services:
  1. Primary cadastral layer: cadastral_analysis:fmb_ulpin
  2. Revenue village layer: Police_Jurisdiction:Data_Sharing_Revenue_Villages
"""

import logging
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import dotenv_values

logger = logging.getLogger(__name__)

# WFS Endpoints & Layer Configurations
WFS_URL = "https://tngis.tn.gov.in/tngismaps/wfs"
WFS_PARCEL_LAYER = "cadastral_analysis:fmb_ulpin"
WFS_VILLAGE_LAYER = "Police_Jurisdiction:Data_Sharing_Revenue_Villages"
BBOX_DELTA = 0.0003  # ~30 meters bounding box
MAX_FEATURES = 5

SURVEY_FIELDS = ["survey_no", "survey_number", "survey_num", "surveyno", "sur_no", "sno"]
SUBDIV_FIELDS = ["sub_div", "sub_division", "subdiv", "sub_div_no", "subdivision", "subdiv_no"]
VILLAGE_FIELDS = [
    "village_name", "village", "vill_name", "village_na", "village_nam",
    "vill_name_en", "village_name_en", "revenue_village", "name"
]
TALUK_FIELDS = ["taluk_name", "taluk", "taluk_na", "taluk_nam", "taluk_name_en", "tehsil_name"]
DISTRICT_FIELDS = ["district_name", "district", "district_na", "dist_name", "district_nam", "district_name_en", "dist"]
ULPIN_FIELDS = ["ulpin", "ulpin_no"]
OWNER_FIELDS = ["owner_name", "owner", "pattadar", "patta_owner", "owner_name_en"]

# In-memory lookup cache to prevent redundant WFS network queries
_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_MAX_SIZE = 2000

ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


def _get_access_token() -> Optional[str]:
    """Optional token from .env or environment variable."""
    token = None
    if ENV_PATH.exists():
        token = dotenv_values(ENV_PATH).get("TNGIS_ACCESS_TOKEN")
    if not token:
        token = os.environ.get("TNGIS_ACCESS_TOKEN")
    return token.strip() if token and token.strip() else None


def _get_headers() -> Dict[str, str]:
    """Browser-like headers for TNGIS GeoServer requests."""
    major = random.randint(120, 150)
    return {
        "User-Agent": f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36",
        "Accept": "application/json,*/*",
        "Referer": "https://tngis.tn.gov.in/apps/gi_viewer/map-viewer/index.html",
    }


def _point_in_ring(x: float, y: float, ring: List[List[float]]) -> bool:
    """Ray casting point-in-polygon containment test."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _feature_contains(feature: Dict[str, Any], lat: float, lng: float) -> bool:
    """True if the GeoJSON polygon/multipolygon contains the point (lat, lng)."""
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    polygons = [coords] if gtype == "Polygon" else (coords if gtype == "MultiPolygon" else [])
    for poly in polygons:
        if poly and _point_in_ring(lng, lat, poly[0]):
            # Check holes
            in_hole = any(_point_in_ring(lng, lat, hole) for hole in poly[1:])
            if not in_hole:
                return True
    return False


def _pick(props: Dict[str, Any], names: List[str]) -> str:
    """Case-insensitive property value extraction with trailing period cleanup."""
    if not props:
        return ""
    lowered = {str(k).lower(): v for k, v in props.items()}
    for n in names:
        val = lowered.get(n.lower())
        if val not in (None, ""):
            cleaned = str(val).strip()
            if cleaned.endswith(".") and len(cleaned) > 1:
                cleaned = cleaned[:-1].strip()
            return cleaned
    return ""


def _parse_parcel(props: Dict[str, Any]) -> Dict[str, str]:
    """Normalize properties into standard land details dictionary."""
    return {
        "survey_number": _pick(props, SURVEY_FIELDS),
        "sub_division": _pick(props, SUBDIV_FIELDS),
        "village": _pick(props, VILLAGE_FIELDS),
        "taluk": _pick(props, TALUK_FIELDS),
        "district": _pick(props, DISTRICT_FIELDS),
        "ulpin": _pick(props, ULPIN_FIELDS),
        "wfs_owner": _pick(props, OWNER_FIELDS),
    }


class TngisWfsService:
    """Singleton service for TNGIS WFS queries."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._session = requests.Session()
            cls._instance._geom = "the_geom"
        return cls._instance

    def _wfs_get(self, params: Dict[str, Any], timeout: int = 12) -> Optional[Dict[str, Any]]:
        """Execute GET request with retries and exponential backoff."""
        token = _get_access_token()
        cookies = {"access_token": token} if token else None
        headers = _get_headers()

        for attempt in range(1, 3):
            try:
                r = self._session.get(WFS_URL, params=params, headers=headers, cookies=cookies, timeout=timeout)
                if r.status_code == 200:
                    try:
                        return r.json()
                    except ValueError:
                        logger.warning("TNGIS WFS returned non-JSON response: %s", r.text[:200])
                        return None
                elif r.status_code in (401, 403):
                    logger.warning("TNGIS WFS requires authentication (status %s)", r.status_code)
                    return None
                elif r.status_code == 429:
                    logger.warning("TNGIS WFS rate limit reached (HTTP 429)")
                    return None
            except Exception as e:
                logger.debug("TNGIS WFS request attempt %d failed: %s", attempt, e)
                if attempt < 2:
                    time.sleep(1.0)
        return None

    def _query_layer(self, layer: str, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        """Query a WFS layer at (lat, lng) with CQL and BBOX fallback."""
        d = BBOX_DELTA
        base = {
            "service": "WFS",
            "request": "GetFeature",
            "typeName": layer,
            "outputFormat": "application/json",
            "maxFeatures": MAX_FEATURES,
        }
        strategies = [
            ("cql_point", {**base, "version": "1.1.0", "srsName": "EPSG:4326", "CQL_FILTER": f"INTERSECTS({self._geom},SRID=4326;POINT({lng} {lat}))"}),
            ("bbox_lonlat", {**base, "version": "1.0.0", "srsName": "EPSG:4326", "bbox": f"{lng - d},{lat - d},{lng + d},{lat + d},EPSG:4326"}),
            ("bbox_latlon", {**base, "version": "1.1.0", "srsName": "EPSG:4326", "bbox": f"{lat - d},{lng - d},{lat + d},{lng + d},EPSG:4326"}),
        ]

        for name, params in strategies:
            js = self._wfs_get(params)
            features = (js or {}).get("features") or []
            if not features:
                continue
            containing = [f for f in features if _feature_contains(f, lat, lng)]
            matched = (containing or features)[0]
            if matched.get("geometry_name"):
                self._geom = matched.get("geometry_name")
            return matched
        return None

    def resolve_coordinates(self, lat: float, lng: float) -> Dict[str, Any]:
        """
        Authoritative land detail resolution for given coordinates.
        Queries FMB parcel layer, then village boundary layer, then local VillageMasterService fallback.
        """
        cache_key = f"{lat:.6f},{lng:.6f}"
        if cache_key in _CACHE:
            return _CACHE[cache_key]

        res = {
            "coordinates": f"{lat:.6f}, {lng:.6f}",
            "latitude": lat,
            "longitude": lng,
            "survey_no": "",
            "subdivision_no": "",
            "village": "",
            "taluk": "",
            "district": "",
            "ulpin": "",
            "formatted_address": "",
            "source": "tngis_wfs",
            "success": False,
        }

        try:
            # 1. Query FMB cadastral parcel layer
            parcel_feature = self._query_layer(WFS_PARCEL_LAYER, lat, lng)
            if parcel_feature:
                props = parcel_feature.get("properties") or {}
                parsed_p = _parse_parcel(props)
                res["survey_no"] = parsed_p["survey_number"]
                res["subdivision_no"] = parsed_p["sub_division"]
                res["ulpin"] = parsed_p["ulpin"]
                res["village"] = parsed_p["village"]
                res["taluk"] = parsed_p["taluk"]
                res["district"] = parsed_p["district"]
                res["success"] = True

            # 2. Query Revenue Village boundary layer if village/taluk/district missing
            if not (res["village"] and res["taluk"] and res["district"]):
                village_feature = self._query_layer(WFS_VILLAGE_LAYER, lat, lng)
                if village_feature:
                    v_props = village_feature.get("properties") or {}
                    parsed_v = _parse_parcel(v_props)
                    res["village"] = res["village"] or parsed_v["village"]
                    res["taluk"] = res["taluk"] or parsed_v["taluk"]
                    res["district"] = res["district"] or parsed_v["district"]
                    res["success"] = True

            # 3. Canonicalize / Fallback to local VillageMasterService
            try:
                from app.services.village_master_service import get_village_master_service
                vms = get_village_master_service()
                if res["village"]:
                    master_entry = vms.lookup_village_by_name(res["village"])
                    if master_entry:
                        res["village"] = master_entry.get("vname") or res["village"]
                        if master_entry.get("tname"):
                            res["taluk"] = master_entry["tname"]
                        if master_entry.get("dname"):
                            res["district"] = master_entry["dname"]
                loc_match = vms.resolve_record_location(coordinates=f"{lat}, {lng}")
                if not (res["village"] and res["taluk"] and res["district"]):
                    res["village"] = res["village"] or loc_match.get("village", "")
                    res["taluk"] = res["taluk"] or loc_match.get("taluk", "")
                    res["district"] = res["district"] or loc_match.get("district", "")
                if loc_match.get("formatted_address"):
                    res["formatted_address"] = loc_match.get("formatted_address")
            except Exception as e:
                logger.debug("VillageMaster lookup error: %s", e)

            # Construct standardized address string
            parts = []
            if res["survey_no"]:
                s_part = f"{res['survey_no']}/{res['subdivision_no']}" if res["subdivision_no"] else res["survey_no"]
                parts.append(f"Survey No {s_part}")
            if res["village"]:
                parts.append(f"{res['village']} Village")
            if res["taluk"]:
                parts.append(f"{res['taluk']} Taluk")
            if res["district"]:
                parts.append(f"{res['district']} District")
            parts.append("Tamil Nadu")

            res["cadastral_address"] = ", ".join(parts) if len(parts) > 1 else ""
            if not res["formatted_address"] and res["cadastral_address"]:
                res["formatted_address"] = res["cadastral_address"]

            # Populate cache
            if len(_CACHE) >= _CACHE_MAX_SIZE:
                _CACHE.clear()
            _CACHE[cache_key] = res
            return res

        except Exception as e:
            logger.error("Error resolving coordinates (%s, %s) via WFS: %s", lat, lng, e)
            res["formatted_address"] = f"Coordinates: {lat:.6f}, {lng:.6f}"
            return res


def get_tngis_wfs_service() -> TngisWfsService:
    """Get singleton instance of TngisWfsService."""
    return TngisWfsService()
