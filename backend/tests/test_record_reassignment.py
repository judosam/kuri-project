from datetime import datetime, timedelta, timezone
import io

import openpyxl
import pytest
from sqlalchemy import inspect, text

from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User, UserRole
from app.repositories.record_repository import local_day_bounds


def test_legacy_assignment_date_migration_is_repeatable(db_engine, db_session, test_user, monkeypatch):
    import app.database.connection as connection
    record = CaptureRecord(user_id=test_user.id, name='Legacy task', created_at=datetime(2026, 9, 1, 8))
    db_session.add(record)
    db_session.commit()
    record_id = record.id
    db_session.close()
    with db_engine.begin() as conn:
        conn.execute(text('DROP INDEX ix_capture_records_assigned_at'))
        conn.execute(text('ALTER TABLE capture_records DROP COLUMN assigned_at'))
    monkeypatch.setattr(connection, 'engine', db_engine)
    connection.create_tables()
    assert 'assigned_at' in {col['name'] for col in inspect(db_engine).get_columns('capture_records')}
    with db_engine.begin() as conn:
        original = conn.execute(text('SELECT assigned_at, created_at FROM capture_records WHERE id=:id'), {'id': record_id}).one()
        assert original.assigned_at == original.created_at
        conn.execute(text("UPDATE capture_records SET assigned_at='2026-09-24 01:00:00' WHERE id=:id"), {'id': record_id})
    connection.create_tables()
    with db_engine.connect() as conn:
        assert conn.execute(text('SELECT assigned_at FROM capture_records WHERE id=:id'), {'id': record_id}).scalar() == '2026-09-24 01:00:00'


def headers(token):
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def second_operator(db_session, test_user):
    user = User(email='other@example.com', full_name='Another Operator',
                password_hash=test_user.password_hash, role=UserRole.USER, is_active=True)
    db_session.add(user)
    db_session.commit()
    return user


def test_reassign_only_pending_and_transfer_access(client, admin_token, user_token,
                                                  test_user, second_operator, db_session):
    old_date = datetime(2026, 1, 1)
    pending = CaptureRecord(user_id=test_user.id, name='Pending', assigned_at=old_date)
    completed = CaptureRecord(user_id=test_user.id, name='Completed', status='COMPLETED', assigned_at=old_date)
    db_session.add_all([pending, completed])
    db_session.commit()
    ids = [pending.id, completed.id, pending.id]
    payload = {'record_ids': ids, 'target_user_id': second_operator.id}
    url = '/api/admin/records/reassign'
    assert client.post(url, json=payload).status_code == 401
    assert client.post(url, json=payload, headers=headers(user_token)).status_code == 403
    response = client.post(url, json=payload, headers=headers(admin_token))
    assert response.status_code == 200, response.text
    assert response.json()['reassigned_count'] == 1
    assert response.json()['skipped_completed_count'] == 1
    db_session.expire_all()
    assert pending.user_id == second_operator.id
    assert pending.assigned_at > old_date
    assert completed.user_id == test_user.id
    assert completed.assigned_at == old_date
    assigned_at = pending.assigned_at
    # Repeating the same request neither moves completed records nor resets the date.
    repeat = client.post(url, json=payload, headers=headers(admin_token))
    assert repeat.json()['reassigned_count'] == 0
    db_session.expire_all()
    assert pending.assigned_at == assigned_at
    assert client.get(f'/api/records/{pending.id}', headers=headers(user_token)).status_code == 403
    token = client.post('/api/auth/login', json={'email': second_operator.email, 'password': 'testpass123'}).json()['access_token']
    detail = client.get(f'/api/records/{pending.id}', headers=headers(token))
    assert detail.status_code == 200
    assert detail.json()['assigned_at'].endswith('Z')
    listing = client.get('/api/records', headers=headers(user_token)).json()
    assert [r['id'] for r in listing['records']] == [completed.id]


def test_invalid_reassignments_do_not_change_owner(client, admin_token, test_admin, test_user, second_operator, db_session):
    record = CaptureRecord(user_id=test_user.id, name='Keep assignment')
    db_session.add(record)
    db_session.commit()
    url = '/api/admin/records/reassign'
    def post(ids, target):
        return client.post(url, json={'record_ids': ids, 'target_user_id': target}, headers=headers(admin_token))
    assert post([record.id, 99999], second_operator.id).status_code == 409
    assert post([record.id], test_admin.id).status_code == 400
    assert post([], second_operator.id).status_code == 422
    assert post([record.id], 99999).status_code == 404
    second_operator.is_active = False
    db_session.commit()
    assert post([record.id], second_operator.id).status_code == 400
    db_session.expire_all()
    assert record.user_id == test_user.id


def test_today_dates_stats_sorting_and_filtered_export(client, admin_token, test_user, db_session):
    start, end = local_day_bounds()
    today_local = (start + timedelta(hours=5, minutes=30)).date().isoformat()
    before = start - timedelta(seconds=1)
    old = start - timedelta(days=2)
    records = [
        CaptureRecord(user_id=test_user.id, name='Site C', unique_id='C', created_at=old, assigned_at=old,
                      status='COMPLETED', date_of_visit=today_local),
        CaptureRecord(user_id=test_user.id, name='Site B', unique_id='B', created_at=old, assigned_at=start,
                      status='COMPLETED'),
        CaptureRecord(user_id=test_user.id, name='Site A', unique_id='A', created_at=start, assigned_at=start),
        CaptureRecord(user_id=test_user.id, name='Site D', unique_id='D', created_at=before, assigned_at=before,
                      status='COMPLETED'),
    ]
    db_session.add_all(records)
    db_session.commit()
    for record, captured in [(records[1], start), (records[3], before)]:
        db_session.add(CapturedImage(record_id=record.id, google_drive_file_id='simulated-test-photo',
            file_name='test.jpg', photo_order=1, latitude=0, longitude=0, location_accuracy=0, captured_at=captured))
    db_session.commit()
    auth = headers(admin_token)
    params = {'date_from': start.isoformat(), 'date_to': (end - timedelta(milliseconds=1)).isoformat()}
    expected = {'created_at': [records[2].id], 'assigned_at': [records[1].id, records[2].id],
                'captured_at': [records[1].id], 'completed_at': [records[0].id, records[1].id]}
    for basis, ids in expected.items():
        response = client.get('/api/admin/records', params={**params, 'date_field': basis}, headers=auth)
        assert response.status_code == 200, response.text
        assert {r['id'] for r in response.json()['records']} == set(ids)
    for direction, expected_ids in [('asc', [records[2].id, records[1].id]), ('desc', [records[3].id, records[0].id])]:
        found = []
        for page in (1, 2):
            res = client.get('/api/admin/records', params={'sort_by': 'unique_id', 'sort_order': direction,
                'page_size': 1, 'page': page, 'search': 'Site'}, headers=auth)
            assert res.status_code == 200, res.text
            found.append(res.json()['records'][0]['id'])
        assert found == expected_ids
    # Exercise correlated expressions with a search join and pagination.
    for field in ('user_name', 'photo_count', 'captured_at', 'assigned_at', 'street_address', 'coordinates',
                  # Field Verification table columns (Records list)
                  'date_of_visit', 'relationship_with_building', 'building_user_name', 'contact_number',
                  'site_contractor_architect_name', 'site_contractor_architect_number', 'remarks'):
        assert client.get('/api/admin/records', params={'sort_by': field, 'search': 'Site', 'page_size': 1}, headers=auth).status_code == 200
    dashboard = client.get('/api/admin/dashboard', headers=auth)
    assert dashboard.status_code == 200, dashboard.text
    data = dashboard.json()
    assert data['today_records'] == 1
    assert data['today_completed_records'] == 2
    assert data['pending_records'] == 1
    assert data['total_completed_records'] == 3
    assert data['completion_rate'] == 75
    assert data['total_photos'] == 2
    operator = next(u for u in data['inspector_stats'] if u['user_id'] == test_user.id)
    assert operator['today_completed'] == 2
    export = client.get('/api/admin/records/export', params={**params, 'date_field': 'completed_at'}, headers=auth)
    assert export.status_code == 200, export.text
    sheet = openpyxl.load_workbook(io.BytesIO(export.content))['Inspections Report']
    assert sheet.max_row == 3
