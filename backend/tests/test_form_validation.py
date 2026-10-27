import pytest
from datetime import datetime, timezone, timedelta
from tests.conftest import auth_header


class TestRecordFormValidation:
    def test_record_name_whitespace_only_rejected(self, client, user_token):
        response = client.post(
            "/api/records",
            json={"name": "   ", "description": "", "photos": []},
            headers=auth_header(user_token),
        )
        assert response.status_code == 422

    def test_record_invalid_phone_rejected(self, client, user_token):
        response = client.post(
            "/api/records",
            json={
                "name": "Valid Name",
                "description": "",
                "photos": [],
                "contact_number": "12345",
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 422

    def test_record_valid_phone_normalized(self, client, user_token):
        response = client.post(
            "/api/records",
            json={
                "name": "Site Valid Phone",
                "description": "",
                "photos": [],
                "contact_number": "+91 98765 43210",
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["contact_number"] == "9876543210"

    def test_record_future_date_rejected(self, client, user_token):
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
        response = client.post(
            "/api/records",
            json={
                "name": "Future Site",
                "description": "",
                "photos": [],
                "date_of_visit": tomorrow,
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 422

    def test_record_invalid_construction_happening_rejected(self, client, user_token):
        response = client.post(
            "/api/records",
            json={
                "name": "Construction Check",
                "description": "",
                "photos": [],
                "construction_happening": "Maybe",
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 422


class TestUserValidation:
    def test_create_user_short_name_rejected(self, client, admin_token):
        response = client.post(
            "/api/admin/users",
            json={
                "email": "shortname@example.com",
                "full_name": "a",
                "role": "USER",
            },
            headers=auth_header(admin_token),
        )
        assert response.status_code == 422

    def test_create_user_invalid_email_rejected(self, client, admin_token):
        response = client.post(
            "/api/admin/users",
            json={
                "email": "invalid-email-address",
                "full_name": "Valid Name",
                "role": "USER",
            },
            headers=auth_header(admin_token),
        )
        assert response.status_code == 422

