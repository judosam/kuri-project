"""Tests for the live reverse-geocode endpoint behind the dashboard GNSS bar."""

import pytest

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


class TestReverseGeocodeLiveFix:
    def test_requires_authentication(self, client):
        response = client.get("/api/location/reverse-geocode?latitude=11.0&longitude=76.9")
        assert response.status_code == 401

    def test_resolves_place_from_live_fix(self, client, user_token, fake_geocoder):
        response = client.get(
            "/api/location/reverse-geocode?latitude=11.0168&longitude=76.9558",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["resolved"] is True
        assert body["place_name"] == GEOCODED["location_name"]
        assert body["address"] == GEOCODED["formatted_address"]
        assert fake_geocoder == [(11.0168, 76.9558)]

    def test_nearby_fix_reuses_the_cached_place(self, client, user_token, fake_geocoder):
        """A moving operator must not re-bill Google inside the cache radius."""
        for _ in range(3):
            response = client.get(
                "/api/location/reverse-geocode?latitude=11.0168&longitude=76.9558",
                headers=auth_header(user_token),
            )
            assert response.status_code == 200
            assert response.json()["resolved"] is True

        assert len(fake_geocoder) == 1

    def test_reports_unresolved_when_geocoding_is_unavailable(self, client, user_token, monkeypatch):
        """A Google outage or missing key degrades to resolved=False, never a 500."""
        import app.services.location_service as location_module

        monkeypatch.setattr(
            location_module.LocationService, "reverse_geocode", lambda self, lat, lng: None
        )

        response = client.get(
            "/api/location/reverse-geocode?latitude=11.0168&longitude=76.9558",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        assert response.json()["resolved"] is False

    def test_rejects_out_of_range_coordinates(self, client, user_token):
        response = client.get(
            "/api/location/reverse-geocode?latitude=195&longitude=76.9558",
            headers=auth_header(user_token),
        )
        assert response.status_code == 422
