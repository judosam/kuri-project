from datetime import datetime, timezone

from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User, UserRole
from app.services.local_storage_service import LocalStorageService
from tests.conftest import auth_header


def test_manager_can_view_and_assign_but_not_modify_records_or_users(client, admin_token, test_user, db_session):
    created = client.post('/api/admin/users', headers=auth_header(admin_token), json={
        'email': 'manager@example.com', 'full_name': 'Field Manager', 'role': 'MANAGER', 'password': 'ManagerPass123!',
    })
    assert created.status_code == 201, created.text
    assert created.json()['role'] == 'MANAGER'
    login = client.post('/api/auth/login', json={'email': 'manager@example.com', 'password': 'ManagerPass123!'})
    assert login.status_code == 200
    manager_headers = auth_header(login.json()['access_token'])
    assert client.get('/api/auth/me', headers=manager_headers).json()['role'] == 'MANAGER'
    target = User(email='next@example.com', full_name='Next Operator', role=UserRole.USER,
                  password_hash=test_user.password_hash, is_active=True)
    pending = CaptureRecord(user_id=test_user.id, name='Pending inspection')
    completed = CaptureRecord(user_id=test_user.id, name='Completed inspection', status='COMPLETED')
    db_session.add_all([target, pending, completed])
    db_session.commit()
    key = LocalStorageService().save_file(b'test-image', 'manager-test.jpg', 'manager-test')
    photo = CapturedImage(record_id=completed.id, google_drive_file_id=key, file_name='manager-test.jpg',
                          latitude=0, longitude=0, location_accuracy=0, captured_at=datetime.now(timezone.utc), photo_order=1)
    db_session.add(photo)
    db_session.commit()
    listing = client.get('/api/admin/records', headers=manager_headers)
    assert listing.status_code == 200
    assert listing.json()['total'] == 2
    detail = client.get(f'/api/admin/records/{completed.id}', headers=manager_headers)
    assert detail.status_code == 200
    assert client.get(f'/api/admin/records/{completed.id}/images', headers=manager_headers).status_code == 200
    image = client.get(f'/api/admin/records/{completed.id}/image/{photo.id}', headers=manager_headers)
    assert image.status_code == 200
    assert image.content == b'test-image'
    operators = client.get('/api/admin/assignment-operators', headers=manager_headers)
    assert operators.status_code == 200
    operator_ids = {u['id'] for u in operators.json()}
    # The seeded FIELD_VERIFIER QA account is listed alongside the two field
    # operators here, so assert inclusion plus assignable roles instead of an
    # exact id set.
    assert {test_user.id, target.id} <= operator_ids
    assert {u['role'] for u in operators.json()} <= {'USER', 'FIELD_VERIFIER'}
    assert all('password_hash' not in u and 'last_login_at' not in u for u in operators.json())
    reassigned = client.post('/api/admin/records/reassign', headers=manager_headers, json={
        'record_ids': [pending.id, completed.id], 'target_user_id': target.id,
    })
    assert reassigned.status_code == 200
    assert reassigned.json()['reassigned_count'] == 1
    assert reassigned.json()['skipped_completed_count'] == 1
    db_session.expire_all()
    assert pending.user_id == target.id
    assert completed.user_id == test_user.id

    # Test server authorization independently of hidden UI actions.
    blocked = [
        ('GET', '/api/admin/dashboard', {}), ('GET', '/api/admin/users', {}),
        ('GET', f'/api/admin/users/{test_user.id}', {}), ('GET', '/api/admin/logs', {}),
        # /api/admin/locations is intentionally NOT blocked: the map is shared
        # with managers (and, under the audit workflow, importers/auditors).
        ('GET', '/api/admin/records/export', {}),
        ('GET', f'/api/admin/records/{pending.id}/export', {}),
        ('POST', '/api/admin/users', {'json': {'email': 'blocked@example.com', 'full_name': 'Blocked', 'role': 'ADMIN'}}),
        ('PUT', f'/api/admin/users/{test_user.id}', {'json': {'role': 'ADMIN'}}),
        ('POST', f'/api/admin/users/{test_user.id}/deactivate', {}),
        ('POST', f'/api/admin/users/{test_user.id}/reset-password', {}),
        ('PUT', f'/api/admin/records/{pending.id}', {'json': {'name': 'Changed'}}),
        ('DELETE', f'/api/admin/records/{pending.id}', {}),
        ('POST', f'/api/admin/records/{pending.id}/resolve-address', {}),
        ('POST', f'/api/admin/records/{pending.id}/photos', {'files': {'files': ('photo.jpg', b'image', 'image/jpeg')}}),
        ('POST', '/api/admin/records/upload-sheet', {'files': {'file': ('import.xlsx', b'x', 'application/octet-stream')}}),
        ('POST', '/api/admin/records/import-previous/commit', {'files': {'file': ('import.xlsx', b'x', 'application/octet-stream')}}),
        ('POST', '/api/records', {'json': {'name': 'Unauthorized field capture'}}),
        ('POST', f'/api/records/{pending.id}/upload', {'files': {'files': ('photo.jpg', b'image', 'image/jpeg')}}),
    ]
    for method, path, options in blocked:
        response = client.request(method, path, headers=manager_headers, **options)
        assert response.status_code == 403, (method, path, response.status_code, response.text)
    db_session.expire_all()
    assert pending.name == 'Pending inspection'
    assert test_user.role == UserRole.USER
    manager = db_session.get(User, created.json()['id'])
    manager.is_active = False
    db_session.commit()
    assert client.get('/api/admin/records', headers=manager_headers).status_code == 403
    assert client.post('/api/admin/records/reassign', headers=manager_headers, json={
        'record_ids': [pending.id], 'target_user_id': test_user.id,
    }).status_code == 403


def test_role_changes_take_effect_for_existing_sessions(client, admin_token, test_user, db_session):
    login = client.post('/api/auth/login', json={'email': test_user.email, 'password': 'testpass123'})
    user_headers = auth_header(login.json()['access_token'])
    assert client.get('/api/admin/records', headers=user_headers).status_code == 403
    changed = client.put(f'/api/admin/users/{test_user.id}', headers=auth_header(admin_token), json={'role': 'MANAGER'})
    assert changed.status_code == 200
    assert client.get('/api/admin/records', headers=user_headers).status_code == 200
    assert client.post('/api/records', headers=user_headers, json={'name': 'Blocked'}).status_code == 403
    assert client.put(f'/api/admin/users/{test_user.id}', headers=auth_header(admin_token), json={'role': 'USER'}).status_code == 200
    assert client.get('/api/admin/records', headers=user_headers).status_code == 403
