"""Inspections completed WITHOUT photos must still record where and when.

The operator app allows finishing an inspection without taking photos. Those
records used to show "No photo captured" with empty field coordinates in the
admin panel because no GPS was stored anywhere. The device now sends a
standalone GPS fix (field_gps) which the record carries on its own columns.
"""

import pytest

from app.models.capture_record import CaptureRecord

from tests.conftest import auth_header


@pytest.fixture
def dispatched_task(db_session, test_user):
    """A pending task assigned to the field operator."""
    task = CaptureRecord(
        user_id=test_user.id,
        name="CBE-NO-PHOTO-1",
        unique_id="CBE-NO-PHOTO-1",
        coordinates="11.029122, 77.009085",
        street_address="51, Ganapathi",
        status="NOT_COMPLETED",
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return {"id": task.id, "name": task.name}


class TestNoPhotoInspectionCapture:
    def test_manual_record_mirrors_device_fix_into_coordinates(self, client, user_token):
        """A manually added record stands at the operator's position, so the
        device fix must populate the admin coordinates for map/route/directions."""
        response = client.post(
            "/api/records",
            json={
                "name": "Manual on-site capture",
                "description": "Added by the operator at the fence line",
                "photos": [],
                "field_gps": {
                    "latitude": 11.038977,
                    "longitude": 77.028311,
                    "location_accuracy": 6.0,
                    "captured_at": "2026-09-24T10:15:00Z",
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["coordinates"] == "11.038977, 77.028311"
        assert data["field_latitude"] == pytest.approx(11.038977)
        assert data["field_longitude"] == pytest.approx(77.028311)

    def test_manual_record_with_camera_photos_uses_photo_gps_coordinates(self, client, user_token):
        """Camera photos carry their own GPS; a manual record built from them
        gets its coordinates from the first photo's fix."""
        response = client.post(
            "/api/records",
            json={
                "name": "Manual capture with photos",
                "photos": [
                    {
                        "latitude": 11.001111,
                        "longitude": 77.002222,
                        "location_accuracy": 4.0,
                        "captured_at": "2026-09-24T10:20:00Z",
                        "file_name": "photo_1.jpg",
                    }
                ],
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["coordinates"] == "11.001111, 77.002222"
        assert data["unique_id"] == "CBE-110011-770022"

    def test_manual_record_gets_coordinate_unique_id(self, client, user_token):
        """Manually added records carry the platform CBE-… unique ID derived
        from where the operator stood, without anyone typing it."""
        response = client.post(
            "/api/records",
            json={
                "name": "Manual on-site capture",
                "photos": [],
                "field_gps": {
                    "latitude": 11.038977,
                    "longitude": 77.028311,
                    "location_accuracy": 6.0,
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        assert response.json()["unique_id"] == "CBE-110390-770283"

    def test_manual_record_unique_id_suffixes_on_same_spot(self, client, user_token):
        """Two manual records in the same ≈11 m cell must not share an ID."""
        payload = {
            "name": "Same spot twice",
            "photos": [],
            "field_gps": {"latitude": 11.0399, "longitude": 77.0299, "location_accuracy": 5.0},
        }
        headers = auth_header(user_token)
        first = client.post("/api/records", json=payload, headers=headers)
        assert first.status_code == 201, first.text
        second = client.post("/api/records", json={**payload, "name": "Same spot again"}, headers=headers)
        assert second.status_code == 201, second.text
        first_id, second_id = first.json()["unique_id"], second.json()["unique_id"]
        assert first_id != second_id
        assert second_id.startswith(first_id)  # CBE-110399-770299 → …-2

    def test_task_completion_keeps_dispatched_unique_id(self, client, user_token, dispatched_task):
        """Completing a dispatched task must never overwrite its sheet ID."""
        response = client.post(
            "/api/records",
            json={
                "name": dispatched_task["name"],
                "task_id": dispatched_task["id"],
                "photos": [],
                "field_gps": {"latitude": 11.0295, "longitude": 77.0093, "location_accuracy": 8.0},
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        assert response.json()["unique_id"] == "CBE-NO-PHOTO-1"

    def test_completion_without_photos_stores_gps_and_time(self, client, user_token, dispatched_task):
        response = client.post(
            "/api/records",
            json={
                "name": dispatched_task["name"],
                "task_id": dispatched_task["id"],
                "photos": [],
                "field_gps": {
                    "latitude": 11.0295,
                    "longitude": 77.0093,
                    "location_accuracy": 8.5,
                    "captured_at": "2026-09-24T09:30:00Z",
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "COMPLETED"
        assert data["field_latitude"] == pytest.approx(11.0295)
        assert data["field_longitude"] == pytest.approx(77.0093)
        assert data["field_captured_at"] == "2026-09-24T09:30:00Z"

    def test_no_photo_record_exposes_deviation_against_admin_coords(self, client, user_token, dispatched_task):
        """Field GPS far from the admin-given coordinates must surface a deviation."""
        response = client.post(
            "/api/records",
            json={
                "name": dispatched_task["name"],
                "task_id": dispatched_task["id"],
                "photos": [],
                "field_gps": {
                    "latitude": 12.971598,
                    "longitude": 77.594566,
                    "location_accuracy": 10,
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["deviation_meters"] is not None
        assert data["deviation_meters"] > 30
        assert data["deviation_status"] == "far"

    def test_photo_gps_is_never_overwritten_by_field_gps(self, client, user_token, dispatched_task):
        """A record with real photos keeps photo GPS authoritative."""
        response = client.post(
            "/api/records",
            json={
                "name": dispatched_task["name"],
                "task_id": dispatched_task["id"],
                "photos": [
                    {
                        "latitude": 11.0292,
                        "longitude": 77.0090,
                        "location_accuracy": 5,
                        "captured_at": "2026-09-24T09:00:00Z",
                        "file_name": "photo_1.jpg",
                    }
                ],
                "field_gps": {
                    "latitude": 12.971598,
                    "longitude": 77.594566,
                    "location_accuracy": 10,
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert len(data["images"]) == 1
        assert data["images"][0]["latitude"] == pytest.approx(11.0292)
        # The stale standalone fix must not clobber the photo capture position.
        assert data["field_latitude"] is None

    def test_new_record_without_photos_stores_fix(self, client, user_token):
        """A free-form inspection (no task) completed without photos also stores the fix."""
        response = client.post(
            "/api/records",
            json={
                "name": "Ad-hoc site visit",
                "photos": [],
                "field_gps": {
                    "latitude": 11.0291,
                    "longitude": 77.0090,
                    "location_accuracy": 6,
                    "captured_at": "2026-09-24T10:15:00Z",
                },
            },
            headers=auth_header(user_token),
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["field_latitude"] == pytest.approx(11.0291)
        assert data["field_captured_at"] == "2026-09-24T10:15:00Z"

    def test_admin_record_detail_carries_no_photo_fix(self, client, admin_token, user_token, dispatched_task):
        """The admin records endpoint exposes the same fields to the admin panel."""
        complete = client.post(
            "/api/records",
            json={
                "name": dispatched_task["name"],
                "task_id": dispatched_task["id"],
                "photos": [],
                "field_gps": {
                    "latitude": 11.0295,
                    "longitude": 77.0093,
                    "location_accuracy": 8.5,
                },
            },
            headers=auth_header(user_token),
        )
        assert complete.status_code == 201

        response = client.get(
            f"/api/admin/records/{dispatched_task['id']}",
            headers=auth_header(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["field_latitude"] == pytest.approx(11.0295)
        assert data["field_captured_at"] is not None
