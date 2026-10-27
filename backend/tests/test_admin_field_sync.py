from datetime import datetime, timezone

from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage


def test_admin_edit_visible_to_operator_without_rewriting_capture_time(
    client, admin_token, user_token, test_user, db_session,
):
    # Reproduce a task created yesterday and photographed during today's visit.
    record = CaptureRecord(
        user_id=test_user.id, name='Dispatched inspection', status='COMPLETED',
        created_at=datetime(2026, 9, 23, 7, 22, tzinfo=timezone.utc),
        date_of_visit='2026-09-24', stage_of_construction='Foundation Work (Piling)',
    )
    db_session.add(record)
    db_session.commit()
    db_session.add(CapturedImage(
        record_id=record.id, google_drive_file_id='pending:sync-test', file_name='photo.jpg',
        photo_order=1, latitude=0, longitude=0, location_accuracy=0,
        captured_at=datetime(2026, 9, 24, 4, 52, 29, tzinfo=timezone.utc),
    ))
    db_session.commit()
    response = client.put(f'/api/admin/records/{record.id}',
        headers={'Authorization': f'Bearer {admin_token}'},
        json={'stage_of_construction': 'Additional Floor Construction', 'remarks': 'Updated by admin'},
    )
    assert response.status_code == 200
    field = client.get(f'/api/records/{record.id}', headers={'Authorization': f'Bearer {user_token}'})
    assert field.status_code == 200
    admin_data, field_data = response.json(), field.json()
    for key in ('status', 'stage_of_construction', 'remarks', 'created_at', 'date_of_visit'):
        assert admin_data[key] == field_data[key]
    # Photo URLs are deliberately role-specific; stored photo metadata must match.
    for key in ('id', 'photo_order', 'captured_at', 'created_at', 'source'):
        assert admin_data['images'][0][key] == field_data['images'][0][key]
    assert field_data['stage_of_construction'] == 'Additional Floor Construction'
    assert field_data['created_at'].startswith('2026-09-23T07:22:00')
    assert field_data['images'][0]['captured_at'] == '2026-09-24T04:52:29Z'
    listing = client.get('/api/records?status=COMPLETED', headers={'Authorization': f'Bearer {user_token}'}).json()
    assert listing['records'][0]['remarks'] == 'Updated by admin'
