import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

IST = timezone(timedelta(hours=5, minutes=30), name="IST")

# Field captures carry the full capture HUD (location / coordinates /
# accuracy / date / time). Photos uploaded from the admin side are not device
# captures — no real fix, no real capture time — so they carry one pill naming
# the uploader instead of borrowed telemetry.
PILL_FILL = (15, 23, 42, 210)
PILL_BORDER = (255, 255, 255, 55)
PILL_INK = (255, 255, 255)
ICON_INK = (255, 255, 255, 235)


def to_ist(dt_val: datetime) -> datetime:
    """Convert datetime to Indian Standard Time (IST, UTC+5:30)."""
    if dt_val.tzinfo is None:
        dt_val = dt_val.replace(tzinfo=timezone.utc)
    return dt_val.astimezone(IST)


def validate_image_magic_bytes(image_bytes: bytes) -> bool:
    """Validate binary magic bytes to ensure file is genuinely a JPEG, PNG, or WebP.
    Prevents disguised executables, scripts, or polyglots from passing extension checks.
    """
    if not image_bytes or len(image_bytes) < 8:
        return False
    # JPEG: starts with FF D8 FF
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return True
    # PNG: starts with 89 50 4E 47 0D 0A 1A 0A
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    # WebP: starts with RIFF....WEBP
    if image_bytes.startswith(b"RIFF") and len(image_bytes) >= 12 and image_bytes[8:12] == b"WEBP":
        return True
    return False


class ImageService:
    """Handles image resize, watermark, and JPEG encoding."""

    def create_thumbnail(self, image_bytes: bytes, max_dim: int = 160) -> bytes:
        """Create a lightweight ~4-6 KB thumbnail from image bytes for instant card previews."""
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=80, optimize=True)
        return out.getvalue()

    def process_image(
        self,
        image_bytes: bytes,
        latitude: float,
        longitude: float,
        captured_at: datetime,
        location_name: Optional[str] = None,
        formatted_address: Optional[str] = None,
        accuracy: Optional[float] = None,
        uploaded: Optional[str] = None,
    ) -> bytes:
        """
        Process an image: resize, watermark, and encode as JPEG.
        Returns processed JPEG bytes.

        uploaded = uploader email for an admin-side upload → "Uploaded by
        <email>" and nothing else. Default → the full field capture HUD.
        """
        if not validate_image_magic_bytes(image_bytes):
            raise ValueError("Invalid image file format (magic bytes verification failed)")

        img = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if necessary (JPEG doesn't support alpha)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Resize
        img = self._resize(img, settings.MAX_IMAGE_DIMENSION)

        # Watermark last, so the stamp sits on the final resized pixels.
        img = self._apply_watermark(
            img, latitude, longitude, captured_at, location_name, formatted_address, accuracy, uploaded
        )

        # Encode as JPEG with the strict configured ceiling (300 KB).
        return self._encode_compressed_jpeg(img, max_bytes=settings.MAX_IMAGE_SIZE_BYTES)

    def _encode_compressed_jpeg(self, img: Image.Image, max_bytes: int | None = None) -> bytes:
        """
        Encode image as JPEG with a hard maximum size ceiling (default:
        settings.MAX_IMAGE_SIZE_BYTES = 300 KB).

        There is no early cutoff: JPEG quality is reduced first, then dimensions
        are scaled down iteratively, until len(data) <= max_bytes is guaranteed.
        """
        if max_bytes is None:
            max_bytes = settings.MAX_IMAGE_SIZE_BYTES

        target_img = img
        quality = 82
        min_quality = 42
        data = b""

        # 1. Reduce quality first (keeps the most detail per byte).
        while quality >= min_quality:
            out = io.BytesIO()
            target_img.save(out, format="JPEG", quality=quality, optimize=True)
            data = out.getvalue()
            if len(data) <= max_bytes:
                return data
            quality -= 6

        # 2. Still too large: keep scaling dimensions down (no 640px cutoff)
        #    and re-encoding until the ceiling holds. JPEG size scales roughly
        #    with pixel count, so aim the shrink factor straight at the byte
        #    deficit instead of blind small steps — this converges in a few
        #    encodes even for incompressible (noise-like) imagery. The 16px
        #    floor and iteration cap guard against degenerate input.
        current_dim = max(target_img.size)
        iterations = 0
        while len(data) > max_bytes and current_dim > 16 and iterations < 24:
            iterations += 1
            ratio = (max_bytes / len(data)) ** 0.5
            current_dim = max(16, int(current_dim * max(0.10, min(0.95, ratio))))
            target_img = self._resize(target_img, current_dim)
            out = io.BytesIO()
            target_img.save(out, format="JPEG", quality=55, optimize=True)
            data = out.getvalue()

        return data

    def _resize(self, img: Image.Image, max_dimension: int) -> Image.Image:
        """Resize image so the largest dimension is at most max_dimension."""
        width, height = img.size
        if max(width, height) <= max_dimension:
            return img

        ratio = max_dimension / max(width, height)
        new_width = int(width * ratio)
        new_height = int(height * ratio)
        return img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    @staticmethod
    def format_coordinates(latitude: float, longitude: float) -> str:
        """`11.02435° N, 77.00748° E` — hemisphere suffix instead of a minus sign."""
        lat = f"{abs(latitude):.5f}° {'N' if latitude >= 0 else 'S'}"
        lng = f"{abs(longitude):.5f}° {'E' if longitude >= 0 else 'W'}"
        return f"{lat}, {lng}"

    @staticmethod
    def main_location(location_name: Optional[str], formatted_address: Optional[str]) -> str:
        """City and state — the tail of the address, minus pincodes and country."""
        source = (formatted_address or location_name or "").strip()
        parts = []
        for raw in source.split(","):
            # "Tamil Nadu 641014" -> "Tamil Nadu", "52" -> dropped entirely
            cleaned = " ".join("".join(" " if ch.isdigit() else ch for ch in raw).split())
            if cleaned and cleaned.lower() != "india":
                parts.append(cleaned)
        return ", ".join(parts[-2:]) or (location_name or "").strip()

    @staticmethod
    def _create_icon(kind: str, size: int) -> Image.Image:
        """Supersampled vector glyph for a watermark pill."""
        s = 128
        icon = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(icon)
        lw = max(6, int(s * 0.1))

        if kind == "pin":
            cx, cy, r = s // 2, int(s * 0.38), int(s * 0.29)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ICON_INK)
            d.polygon(
                [
                    (cx - int(r * 0.8), cy + int(r * 0.3)),
                    (cx + int(r * 0.8), cy + int(r * 0.3)),
                    (cx, int(s * 0.9)),
                ],
                fill=ICON_INK,
            )
            inner = int(r * 0.42)
            d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=PILL_FILL)
        elif kind == "target":
            m = int(s * 0.17)
            d.ellipse([m, m, s - m, s - m], outline=ICON_INK, width=lw)
            c = int(s * 0.11)
            d.ellipse([s // 2 - c, s // 2 - c, s // 2 + c, s // 2 + c], fill=ICON_INK)
            d.line([s // 2, 0, s // 2, m], fill=ICON_INK, width=lw)
            d.line([s // 2, s - m, s // 2, s], fill=ICON_INK, width=lw)
            d.line([0, s // 2, m, s // 2], fill=ICON_INK, width=lw)
            d.line([s - m, s // 2, s, s // 2], fill=ICON_INK, width=lw)
        elif kind == "upload":
            # Cloud-upload glyph: up arrow over a tray.
            d.polygon(
                [
                    (int(s * 0.5), int(s * 0.06)),
                    (int(s * 0.88), int(s * 0.5)),
                    (int(s * 0.62), int(s * 0.5)),
                    (int(s * 0.62), int(s * 0.68)),
                    (int(s * 0.38), int(s * 0.68)),
                    (int(s * 0.38), int(s * 0.5)),
                    (int(s * 0.12), int(s * 0.5)),
                ],
                fill=ICON_INK,
            )
            d.rounded_rectangle(
                [int(s * 0.12), int(s * 0.76), int(s * 0.88), int(s * 0.92)],
                radius=int(s * 0.06),
                fill=ICON_INK,
            )
        elif kind == "arrow":
            d.polygon(
                [
                    (int(s * 0.5), int(s * 0.06)),
                    (int(s * 0.9), int(s * 0.94)),
                    (int(s * 0.5), int(s * 0.72)),
                    (int(s * 0.1), int(s * 0.94)),
                ],
                fill=ICON_INK,
            )
        elif kind == "calendar":
            d.rounded_rectangle(
                [int(s * 0.08), int(s * 0.2), int(s * 0.92), int(s * 0.94)],
                radius=int(s * 0.13),
                outline=ICON_INK,
                width=lw,
            )
            d.line([int(s * 0.08), int(s * 0.42), int(s * 0.92), int(s * 0.42)], fill=ICON_INK, width=lw)
            d.line([int(s * 0.32), int(s * 0.06), int(s * 0.32), int(s * 0.28)], fill=ICON_INK, width=lw)
            d.line([int(s * 0.68), int(s * 0.06), int(s * 0.68), int(s * 0.28)], fill=ICON_INK, width=lw)
        else:  # clock
            m = int(s * 0.14)
            d.ellipse([m, m, s - m, s - m], outline=ICON_INK, width=lw)
            d.line([s // 2, s // 2, s // 2, int(s * 0.31)], fill=ICON_INK, width=lw)
            d.line([s // 2, s // 2, int(s * 0.7), s // 2], fill=ICON_INK, width=lw)

        return icon.resize((size, size), Image.Resampling.LANCZOS)

    def _apply_watermark(
        self,
        img: Image.Image,
        latitude: float,
        longitude: float,
        captured_at: datetime,
        location_name: Optional[str] = None,
        formatted_address: Optional[str] = None,
        accuracy: Optional[float] = None,
        uploaded: Optional[str] = None,
    ) -> Image.Image:
        """Stamp the watermark: an admin-side upload gets one "Uploaded by
        <email>" pill, a field capture gets the full HUD (location +
        coordinates + accuracy, then date + time)."""
        width, height = img.size
        ist_dt = to_ist(captured_at)

        if uploaded:
            rows: list[list[tuple[str, str]]] = [[("upload", f"Uploaded image | Uploaded by {uploaded}")]]
        else:
            top_row: list[tuple[str, str]] = []
            location = self.main_location(location_name, formatted_address)
            if location:
                top_row.append(("pin", location))
            top_row.append(("target", self.format_coordinates(latitude, longitude)))
            if accuracy:
                top_row.append(("arrow", f"±{accuracy:.1f} m"))

            rows = [
                top_row,
                [
                    ("calendar", ist_dt.strftime("%d %b %Y")),
                    ("clock", ist_dt.strftime("%I:%M %p IST")),
                ],
            ]

        # Proportional sizing (1.6% of image width, bounded 20–52px)
        font_size = max(20, min(52, int(width * 0.016)))
        font_bold = self._load_font(
            ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "arialbd.ttf",
             "arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
            font_size,
        )
        font_regular = self._load_font(
            ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "arial.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
            font_size,
        )

        pill_h = int(font_size * 2.0)
        pad_x = int(font_size * 0.8)
        pill_gap = int(font_size * 0.45)
        icon_size = int(font_size * 1.0)
        icon_gap = int(font_size * 0.4)
        row_gap = int(font_size * 0.5)
        margin = max(20, int(width * 0.018))

        # First pill in the first row carries the location and reads as the title.
        title = rows[0][0][1] if rows and rows[0] and rows[0][0][0] == "pin" else None

        measure = ImageDraw.Draw(img)
        icons = {
            kind: self._create_icon(kind, icon_size)
            for kind, _ in [pair for row in rows for pair in row]
        }

        def font_for(text: str):
            return font_bold if text == title else font_regular

        def pill_width(kind: str, text: str) -> int:
            text_w = int(measure.textlength(text, font=font_for(text)))
            return pad_x * 2 + icon_size + icon_gap + text_w

        row_widths = [
            sum(pill_width(kind, text) for kind, text in row) + pill_gap * (len(row) - 1)
            for row in rows
        ]
        block_w = max(row_widths)

        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        radius = pill_h // 2

        for row_idx, row in enumerate(rows):
            row_y = height - margin - (len(rows) - row_idx) * pill_h - (len(rows) - row_idx - 1) * row_gap
            x = width - margin - row_widths[row_idx]
            for kind, text in row:
                w = pill_width(kind, text)
                overlay_draw.rounded_rectangle(
                    [x, row_y, x + w, row_y + pill_h],
                    radius=radius,
                    fill=PILL_FILL,
                    outline=PILL_BORDER,
                    width=2,
                )
                x += w + pill_gap

        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

        for row_idx, row in enumerate(rows):
            row_y = height - margin - (len(rows) - row_idx) * pill_h - (len(rows) - row_idx - 1) * row_gap
            x = width - margin - row_widths[row_idx]
            for kind, text in row:
                icon_y = row_y + (pill_h - icon_size) // 2
                img.paste(icons[kind], (x + pad_x, icon_y), icons[kind])
                draw.text(
                    (x + pad_x + icon_size + icon_gap, row_y + (pill_h - font_size) // 2 - int(font_size * 0.12)),
                    text,
                    fill=PILL_INK,
                    font=font_for(text),
                )
                x += pill_width(kind, text) + pill_gap

        return img

    @staticmethod
    def _load_font(candidates: list[str], size: int):
        """First font file that loads, else Pillow's bitmap default."""
        for candidate in candidates:
            try:
                return ImageFont.truetype(candidate, size)
            except (OSError, IOError):
                continue
        return ImageFont.load_default()
