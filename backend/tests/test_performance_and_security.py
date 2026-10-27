import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.services.image_service import ImageService, validate_image_magic_bytes
from app.routers.auth import check_login_rate_limit, _login_attempts
from fastapi import HTTPException


def test_magic_bytes_validation():
    # Valid JPEG
    img = Image.new("RGB", (50, 50), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()
    assert validate_image_magic_bytes(jpeg_bytes) is True

    # Valid PNG
    buf_png = io.BytesIO()
    img.save(buf_png, format="PNG")
    png_bytes = buf_png.getvalue()
    assert validate_image_magic_bytes(png_bytes) is True

    # Invalid files (disguised shell script, random text, exe header)
    assert validate_image_magic_bytes(b"#!/bin/bash\nrm -rf /") is False
    assert validate_image_magic_bytes(b"MZ\x90\x00\x03\x00\x00\x00") is False
    assert validate_image_magic_bytes(b"hello world plain text") is False
    assert validate_image_magic_bytes(b"") is False


def test_create_thumbnail_dimension_and_size():
    service = ImageService()
    # Create large 2000x2000 test image
    img = Image.new("RGB", (2000, 2000), color="coral")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    original_bytes = buf.getvalue()

    thumb_bytes = service.create_thumbnail(original_bytes, max_dim=160)
    assert len(thumb_bytes) < 15 * 1024  # Under 15 KB

    thumb_img = Image.open(io.BytesIO(thumb_bytes))
    assert max(thumb_img.size) <= 160


def test_sliding_window_rate_limiter_blocks_abusive_ip():
    test_ip = "198.51.100.42"
    _login_attempts.pop(test_ip, None)

    # 10 attempts allowed
    for _ in range(10):
        check_login_rate_limit(test_ip, max_attempts=10, window_seconds=60)

    # 11th attempt must trigger 429 Too Many Requests
    with pytest.raises(HTTPException) as exc_info:
        check_login_rate_limit(test_ip, max_attempts=10, window_seconds=60)
    assert exc_info.value.status_code == 429
    assert "Too many login attempts" in exc_info.value.detail


def test_security_headers_present_in_response(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("X-XSS-Protection") == "1; mode=block"
    assert res.headers.get("X-Permitted-Cross-Domain-Policies") == "none"
