import pytest
from app.models.activity_log import ActivityLog
from app.models.capture_record import CaptureRecord
from app.models.login_session import LoginSession
from app.models.user import User, UserRole
from tests.conftest import auth_header


def test_delete_user_revokes_access_and_retains_audit_history(client, admin_token, user_token, test_user, db_session):
    uid = test_user.id
    log = ActivityLog(action_type='LOGIN', type='auth', title='Signed in', user_id=uid, user_name=test_user.full_name)
    db_session.add(log)
    db_session.commit()
    log_id = log.id
    response = client.delete(f'/api/admin/users/{uid}', headers=auth_header(admin_token))
    assert response.status_code == 204, response.text
    db_session.expire_all()
    assert db_session.get(User, uid) is None
    assert db_session.query(LoginSession).filter_by(user_id=uid).count() == 0
    assert db_session.get(ActivityLog, log_id).user_id is None
    assert db_session.get(ActivityLog, log_id).user_name == 'Test User'
    assert db_session.query(ActivityLog).filter_by(action_type='USER_DELETED').count() == 1
    assert client.get('/api/auth/me', headers=auth_header(user_token)).status_code == 401
    assert client.delete(f'/api/admin/users/{uid}', headers=auth_header(admin_token)).status_code == 404


@pytest.mark.parametrize('record_status', ['NOT_COMPLETED', 'COMPLETED'])
def test_cannot_delete_user_with_records(client, admin_token, user_token, test_user, db_session, record_status):
    record = CaptureRecord(user_id=test_user.id, name='Preserved inspection', status=record_status)
    db_session.add(record)
    db_session.commit()
    rid, uid = record.id, test_user.id
    response = client.delete(f'/api/admin/users/{uid}', headers=auth_header(admin_token))
    assert response.status_code == 409
    db_session.expire_all()
    assert db_session.get(CaptureRecord, rid).user_id == uid
    assert db_session.get(User, uid) is not None
    assert client.get('/api/auth/me', headers=auth_header(user_token)).status_code == 200


def test_delete_requires_admin_and_prevents_self_deletion(client, admin_token, user_token, test_admin, test_user, db_session):
    assert client.delete(f'/api/admin/users/{test_user.id}', headers=auth_header(user_token)).status_code == 403
    assert client.delete(f'/api/admin/users/{test_admin.id}', headers=auth_header(admin_token)).status_code == 400
    test_user.role = UserRole.MANAGER
    db_session.commit()
    assert client.delete(f'/api/admin/users/{test_admin.id}', headers=auth_header(user_token)).status_code == 403
