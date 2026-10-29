import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, StaticPool
from sqlalchemy.orm import sessionmaker

from app.core.security import hash_password
from app.database.base import Base
from app.database.connection import get_db
from app.main import app
from app.models.user import User, UserRole


@pytest.fixture(autouse=True)
def _offline_google_services(monkeypatch):
    """Tests never download Google Maps tiles or hit the Geocoding API.

    Satellite snapshots run as a background task right after an import, so
    without this every import test would reach out to Google. Tests that want
    either behaviour opt back in by patching the tile fetcher / geocoder
    themselves (their later patch wins). The location cache is a module-level
    singleton, so it is reset per test as well.
    """
    import app.services.location_cache_service as cache_module
    import app.services.location_service as location_module
    from app.core.config import get_settings

    cache_module._shared_location_cache = None
    monkeypatch.setattr(get_settings(), "GMAP_SNAPSHOT_ENABLED", False)
    monkeypatch.setattr(
        location_module.LocationService,
        "reverse_geocode",
        lambda self, latitude, longitude: None,
    )
    yield
    cache_module._shared_location_cache = None


@pytest.fixture(scope="function")
def db_engine():
    """Create a fresh in-memory database engine for each test.
    Uses StaticPool so all connections share the same in-memory database."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        from app.database.connection import register_sqlite_functions
        register_sqlite_functions(dbapi_connection)

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(db_engine):
    """Create a fresh database session for each test."""
    TestSession = sessionmaker(bind=db_engine)
    session = TestSession()
    yield session
    session.close()


@pytest.fixture(scope="function")
def client(db_engine):
    """Create a test client with fresh database."""
    TestSession = sessionmaker(bind=db_engine)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    # Override database functions used by the app lifespan
    import app.database.connection as conn_module
    import app.main as main_module
    original_create_tables = conn_module.create_tables
    original_SessionLocal = conn_module.SessionLocal

    conn_module.create_tables = lambda: None  # Tables already created by fixture
    conn_module.SessionLocal = TestSession  # Use test session in lifespan

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    conn_module.create_tables = original_create_tables
    conn_module.SessionLocal = original_SessionLocal


@pytest.fixture
def test_user(db_session):
    """Create a test user."""
    user = User(
        email="test@example.com",
        password_hash=hash_password("testpass123"),
        full_name="Test User",
        role=UserRole.USER,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def test_admin(db_session):
    """Create a test admin."""
    admin = User(
        email="admin@example.com",
        password_hash=hash_password("adminpass123"),
        full_name="Test Admin",
        role=UserRole.ADMIN,
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def user_token(client, test_user):
    """Get auth token for test user."""
    response = client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "testpass123"},
    )
    return response.json()["access_token"]


@pytest.fixture
def admin_token(client, test_admin):
    """Get auth token for test admin."""
    response = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "adminpass123"},
    )
    return response.json()["access_token"]



def auth_header(token: str) -> dict:
    """Create authorization header."""
    return {"Authorization": f"Bearer {token}"}
