import os
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


# Local checkout: repo/.env. Packaged backend: /app/.env.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = (BACKEND_DIR.parent if BACKEND_DIR.name == 'backend' else BACKEND_DIR) / '.env'

class Settings(BaseSettings):
    # App
    PROJECT_NAME: str = "Photo Capture API"
    API_V1_PREFIX: str = "/api"
    DEBUG: bool = False

    # Security
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"

    # Default / Initial Admin Account (seed & environment sync)
    ADMIN_EMAIL: str = "admin@photocapture.local"
    ADMIN_PASSWORD: str = "admin123"
    ADMIN_NAME: str = "System Admin"

    # Database
    DATABASE_URL: str = "sqlite:///./data/app.db"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:8081,http://localhost:19006"

    # Google Drive
    GOOGLE_DRIVE_CREDENTIALS_PATH: str = "./credentials/service-account.json"
    GOOGLE_DRIVE_ROOT_FOLDER_ID: str = ""

    # Google Geocoding
    GOOGLE_GEOCODING_API_KEY: str = ""
    GOOGLE_ROUTES_API_KEY: str = ""
    # Street View Static API (metadata + imagery); falls back to the Geocoding key.
    GOOGLE_STREETVIEW_API_KEY: str = ""

    # OpenRouteService (ORS)
    OPENROUTESERVICE_API_KEY: str = ""
    OPENROUTESERVICE_BASE_URL: str = "http://localhost:8080/ors"

    # Google Maps satellite snapshot — a stitched tile mosaic saved per record so
    # every panel (importer / auditor / field verifier) shows the same imagery
    # without ever re-downloading tiles for a location already captured.
    GMAP_SNAPSHOT_ENABLED: bool = True
    # One fixed tile zoom for every record. Measured against live Google
    # imagery over the Indian field sites: z18 is the deepest level that still
    # holds real detail (~60 cm/pixel). z19/z20 are resamplings of the same
    # source imagery, so they look softer at 100% without gaining anything —
    # the viewer's own magnification is what inspects a site closely.
    GMAP_SNAPSHOT_ZOOM: int = 18
    # Tiles per side (3 -> 768x768 px, roughly 1 km across at zoom 19).
    GMAP_SNAPSHOT_TILE_GRID: int = 3
    GMAP_SNAPSHOT_TIMEOUT_SECONDS: float = 10.0
    # Ceiling on snapshots fetched by one import, so a huge sheet cannot hold a
    # background worker for hours.
    GMAP_SNAPSHOT_MAX_PER_IMPORT: int = 400

    # Location Cache
    LOCATION_CACHE_DISTANCE_THRESHOLD_METERS: float = 50.0
    LOCATION_CACHE_STALENESS_DAYS: int = 365

    # Route Sorting cost controls
    # Minutes a computed route plan stays valid; repeated sorts of the same
    # pending set within this window reuse the plan instead of re-billing Google.
    ROUTE_PLAN_CACHE_MINUTES: int = 30
    # Travel mode for route sorting. TWO_WHEELER bills the Enterprise SKU;
    # DRIVE bills Essentials — roughly 3x cheaper per element in India.
    ROUTE_TRAVEL_MODE: str = "TWO_WHEELER"

    # Upload Limits
    MAX_UPLOAD_SIZE_MB: int = 25
    ALLOWED_IMAGE_TYPES: List[str] = ["image/jpeg", "image/png", "image/webp"]
    MAX_IMAGE_DIMENSION: int = 1920
    JPEG_QUALITY: int = 82
    # Hard ceiling for a stored (watermarked) JPEG: 300 KB.
    MAX_IMAGE_SIZE_BYTES: int = 300 * 1024

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", case_sensitive=True, extra="ignore")

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024


@lru_cache()
def get_settings() -> Settings:
    s = Settings()
    if not s.DEBUG and s.SECRET_KEY == "change-me-in-production":
        import logging
        logging.getLogger(__name__).critical(
            "CRITICAL SECURITY WARNING: SECRET_KEY is set to default 'change-me-in-production'. "
            "Set a cryptographically strong SECRET_KEY in your .env before deploying to production!"
        )
    return s
