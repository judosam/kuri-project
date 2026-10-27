"""Tests for on-demand Google Geocoding address resolution."""

from datetime import datetime, timezone

import pytest

from app.core.security import hash_password
from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User, UserRole
from tests.conftest import auth_header

GEOCODED = {
    "location_name": "Tex Park",
    "formatted_address": "22WP+466, Tex Park Road, Coimbatore, Tamil Nadu 641014, India",
    "place_id": "ChIJ_test_place",
}


@pytest.fixture(autouse=True)
def clean_location_cache():
    """The geocoding cache is a module-level singleton — reset it per test."""
    import app.services.location_cache_service as cache_module

    cache_module._shared_location_cache = None
    yield
    cache_module._shared_location_cache = None


@pytest.fixture
def fake_geocoder(monkeypatch):
    """Replace the Google call, recording how many times it ran."""
    import app.services.location_service as location_module

    calls = []

    def fake_reverse_geocode(self, latitude, longitude):
        calls.append((latitude, longitude))
        return dict(GEOCODED)

    monkeypatch.setattr(location_module.LocationService, "reverse_geocode", fake_reverse_geocode)
    return calls


def make_record(db_session, user_id, **kwargs):
    """Create a bare record owned by ``user_id``."""
    record = CaptureRecord(user_id=user_id, name="Site Capture", description="", **kwargs)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def add_gps_image(db_session, record_id, latitude=11.0168, longitude=76.9558):
    """Attach a photo. 0/0 mirrors the app's "no GPS available" metadata."""
    image = CapturedImage(
        record_id=record_id,
        google_drive_file_id=f"local/{record_id}/{latitude}_{longitude}.jpg",
        file_name=f"Record_{record_id}_Photo_1.jpg",
        photo_order=1,
        latitude=latitude,
        longitude=longitude,
        location_accuracy=5.0,
        captured_at=datetime.now(timezone.utc),
    )
    db_session.add(image)
    db_session.commit()
    db_session.refresh(image)
    return image


class TestResolveAddressEndpoint:
    def test_resolves_and_persists_address(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id)
        add_gps_image(db_session, record.id)

        response = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["resolved"] is True
        assert body["address"] == GEOCODED["formatted_address"]
        assert body["place_name"] == GEOCODED["location_name"]
        assert body["error"] is None

        # Persisted, so the detail view shows it on the next load without re-billing.
        assert len(fake_geocoder) == 1
        detail = client.get(
            f"/api/records/{record.id}", headers=auth_header(user_token)
        ).json()
        assert detail["formatted_address"] == GEOCODED["formatted_address"]
        assert detail["location_name"] == GEOCODED["location_name"]
        assert detail["place_id"] == GEOCODED["place_id"]

    def test_uses_first_photo_with_gps(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id)
        # A photo with no GPS fix (0/0) must not be geocoded ahead of a real one.
        add_gps_image(db_session, record.id, latitude=0.0, longitude=0.0)
        add_gps_image(db_session, record.id, latitude=11.0168, longitude=76.9558)

        response = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        assert fake_geocoder == [(11.0168, 76.9558)]

    def test_zero_zero_gps_is_treated_as_missing(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id)
        add_gps_image(db_session, record.id, latitude=0.0, longitude=0.0)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["resolved"] is False
        assert fake_geocoder == []

    def test_record_without_gps_returns_reason(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id)

        response = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["resolved"] is False
        assert body["address"] is None
        assert "GPS" in body["error"]
        assert fake_geocoder == []

    def test_existing_address_is_not_re_resolved(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(
            db_session, test_user.id, formatted_address="Already stored address"
        )
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["resolved"] is True
        assert body["address"] == "Already stored address"
        assert fake_geocoder == []

    def test_force_re_resolves(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(
            db_session, test_user.id, formatted_address="Stale address"
        )
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address?force=true",
            headers=auth_header(user_token),
        ).json()
        assert body["address"] == GEOCODED["formatted_address"]
        assert len(fake_geocoder) == 1

    def test_forced_resolve_without_gps_keeps_stored_address(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        """A failed force attempt must not report an error next to a shown address."""
        record = make_record(
            db_session, test_user.id, formatted_address="Stored address"
        )

        body = client.post(
            f"/api/records/{record.id}/resolve-address?force=true",
            headers=auth_header(user_token),
        ).json()
        assert body["resolved"] is True
        assert body["address"] == "Stored address"
        assert body["error"] is None
        assert fake_geocoder == []

    def test_resolves_the_admin_given_coordinates_as_a_second_address(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(
            db_session, test_user.id, coordinates="11.045331, 77.035606"
        )
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["address"] == GEOCODED["formatted_address"]
        assert body["admin_address"] == GEOCODED["formatted_address"]

        detail = client.get(
            f"/api/records/{record.id}", headers=auth_header(user_token)
        ).json()
        assert detail["admin_formatted_address"] == GEOCODED["formatted_address"]

    def test_admin_coordinates_alone_resolve_without_captured_gps(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(
            db_session, test_user.id, coordinates="11.045331,77.035606"
        )

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        # Nothing was captured in the field, but the admin position still resolves.
        assert body["address"] is None
        assert body["admin_address"] == GEOCODED["formatted_address"]
        assert "GPS" in body["error"]

    def test_unparseable_admin_coordinates_are_ignored(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id, coordinates="not-a-coordinate")
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["resolved"] is True
        assert body["admin_address"] is None
        # Only the captured-GPS lookup ran; the admin string was never geocoded.
        assert fake_geocoder == [(11.0168, 76.9558)]

    def test_admin_coordinates_are_not_re_geocoded_once_stored(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(
            db_session,
            test_user.id,
            coordinates="11.045331, 77.035606",
            formatted_address="Field address",
            admin_formatted_address="Admin address",
        )
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["address"] == "Field address"
        assert body["admin_address"] == "Admin address"
        assert fake_geocoder == []

    def test_geocoder_returning_nothing_reports_failure(
        self, client, user_token, test_user, db_session, monkeypatch
    ):
        import app.services.location_service as location_module

        monkeypatch.setattr(
            location_module.LocationService,
            "reverse_geocode",
            lambda self, latitude, longitude: None,
        )
        record = make_record(db_session, test_user.id)
        add_gps_image(db_session, record.id)

        body = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        ).json()
        assert body["resolved"] is False
        assert body["error"] is not None

    def test_other_user_cannot_resolve(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        other = User(
            email="otherowner@example.com",
            password_hash=hash_password("pass"),
            full_name="Other Owner",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        db_session.refresh(other)

        record = make_record(db_session, other.id)
        add_gps_image(db_session, record.id)

        response = client.post(
            f"/api/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403
        assert fake_geocoder == []

    def test_unauthenticated_rejected(self, client, db_session, test_user):
        record = make_record(db_session, test_user.id)
        response = client.post(f"/api/records/{record.id}/resolve-address")
        assert response.status_code == 401

    def test_missing_record_returns_404(self, client, user_token):
        response = client.post(
            "/api/records/999999/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 404


class TestAdminResolveAddressEndpoint:
    def test_admin_can_resolve_any_record(
        self, client, admin_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id)
        add_gps_image(db_session, record.id)

        response = client.post(
            f"/api/admin/records/{record.id}/resolve-address",
            headers=auth_header(admin_token),
        )
        assert response.status_code == 200
        assert response.json()["address"] == GEOCODED["formatted_address"]

    def test_non_admin_rejected(self, client, user_token, test_user, db_session):
        record = make_record(db_session, test_user.id)
        response = client.post(
            f"/api/admin/records/{record.id}/resolve-address",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403


ADMIN_TEXT = "100 Feet Road, Indiranagar, Bengaluru"


def complete_task(client, token, record_id, **overrides):
    """Submit the field inspection for a dispatched task, photo GPS included."""
    body = {
        "name": "Site Visit",
        "description": "",
        "task_id": record_id,
        "photos": [
            {
                "latitude": 11.0168,
                "longitude": 76.9558,
                "location_accuracy": 5.0,
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "file_name": "photo_1.jpg",
            }
        ],
    }
    body.update(overrides)
    return client.post("/api/records", headers=auth_header(token), json=body)


class TestTaskCompletionKeepsTheTwoAddressesDistinct:
    def test_onsite_capture_replaces_a_dispatch_address(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        """The field-inspection address describes the visit, not the dispatch sheet."""
        # Mirrors a task dispatched before the columns were split: the admin's
        # text had been copied into the field address. Completing the visit must
        # replace it with the on-site geocode and leave the admin data untouched.
        record = make_record(
            db_session, test_user.id, site_address=ADMIN_TEXT, formatted_address=ADMIN_TEXT
        )

        response = complete_task(client, user_token, record.id)

        assert response.status_code == 201
        body = response.json()
        assert body["formatted_address"] == GEOCODED["formatted_address"]
        assert body["site_address"] == ADMIN_TEXT

    def test_blank_owner_name_is_the_operators_to_fill(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id, owner_name_en=None)

        body = complete_task(client, user_token, record.id, owner_name_en="K. Rajasekar").json()

        assert body["owner_name_en"] == "K. Rajasekar"

    def test_admin_owner_name_wins_over_the_operators(
        self, client, user_token, test_user, db_session, fake_geocoder
    ):
        record = make_record(db_session, test_user.id, owner_name_en="Anand Sharma")

        body = complete_task(client, user_token, record.id, owner_name_en="Someone Else").json()

        assert body["owner_name_en"] == "Anand Sharma"
