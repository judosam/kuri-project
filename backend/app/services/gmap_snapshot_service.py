"""Google Maps satellite snapshots.

Downloads the Google satellite tiles around a location and stitches a 3x3 tile
mosaic (768x768 px — roughly 1.9 km across at the default zoom 18, which is the
deepest level that still carries real detail over the field sites) into one JPEG.

The mosaic is cached on disk per (latitude, longitude, zoom), so importing a
sheet downloads each unique site once and every later viewer — importer,
auditor, field verifier — reads the cached file instead of hitting Google
again. A small thumbnail is written alongside it so list views stay light.
"""

import io
import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Iterable, Optional

import httpx
from PIL import Image

from app.core.config import get_settings
from app.services.local_storage_service import LocalStorageService

logger = logging.getLogger(__name__)
settings = get_settings()

TILE_SIZE = 256
TILE_URL = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
TILE_HEADERS = {"User-Agent": "Mozilla/5.0 (PhotoCapture field audit)"}
# Every snapshot lives under this folder inside the uploads directory.
GMAP_FOLDER = "gmap"
THUMB_MAX_DIM = 200
MIN_ZOOM = 15
MAX_ZOOM = 21


def clamp_zoom(zoom: Optional[int]) -> int:
    """Snap a requested zoom into the range the satellite pyramid actually has."""
    value = zoom if zoom is not None else settings.GMAP_SNAPSHOT_ZOOM
    return max(MIN_ZOOM, min(MAX_ZOOM, int(value)))


def tile_grid() -> int:
    """Tiles per side of the mosaic — odd so the target sits in the centre tile."""
    grid = max(1, int(settings.GMAP_SNAPSHOT_TILE_GRID))
    return grid if grid % 2 == 1 else grid + 1


def deg2num(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Fractional tile indices for a coordinate (Slippy-map / Web Mercator)."""
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def cache_key(latitude: float, longitude: float, zoom: int) -> str:
    """Stable storage key shared by every record at the same location + zoom."""
    return f"{GMAP_FOLDER}/{latitude:.6f}_{longitude:.6f}_z{zoom}.jpg"


def zoom_from_key(key: Optional[str]) -> Optional[int]:
    """Tile zoom encoded in a storage key, so viewers can pin the served image."""
    match = re.search(r"_z(\d+)\.jpg$", key or "")
    return int(match.group(1)) if match else None


def marker_offset(latitude: float, longitude: float, zoom: int, grid: int) -> tuple[float, float]:
    """Pixel position of a coordinate inside its own mosaic (top-left origin).

    Used by the viewers to pin the exact site on the satellite image.
    """
    x, y = deg2num(latitude, longitude, zoom)
    half = grid // 2
    return (x - (int(x) - half)) * TILE_SIZE, (y - (int(y) - half)) * TILE_SIZE


class GmapSnapshotService:
    """Stitches and caches Google satellite mosaics for record coordinates."""

    def __init__(self) -> None:
        self.storage = LocalStorageService()

    # ── Tiles ─────────────────────────────────────────────────────────
    def _fetch_tile(self, tx: int, ty: int, zoom: int) -> Optional[Image.Image]:
        url = TILE_URL.format(x=tx, y=ty, z=zoom)
        try:
            response = httpx.get(
                url,
                headers=TILE_HEADERS,
                timeout=settings.GMAP_SNAPSHOT_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
            if response.status_code != 200 or not response.content:
                logger.warning("Google tile %s returned HTTP %s", url, response.status_code)
                return None
            return Image.open(io.BytesIO(response.content)).convert("RGB")
        except Exception as exc:  # noqa: BLE001 - imagery is best-effort
            logger.warning("Google tile %s failed: %s", url, exc)
            return None

    def build_mosaic(self, latitude: float, longitude: float, zoom: int) -> Optional[bytes]:
        """Download the surrounding tiles and stitch them into one JPEG."""
        grid = tile_grid()
        cx, cy = deg2num(latitude, longitude, zoom)
        half = grid // 2
        x_min, y_min = int(cx) - half, int(cy) - half

        n = 2**zoom
        # Grid jobs in standard raster order (row-major: top to bottom, left to right).
        # Explicitly associate each job with its target canvas tile coordinates (dx, dy).
        jobs = [
            (int((x_min + dx) % n), int(max(0, min(n - 1, y_min + dy))), dx, dy)
            for dy in range(grid)
            for dx in range(grid)
        ]
        # Tiles are independent round trips, so fetch them together — one
        # import of hundreds of rows stays inside a sensible time budget.
        with ThreadPoolExecutor(max_workers=min(len(jobs), 9)) as pool:
            tiles = list(pool.map(lambda j: self._fetch_tile(j[0], j[1], zoom), jobs))

        if all(tile is None for tile in tiles):
            return None

        canvas = Image.new("RGB", (grid * TILE_SIZE, grid * TILE_SIZE), (226, 232, 240))
        for (_, _, dx, dy), tile in zip(jobs, tiles):
            if tile is None:
                continue  # keep the neutral placeholder for a missing tile
            canvas.paste(tile, (dx * TILE_SIZE, dy * TILE_SIZE))

        # Satellite imagery is full of hard edges and thin colour detail, which
        # 4:2:0 chroma subsampling smears. Saving 4:4:4 at a high quality keeps
        # the mosaic as sharp as the tiles Google actually served.
        out = io.BytesIO()
        canvas.save(out, format="JPEG", quality=92, subsampling=0, optimize=True)
        return out.getvalue()

    # ── Cache + storage ───────────────────────────────────────────────
    def stored_key(self, latitude: float, longitude: float, zoom: int) -> str:
        return cache_key(latitude, longitude, zoom)

    def read_cached(self, key: str) -> Optional[bytes]:
        path = self.storage.get_file_path(key)
        if not path:
            return None
        try:
            with open(path, "rb") as handle:
                return handle.read()
        except OSError:
            return None

    def _save(self, key: str, image_bytes: bytes) -> None:
        """Write the mosaic (and its thumb companion) under the uploads folder."""
        file_name = key.split("/")[-1]
        self.storage.save_file(image_bytes, file_name, GMAP_FOLDER)
        try:
            thumb = Image.open(io.BytesIO(image_bytes))
            thumb.thumbnail((THUMB_MAX_DIM, THUMB_MAX_DIM), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            thumb.save(out, format="JPEG", quality=85, subsampling=0, optimize=True)
            self.storage.save_file(out.getvalue(), f"thumb_{file_name}", GMAP_FOLDER)
        except Exception as exc:  # noqa: BLE001 - a missing thumb is not fatal
            logger.warning("Could not write satellite thumbnail for %s: %s", key, exc)

    def ensure_image(
        self,
        latitude: float,
        longitude: float,
        zoom: Optional[int] = None,
        *,
        refresh: bool = False,
    ) -> Optional[str]:
        """Return the storage key for the mosaic, downloading it when needed."""
        if not settings.GMAP_SNAPSHOT_ENABLED:
            return None
        if latitude == 0 and longitude == 0:
            return None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None

        zoom = clamp_zoom(zoom)
        key = self.stored_key(latitude, longitude, zoom)

        if not refresh and self.storage.get_file_path(key):
            return key  # already on disk — reuse, never re-download

        image_bytes = self.build_mosaic(latitude, longitude, zoom)
        if not image_bytes:
            return None
        try:
            self._save(key, image_bytes)
        except Exception as exc:  # noqa: BLE001 - storage failure must not break import
            logger.error("Could not store satellite snapshot %s: %s", key, exc)
            return None
        return key


def parse_record_coordinates(record) -> Optional[tuple[float, float]]:
    """Best available coordinates for a record: admin-given, else the field fix."""
    from app.services.previous_records_import_service import parse_coordinates

    parsed = parse_coordinates(getattr(record, "coordinates", None))
    if parsed:
        return parsed

    field_lat = getattr(record, "field_latitude", None)
    field_lon = getattr(record, "field_longitude", None)
    if field_lat and field_lon and not (field_lat == 0 and field_lon == 0):
        return float(field_lat), float(field_lon)

    for image in getattr(record, "images", None) or []:
        if image.latitude and image.longitude and not (image.latitude == 0 and image.longitude == 0):
            return float(image.latitude), float(image.longitude)
    return None


def resolve_missing_address(record, latitude: float, longitude: float) -> bool:
    """Fill an empty street address from the Google Geocoding API.

    Only ever fills blanks — an address that came from the admin's sheet is the
    authority and is never overwritten.
    """
    if (getattr(record, "street_address", None) or "").strip():
        return False

    from app.services.location_cache_service import get_location_cache_service
    from app.services.location_service import LocationService

    try:
        resolved = get_location_cache_service().resolve(
            latitude, longitude, geocode_func=LocationService().reverse_geocode
        )
    except Exception as exc:  # noqa: BLE001 - geocoding is best-effort
        logger.warning("Reverse geocoding failed for (%s, %s): %s", latitude, longitude, exc)
        return False

    if not resolved:
        return False

    address = (resolved.formatted_address or "").strip()
    if not address:
        return False

    record.street_address = address
    if not (getattr(record, "admin_formatted_address", None) or "").strip():
        record.admin_formatted_address = address
    if not (getattr(record, "location_name", None) or "").strip() and resolved.location_name:
        record.location_name = resolved.location_name
    return True


def ensure_record_snapshot(
    db,
    record,
    zoom: Optional[int] = None,
    *,
    refresh: bool = False,
    lookup_address: bool = True,
) -> bool:
    """Store (or reuse) the satellite mosaic for a record. Never raises."""
    try:
        coordinates = parse_record_coordinates(record)
        if not coordinates:
            return False
        latitude, longitude = coordinates

        address_filled = lookup_address and resolve_missing_address(record, latitude, longitude)

        service = GmapSnapshotService()
        # Same location at the same zoom is already on disk → reuse the file.
        key = service.ensure_image(latitude, longitude, zoom, refresh=refresh)
        if not key:
            if address_filled:
                db.commit()
            return False

        record.gmap_image_key = key
        record.gmap_zoom = clamp_zoom(zoom)
        record.gmap_captured_at = datetime.now(timezone.utc)
        db.commit()
        return True
    except Exception as exc:  # noqa: BLE001 - never fail an import over imagery
        logger.error("Satellite snapshot failed for record %s: %s", getattr(record, "id", "?"), exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False


def generate_snapshots_for_records(record_ids: Iterable[int], zoom: Optional[int] = None) -> int:
    """Background job: snapshot every imported record that has coordinates.

    Opens its own session because it runs after the import response has been
    sent. Bounded by settings.GMAP_SNAPSHOT_MAX_PER_IMPORT.
    """
    from app.database.connection import SessionLocal
    from app.models.capture_record import CaptureRecord

    ids = [int(rid) for rid in record_ids][: settings.GMAP_SNAPSHOT_MAX_PER_IMPORT]
    if not ids or not settings.GMAP_SNAPSHOT_ENABLED:
        return 0

    db = SessionLocal()
    saved = 0
    try:
        records = db.query(CaptureRecord).filter(CaptureRecord.id.in_(ids)).all()
        for record in records:
            if ensure_record_snapshot(db, record, zoom=zoom):
                saved += 1
        if saved:
            logger.info("Satellite snapshots stored for %s of %s imported records", saved, len(ids))
    finally:
        db.close()
    return saved
