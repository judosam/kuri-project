"""Tests for the capture watermark HUD and the admin-side "Uploaded" mark."""

import io
from datetime import datetime, timezone

from PIL import Image

from app.services.image_service import ImageService

FORMATTED = (
    "52, Nehru Nagar West 2nd St, NGP Nagar, Saravanampatti, "
    "Coimbatore, Tamil Nadu 641014, India"
)


def _white_photo() -> bytes:
    source = io.BytesIO()
    Image.new("RGB", (900, 600), (255, 255, 255)).save(source, format="PNG")
    return source.getvalue()


def dark_pixels(data: bytes, box: tuple[int, int, int, int]) -> int:
    """Count near-slate pixels in a crop of the stored image."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    crop = img.crop(box)
    # Pill slate is (15, 23, 42) at 82% over the photo, so JPEG leaves it near 60.
    return sum(1 for px in crop.getdata() if px[0] < 100 and px[1] < 100 and px[2] < 120)


def bottom_right_dark_pixels(data: bytes, size=140) -> int:
    """Count near-slate pixels in the corner the pills are drawn into."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    return dark_pixels(data, (w - size, h - size, w, h))


def telemetry_row_dark_pixels(data: bytes) -> int:
    """The row the location/coordinates/accuracy pills occupy (above the date row)."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    return dark_pixels(data, (w - 640, int(h * 0.80), w, int(h * 0.89)))


def test_coordinates_use_hemispheres():
    assert ImageService.format_coordinates(11.02435, 77.00748) == "11.02435° N, 77.00748° E"
    assert ImageService.format_coordinates(-33.86514, -151.20990) == "33.86514° S, 151.20990° W"


def test_main_location_is_city_and_state():
    # Pincode and country drop out, the street tail never becomes the title.
    assert ImageService.main_location(None, FORMATTED) == "Coimbatore, Tamil Nadu"
    assert ImageService.main_location("Tex Park", None) == "Tex Park"
    # A POI name must not displace the city/state taken from the full address.
    assert ImageService.main_location("Tex Park", FORMATTED) == "Coimbatore, Tamil Nadu"


def _process(**overrides) -> bytes:
    kwargs = dict(
        image_bytes=_white_photo(),
        latitude=11.02435,
        longitude=77.00748,
        captured_at=datetime(2026, 9, 21, 12, 52, tzinfo=timezone.utc),
        location_name=None,
        formatted_address=FORMATTED,
        accuracy=14.7,
    )
    kwargs.update(overrides)
    return ImageService().process_image(**kwargs)


def test_field_capture_gets_the_full_hud():
    data = _process()

    assert data[:2] == b"\xff\xd8"  # JPEG
    # Location/coordinates/accuracy row + date/time row are burned in.
    assert bottom_right_dark_pixels(data) > 0
    assert telemetry_row_dark_pixels(data) > 0

    # The stamp stays in the corner — the photo itself is untouched elsewhere.
    img = Image.open(io.BytesIO(data)).convert("RGB")
    assert img.getpixel((10, 10))[0] > 240


def test_accuracy_pill_is_optional():
    without = _process(accuracy=None)
    with_accuracy = _process(accuracy=14.7)

    assert bottom_right_dark_pixels(without) > 0
    # The extra ±accuracy pill widens the top row, so it carries more slate.
    assert telemetry_row_dark_pixels(with_accuracy) > telemetry_row_dark_pixels(without)


def test_admin_upload_carries_only_the_uploaded_mark():
    """Admin-side photos are not device captures, so no borrowed telemetry."""
    uploaded = _process(uploaded="ops.admin@example.com")

    assert bottom_right_dark_pixels(uploaded) > 0
    # Mark only: the telemetry row above the bottom pill stays photo-pure.
    assert telemetry_row_dark_pixels(uploaded) == 0
    assert telemetry_row_dark_pixels(_process()) > 0

    # The uploader email is what the pill prints — a longer address is a wider pill.
    def mark_width(data: bytes) -> int:
        img = Image.open(io.BytesIO(data))
        # Pill row for a 900x600 photo: bottom margin 20, pill height 40.
        return dark_pixels(data, (0, 538, img.size[0], 582))

    assert mark_width(_process(uploaded="a.very.long.uploader.name@example.com")) > mark_width(
        _process(uploaded="a@b.co")
    )
