"""Assignment filters stay consistent across lists, facets, totals and exports."""
import io
import openpyxl
import pytest
from app.models.capture_record import CaptureRecord
from tests.conftest import auth_header
from tests.test_audit_gateway import auditor, auditor_token


@pytest.mark.parametrize('choice,expected', [
    ('unassigned_user', {2, 4, 6}),
    ('unassigned_auditor', {3, 4, 6}),
    ('both_unassigned', {4, 6}),
    ('auditor', {1, 2}),
    ('verifier', {1, 3}),
    ('unassigned_qa_done', {6}),
    ('contradictory', set()),
])
def test_assignment_filter_consistency(client, db_session, admin_token, auditor, test_user, test_admin, choice, expected):
    assignments = [(auditor.id, test_user.id), (auditor.id, None), (None, test_user.id),
                   (None, None), (test_admin.id, test_admin.id), (None, None)]
    ids = {}
    for index, (qa_id, user_id) in enumerate(assignments, 1):
        record = CaptureRecord(name=f'Assignment {index}', village=f'Village {index}',
                               assigned_auditor_id=qa_id, user_id=user_id, audit_status='PENDING')
        if index == 6:
            # A past QC author is history, not a current auditor assignment.
            record.qc_by_id = auditor.id
            record.qc_vhr_comment = 'Confirmed construction'
        db_session.add(record)
        db_session.flush()
        ids[index] = record.id
    db_session.commit()
    params = {
        'unassigned_user': {'unassigned_user': True},
        'unassigned_auditor': {'unassigned_auditor': True},
        'both_unassigned': {'unassigned_user': True, 'unassigned_auditor': True},
        'auditor': {'assigned_auditor_id': auditor.id},
        'verifier': {'user_id': test_user.id},
        'unassigned_qa_done': {'unassigned_auditor': True, 'qc_status': 'DONE'},
        'contradictory': {'user_id': test_user.id, 'unassigned_user': True},
    }[choice]
    headers = auth_header(admin_token)
    observed = set()
    for page in range(1, len(expected) + 2):
        response = client.get('/api/admin/records', params={**params, 'page': page, 'page_size': 1}, headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['total'] == len(expected)
        observed.update(item['id'] for item in data['records'])
    assert observed == {ids[index] for index in expected}
    summary = client.get('/api/admin/qa-dashboard', params=params, headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()['total'] == len(expected)
    assert summary.json()['done'] + summary.json()['pending'] == len(expected)
    facets = client.get('/api/admin/records/filter-options', params={**params, 'field': 'village'}, headers=headers)
    assert facets.status_code == 200, facets.text
    assert {item['value'] for item in facets.json()['options']} == {f'Village {index}' for index in expected}
    export = client.get('/api/admin/records/export', params=params, headers=headers)
    assert export.status_code == 200, export.text
    assert openpyxl.load_workbook(io.BytesIO(export.content)).active.max_row == len(expected) + 1


def test_qa_unassigned_filter_preserves_admin_only_export(client, db_session, auditor_token):
    db_session.add(CaptureRecord(name='Unassigned', user_id=None, assigned_auditor_id=None))
    db_session.commit()
    headers = auth_header(auditor_token)
    params = {'unassigned_auditor': True}
    response = client.get('/api/admin/records', params=params, headers=headers)
    assert response.status_code == 200 and response.json()['total'] == 1
    assert client.get('/api/admin/records/export', params=params, headers=headers).status_code == 403


@pytest.mark.parametrize('path', ['/api/admin/records', '/api/admin/records/export', '/api/admin/records/filter-options?field=village', '/api/admin/qa-dashboard'])
def test_invalid_auditor_filter_rejected(client, admin_token, path):
    assert client.get(path, params={'assigned_auditor_id': -1}, headers=auth_header(admin_token)).status_code == 422
