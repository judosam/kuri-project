import pytest

from tests.conftest import auth_header


class TestRecordCreation:
    def test_create_record(self, client, user_token):
        response = client.post(
            "/api/records",
            json={
                "name": "Test Record",
                "description": "A test capture record",
                "photos": [],
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Test Record"
        assert data["description"] == "A test capture record"
        assert "id" in data

    def test_create_record_unauthenticated(self, client):
        response = client.post(
            "/api/records",
            json={"name": "Test", "description": "", "photos": []},
        )
        assert response.status_code == 401


class TestRecordList:
    def test_list_records(self, client, user_token):
        # Create a record first
        client.post(
            "/api/records",
            json={"name": "Record 1", "description": "", "photos": []},
            headers=auth_header(user_token),
        )

        response = client.get(
            "/api/records",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        assert len(data["records"]) >= 1

    def test_list_records_pagination(self, client, user_token):
        headers = auth_header(user_token)
        for i in range(5):
            client.post(
                "/api/records",
                json={"name": f"Record {i}", "description": "", "photos": []},
                headers=headers,
            )

        response = client.get(
            "/api/records?page=1&page_size=2",
            headers=headers,
        )
        data = response.json()
        assert data["total"] == 5
        assert len(data["records"]) == 2


class TestRecordAccess:
    def test_user_can_get_own_record(self, client, user_token):
        create_resp = client.post(
            "/api/records",
            json={"name": "My Record", "description": "", "photos": []},
            headers=auth_header(user_token),
        )
        record_id = create_resp.json()["id"]

        response = client.get(
            f"/api/records/{record_id}",
            headers=auth_header(user_token),
        )
        assert response.status_code == 200
        assert response.json()["name"] == "My Record"

    def test_user_cannot_get_other_users_record(
        self, client, user_token, db_session
    ):
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from app.models.capture_record import CaptureRecord

        # Create another user and their record
        other = User(
            email="other@example.com",
            password_hash=hash_password("pass"),
            full_name="Other",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        db_session.refresh(other)

        record = CaptureRecord(
            user_id=other.id, name="Other Record", description=""
        )
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        # Try to access from first user
        response = client.get(
            f"/api/records/{record.id}",
            headers=auth_header(user_token),
        )
        assert response.status_code == 403

    def test_admin_can_get_any_record(
        self, client, user_token, admin_token, db_session
    ):
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        from app.models.capture_record import CaptureRecord

        # Create user and record
        user = User(
            email="recordowner@example.com",
            password_hash=hash_password("pass"),
            full_name="Owner",
            role=UserRole.USER,
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        record = CaptureRecord(
            user_id=user.id, name="User Record", description=""
        )
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        # Admin should be able to access
        response = client.get(
            f"/api/records/{record.id}",
            headers=auth_header(admin_token),
        )
        assert response.status_code == 200
