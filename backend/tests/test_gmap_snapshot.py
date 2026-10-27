"""Google Maps satellite snapshots: downloaded once per location, reused after.

Tiles are never fetched for real here — ``_fetch_tile`` is patched with a
generated tile so the tests stay offline and deterministic. Each test works on
its own random coordinates and deletes the cache files it created, so the
shared on-disk snapshot cache never leaks between runs.
"""

import io
import random

import pytest
from PIL import Image

from app.models.capture_record import CaptureRecord
from app.services.gmap_snapshot_service import (
    GmapSnapshotService,
    cache_key,
    clamp_zoom,
    ensure_record_snapshot,
    marker_offset,
)
from app.services.local_storage_service import UPLOAD_DIR, LocalStorageService

from tests.conftest import auth_header


@pytest.fixture
def site():
    """Coordinates no earlier run can already have cached."""
    return round(random.uniform(-70, -10), 6), round(random.uniform(100, 179), 6)


@pytest.fixture
def tile_fetcher(monkeypatch, site):
    """Count tile downloads, serve generated tiles, and clean up afterwards."""
    calls = {"count": 0}

    def _fake_fetch(self, tx, ty, zoom):
        calls["count"] += 1
        image = Image.new("RGB", (256, 256), (40 + (tx % 20), 90, 140 + (ty % 20)))
        out = io.BytesIO()
        image.save(out, format="JPEG")
        return Image.open(io.BytesIO(out.getvalue())).convert("RGB")

    monkeypatch.setattr(GmapSnapshotService, "_fetch_tile", _fake_fetch)
    # Snapshot tests run with the feature enabled again.
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "GMAP_SNAPSHOT_ENABLED", True)

    yield calls

    lat, lng = site
    folder = UPLOAD_DIR / "gmap"
    for pattern in (f"{lat:.6f}_{lng:.6f}_z*.jpg", f"thumb_{lat:.6f}_{lng:.6f}_z*.jpg"):
        for leftover in folder.glob(pattern):
            leftover.unlink(missing_ok=True)


def _record(db_session, site, name, **kwargs):
    lat, lng = site
    record = CaptureRecord(
        name=name,
        description="",
        user_id=None,
        status="NOT_COMPLETED",
        source="imported",
        coordinates=f"{lat}, {lng}",
        **kwargs,
    )
    db_session.add(record)
    db_session.commit()
    return record


def test_mosaic_cached_on_disk_and_reused(db_session, site, tile_fetcher):
    record = _record(db_session, site, "Snapshot site")

    assert ensure_record_snapshot(db_session, record, zoom=19, refresh=True) is True
    first_pass = tile_fetcher["count"]
    assert first_pass == 9  # one 3x3 mosaic

    key = cache_key(*site, 19)
    assert record.gmap_image_key == key
    assert record.gmap_zoom == 19
    assert record.gmap_captured_at is not None
    storage = LocalStorageService()
    assert storage.get_file_path(key)
    assert storage.get_thumbnail_path(key)  # list views get the light copy

    # Every viewer assumes a 3x3 mosaic when it places the site marker.
    with Image.open(storage.get_file_path(key)) as mosaic:
        assert mosaic.size == (768, 768)
    with Image.open(storage.get_thumbnail_path(key)) as thumb:
        assert max(thumb.size) == 200

    # Any later viewer at the same location + zoom reads the cached file
    # instead of downloading the tiles again.
    assert ensure_record_snapshot(db_session, record, zoom=19) is True
    assert tile_fetcher["count"] == first_pass


def test_zoom_levels_are_clamped_and_cached_separately(db_session, site, tile_fetcher):
    # The default is the deepest zoom with real imagery over the field sites.
    assert clamp_zoom(None) == 18
    assert clamp_zoom(3) == 15
    assert clamp_zoom(99) == 21

    record = _record(db_session, site, "Zoom site")

    ensure_record_snapshot(db_session, record, zoom=18)
    first_pass = tile_fetcher["count"]
    assert record.gmap_zoom == 18

    # Same location, deeper zoom → a second mosaic, cached under its own key.
    ensure_record_snapshot(db_session, record, zoom=20)
    assert tile_fetcher["count"] == first_pass + 9
    assert record.gmap_zoom == 20
    assert record.gmap_image_key == cache_key(*site, 20)


def test_empty_street_address_is_filled_from_geocoding(db_session, site, tile_fetcher, monkeypatch):
    from app.services.location_service import LocationService

    monkeypatch.setattr(
        LocationService,
        "reverse_geocode",
        lambda self, lat, lon: {
            "location_name": "Sample Nagar",
            "formatted_address": "12 Sample Street, Sample Nagar",
            "place_id": "test-place",
        },
    )

    blank = _record(db_session, site, "No address yet")
    assert ensure_record_snapshot(db_session, blank) is True
    assert blank.street_address == "12 Sample Street, Sample Nagar"
    assert blank.admin_formatted_address == "12 Sample Street, Sample Nagar"
    assert blank.location_name == "Sample Nagar"

    # An address that came from the admin's sheet is the authority — never
    # overwritten by a resolved one.
    given = _record(
        db_session,
        site,
        "Sheet address wins",
        street_address="Admin given street",
        admin_formatted_address="Admin given address",
    )
    ensure_record_snapshot(db_session, given)
    assert given.street_address == "Admin given street"
    assert given.admin_formatted_address == "Admin given address"


def test_missing_coordinates_leave_the_record_without_a_snapshot(db_session, site, tile_fetcher):
    record = CaptureRecord(
        name="No coordinates",
        description="",
        user_id=None,
        status="NOT_COMPLETED",
        source="imported",
    )
    db_session.add(record)
    db_session.commit()

    assert ensure_record_snapshot(db_session, record) is False
    assert record.gmap_image_key is None
    assert tile_fetcher["count"] == 0


def test_marker_offset_pins_the_exact_site(site):
    # The point must land inside the centre tile of a 3x3 mosaic.
    x, y = marker_offset(*site, 19, 3)
    assert 256 <= x <= 512
    assert 256 <= y <= 512


def test_import_downloads_the_snapshot_in_the_background(
    client, db_session, site, tile_fetcher, admin_token, monkeypatch
):
    """The previous-records import pulls each site's satellite image after it returns."""
    import io as _io

    import openpyxl

    from app.core.security import hash_password
    from app.models.user import User, UserRole

    operator = User(
        email="gmap.operator@example.com",
        password_hash=hash_password("pass12345"),
        full_name="Gmap Operator",
        role=UserRole.USER,
        is_active=True,
    )
    db_session.add(operator)
    db_session.commit()

    lat, lng = site
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Previous Records"
    headers = ["operator_email", "unique_id", "coordinates", "street_address", "site_address", "date_of_visit"]
    sheet.append(headers)
    sheet.append([operator.email, "GMAP-IMPORT-1", f"{lat}, {lng}", "", "Gmap test site", "2024-05-11"])
    buffer = _io.BytesIO()
    workbook.save(buffer)

    response = client.post(
        "/api/admin/records/import-previous/commit",
        files={"file": ("previous.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["imported_count"] == 1, payload
    record_id = payload["records"][0]["record_id"]

    # TestClient runs background tasks before returning, so the snapshot is
    # already stored by the time the request completes.
    assert tile_fetcher["count"] == 9
    stored = (db_session.query(CaptureRecord).filter(CaptureRecord.id == record_id).one())
    assert stored.gmap_zoom == 18  # the single default zoom, no tile-zoom picking
    assert stored.gmap_image_key == cache_key(lat, lng, 18)

    served = client.get(f"/api/admin/records/{record_id}/gmap-image", headers=auth_header(admin_token))
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"


def test_detail_payload_exposes_snapshot_url(client, db_session, site, admin_token):
    record = _record(
        db_session,
        site,
        "Panel site",
        gmap_image_key=cache_key(*site, 19),
        gmap_zoom=19,
    )

    payload = client.get(
        f"/api/admin/records/{record.id}", headers=auth_header(admin_token)
    ).json()
    assert payload["gmap_image_url"] == f"/api/admin/records/{record.id}/gmap-image"
    assert payload["gmap_zoom"] == 19

    # The snapshot is served straight from the shared cache, no download needed.
    LocalStorageService().save_file(b"jpeg-bytes", f"{site[0]:.6f}_{site[1]:.6f}_z19.jpg", "gmap")
    served = client.get(
        f"/api/admin/records/{record.id}/gmap-image",
        headers=auth_header(admin_token),
    )
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"


def test_mosaic_tiles_are_not_transposed(monkeypatch):
    """Ensure tiles are pasted in proper row-major raster order without matrix transposition."""
    from app.core.config import get_settings
    from app.services.gmap_snapshot_service import deg2num

    service = GmapSnapshotService()

    def _fetch_colored_tile(self, tx, ty, zoom):
        # Encode tx and ty distinctly in color channels: R = tx % 250, G = ty % 250
        return Image.new("RGB", (256, 256), ((tx * 17) % 250, (ty * 31) % 250, 100))

    monkeypatch.setattr(GmapSnapshotService, "_fetch_tile", _fetch_colored_tile)
    monkeypatch.setattr(get_settings(), "GMAP_SNAPSHOT_ENABLED", True)

    lat, lon, zoom = 10.959619, 76.995771, 18
    cx, cy = deg2num(lat, lon, zoom)
    half = 3 // 2
    x_min, y_min = int(cx) - half, int(cy) - half
    n = 2**zoom

    raw_bytes = service.build_mosaic(lat, lon, zoom)
    assert raw_bytes is not None
    img = Image.open(io.BytesIO(raw_bytes))

    for dy in range(3):
        for dx in range(3):
            expected_tx = int((x_min + dx) % n)
            expected_ty = int(max(0, min(n - 1, y_min + dy)))
            expected_r = (expected_tx * 17) % 250
            expected_g = (expected_ty * 31) % 250

            # Sample center of tile (dx, dy)
            pixel = img.getpixel((dx * 256 + 128, dy * 256 + 128))
            # Tolerant to JPEG compression artifacts
            assert abs(pixel[0] - expected_r) <= 6, f"Tile at col {dx}, row {dy} has wrong X (transposed?)"
            assert abs(pixel[1] - expected_g) <= 6, f"Tile at col {dx}, row {dy} has wrong Y (transposed?)"
