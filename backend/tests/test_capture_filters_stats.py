import io
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

from PIL import Image
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.repositories.record_repository import local_day_bounds
from tests.conftest import auth_header


def test_capture_filters_counts_status_and_user_isolation(client, admin_token, user_token, test_user, db_session):
    start, end = local_day_bounds()
    other = User(email='another@example.com', full_name='Other', password_hash=test_user.password_hash, role=UserRole.USER)
    db_session.add(other)
    db_session.commit()
    records = [
        CaptureRecord(user_id=test_user.id, name='Today upload', status='COMPLETED', created_at=start-timedelta(days=8),
                      field_captured_at=start, construction_happening=' Yes ', contact_number='+91 98765 43210', site_contractor_architect_number='9876543210'),
        CaptureRecord(user_id=test_user.id, name='Yesterday visit', status='COMPLETED', created_at=start,
                      field_captured_at=start-timedelta(seconds=1), construction_happening='No', contact_number='8765432109'),
        CaptureRecord(user_id=test_user.id, name='Not visited', status='NOT_COMPLETED', contact_number='-', assigned_at=start, created_at=start-timedelta(days=8)),
        CaptureRecord(user_id=other.id, name='Other capture', status='COMPLETED', field_captured_at=start,
                      construction_happening='Yes', contact_number='7654321098'),
    ]
    db_session.add_all(records)
    db_session.commit()
    dates = {'date_from': start.isoformat(), 'date_to': (end-timedelta(milliseconds=1)).isoformat()}
    field = client.get('/api/records/dashboard', params=dates, headers=auth_header(user_token))
    assert field.status_code == 200, field.text
    assert field.json()['total_records'] == 1
    assert field.json()['construction_yes_records'] == 1
    assert field.json()['mobile_numbers_collected'] == 1
    assert field.json()['pending_records'] == 0
    assert len(field.json()['daily_activity']) == 1
    assert field.json()['daily_activity'][0]['completed'] == 1
    assert field.json()['daily_activity'][0]['construction_yes'] == 1
    admin = client.get('/api/admin/dashboard', params=dates, headers=auth_header(admin_token)).json()
    assert admin['total_records'] == 2
    assert admin['construction_yes_records'] == 2
    assert admin['mobile_numbers_collected'] == 2
    assert admin['daily_activity'][0]['completed'] == 2
    operator = next(o for o in admin['inspector_stats'] if o['user_id'] == test_user.id)
    assert operator['total_assigned'] == 1
    listed = client.get('/api/records', params={**dates, 'date_field': 'captured_at', 'user_id': other.id}, headers=auth_header(user_token)).json()
    assert [r['id'] for r in listed['records']] == [records[0].id]
    yesterday = {'date_from': (start-timedelta(days=1)).isoformat(), 'date_to': (start-timedelta(milliseconds=1)).isoformat()}
    assert client.get('/api/records/dashboard', params=yesterday, headers=auth_header(user_token)).json()['mobile_numbers_collected'] == 1
    pending = client.get('/api/admin/dashboard', params={'status': 'NOT_COMPLETED'}, headers=auth_header(admin_token)).json()
    assert pending['total_records'] == 1 and pending['total_completed_records'] == 0
    assert len(pending['daily_activity']) == 7
    assert sum(day['pending'] for day in pending['daily_activity']) == 1
    for path, token in [('/api/admin', admin_token), ('/api/records', user_token)]:
        endpoint = f'{path}/dashboard'
        filtered = client.get(endpoint, params={**dates, 'status': 'NOT_COMPLETED'}, headers=auth_header(token)).json()
        assert filtered['total_records'] == 1
        assert filtered['daily_activity'][0]['pending'] == 1
        assert client.get(endpoint, params={**yesterday, 'status': 'NOT_COMPLETED'}, headers=auth_header(token)).json()['total_records'] == 0
    for prefix, token in [('/api/admin/records', admin_token), ('/api/records', user_token)]:
        result = client.get(prefix, params={**dates, 'status': 'NOT_COMPLETED', 'date_field': 'assigned_at'}, headers=auth_header(token)).json()
        assert [row['id'] for row in result['records']] == [records[2].id]
        completed = client.get(prefix, params={**dates, 'status': 'COMPLETED', 'date_field': 'captured_at'}, headers=auth_header(token)).json()
        assert records[0].id in [row['id'] for row in completed['records']]
        assert records[1].id not in [row['id'] for row in completed['records']]


def test_uploaded_photo_preserves_inspection_gps_and_address(client, user_token, admin_token, monkeypatch, db_session):
    import app.routers.records as routes
    monkeypatch.setattr(routes, 'get_location_cache_service', lambda: SimpleNamespace(resolve=lambda *a, **k:
        SimpleNamespace(location_name='Inspection site', formatted_address='23 Field Street', place_id='test-place')))
    created = client.post('/api/records', headers=auth_header(user_token), json={
        'name': 'Uploaded inspection', 'field_gps': {'latitude': 11.03, 'longitude': 77.01,
            'location_accuracy': 8, 'captured_at': '2026-09-24T05:00:00Z'},
        'photos': [{'latitude': 0, 'longitude': 0, 'location_accuracy': 0, 'captured_at': '2026-09-24T05:00:00Z', 'file_name': 'photo_1.jpg'}],
    })
    assert created.status_code == 201, created.text
    data = created.json()
    stream = io.BytesIO()
    Image.new('RGB', (200, 160), 'white').save(stream, 'JPEG')
    uploaded = client.post(f"/api/records/{data['id']}/upload", headers=auth_header(user_token),
        files=[('files', ('photo_1.jpg', stream.getvalue(), 'image/jpeg'))], data={'sources': 'uploaded'})
    assert uploaded.status_code == 200, uploaded.text
    for prefix, token in [('/api/records', user_token), ('/api/admin/records', admin_token)]:
        detail = client.get(f"{prefix}/{data['id']}", headers=auth_header(token)).json()
        assert detail['formatted_address'] == '23 Field Street'
        assert detail['field_latitude'] == 11.03 and detail['field_longitude'] == 77.01
        assert detail['images'][0]['source'] == 'uploaded'
        assert detail['images'][0]['latitude'] == 0
    import app.services.location_cache_service as cache
    monkeypatch.setattr(cache, 'get_location_cache_service', routes.get_location_cache_service)
    record = db_session.get(CaptureRecord, data['id'])
    record.formatted_address = None
    db_session.commit()
    resolved = client.post(f"/api/records/{data['id']}/resolve-address", headers=auth_header(user_token))
    assert resolved.status_code == 200
    assert resolved.json()['address'] == '23 Field Street'


def test_single_env_location_independent_of_working_directory(monkeypatch, tmp_path):
    from app.core.config import ENV_FILE, Settings
    root = Path(__file__).resolve().parents[2]
    assert ENV_FILE == root / '.env'
    for extra in ('backend/.env', 'admin/.env', 'admin/.env.production'):
        assert not (root / extra).exists()
    monkeypatch.chdir(tmp_path)
    # No values or secrets are printed. Environment overrides still win.
    monkeypatch.setenv('ADMIN_NAME', 'Test override')
    assert Settings().ADMIN_NAME == 'Test override'
