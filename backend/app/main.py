import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.core.config import get_settings
from app.database.connection import create_tables
from app.routers import admin, auth, location, records, quality, telecaller

settings = get_settings()

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""
    logger.info("Starting Photo Capture API...")
    create_tables()

    # Seed first admin if no users exist
    from app.database.connection import SessionLocal
    from app.services.auth_service import AuthService

    db = SessionLocal()
    try:
        auth_service = AuthService(db)
        auth_service.ensure_first_admin()
        from app.services.activity_log_service import backfill_historical_logs_if_empty
        backfill_historical_logs_if_empty(db)
        from app.routers.telecaller import sync_unassigned_telecaller_leads
        sync_unassigned_telecaller_leads(db)
    finally:
        db.close()

    logger.info("Database initialized, admin seeded and activity logs ready.")
    yield
    logger.info("Shutting down Photo Capture API.")


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # Local-development origins only; supports Expo/Vite running on any local port.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Built-in GZip compression for responses > 1KB (75-85% bandwidth reduction)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Permissions-Policy"] = "camera=(self), geolocation=(self)"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Include routers
app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(quality.router, prefix=settings.API_V1_PREFIX)
app.include_router(records.router, prefix=settings.API_V1_PREFIX)
app.include_router(location.router, prefix=settings.API_V1_PREFIX)
app.include_router(admin.router, prefix=settings.API_V1_PREFIX)
app.include_router(telecaller.router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Mobile/web clients historically used /api/health. Keep this alias so a
# connectivity check never reports a false 404 during local development.
@app.get("/api/health")
async def api_health_check():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {
        "app": settings.PROJECT_NAME,
        "docs": "/docs",
        "health": "/health",
    }
