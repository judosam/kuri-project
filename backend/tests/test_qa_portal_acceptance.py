"""Acceptance coverage for independent QC review and shared record filters."""
import io
import json
from datetime import datetime, timezone
import openpyxl
import pytest
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from tests.conftest import auth_header
from tests.test_audit_gateway import auditor, auditor_token, manager, manager_token


def row(db, **values):
    record = CaptureRecord(name='QA acceptance', user_id=None, audit_status='PENDING', **values)
    db.add(record); db.commit(); db.refresh(record)
    return record


def test_qc_independence_immutable_completion_and_admin_metadata(client, db_session, auditor, auditor_token, admin_token):
    r = row(db_session, assigned_auditor_id=auditor.id)
    path = f'/api/admin/records/{r.id}'
    saved = client.patch(path+'/qc', json={'qc_vhr_comment':'Confirmed construction','qc_street_details':' Road view '}, headers=auth_header(auditor_token))
    assert saved.status_code == 200, saved.text
    d = saved.json()
    assert d['audit_status']=='PENDING' and d['user_id'] is None and d['audited_at'] is None
    assert d['qc_by_name']==auditor.full_name and d['qc_street_details']=='Road view'
    first = d['qc_completed_at']
    edited = client.patch(path+'/qc',json={'qc_vhr_comment':'Cleared site'},headers=auth_header(auditor_token)).json()
    assert edited['qc_completed_at']==first and edited['qc_edited_at']
    decided = client.patch(path+'/audit',json={'audit_status':'APPROVAL'},headers=auth_header(admin_token)).json()
    assert decided['qc_completed_at']==first and decided['qc_edited_at']==edited['qc_edited_at']
    assert decided['assigned_auditor_id']==auditor.id and decided['qc_by_name']==auditor.full_name
    assert decided['audit_status']=='APPROVAL'


@pytest.mark.parametrize('status',['PENDING','APPROVAL','DISAPPROVAL','COMMERCIAL_PROPERTY'])
def test_qa_final_decisions_are_forbidden(client,db_session,auditor_token,status):
    r=row(db_session); h=auth_header(auditor_token)
    assert client.patch(f'/api/admin/records/{r.id}/audit',json={'audit_status':status},headers=h).status_code==403
    assert client.post('/api/admin/records/bulk-audit',json={'record_ids':[r.id],'audit_status':status},headers=h).status_code==403


@pytest.mark.parametrize('payload',[{'qc_vhr_comment':''},{'qc_vhr_comment':'   '},{'qc_vhr_comment':'Done','audit_status':'APPROVAL'}])
def test_qc_invalid_or_admin_fields_rejected(client,db_session,auditor_token,payload):
    r=row(db_session)
    assert client.patch(f'/api/admin/records/{r.id}/qc',json=payload,headers=auth_header(auditor_token)).status_code==422


@pytest.mark.parametrize('token_name',['user_token','manager_token'])
def test_non_qa_cannot_save_qc_or_read_dashboard(client,db_session,request,token_name):
    h=auth_header(request.getfixturevalue(token_name)); r=row(db_session)
    assert client.patch(f'/api/admin/records/{r.id}/qc',json={'qc_vhr_comment':'Done'},headers=h).status_code==403
    assert client.get('/api/admin/qa-dashboard',headers=h).status_code==403


def test_qa_assignment_boundary_and_completed_edit(client,db_session,auditor,auditor_token):
    other=User(full_name='Other QA',email='otherqa@tests.invalid',password_hash=auditor.password_hash,role=UserRole.AUDITOR)
    db_session.add(other); db_session.commit()
    r=row(db_session,assigned_auditor_id=other.id,status='COMPLETED'); h=auth_header(auditor_token); path=f'/api/admin/records/{r.id}/qc'
    assert client.patch(path,json={'qc_vhr_comment':'Done'},headers=h).status_code==403
    r.assigned_auditor_id=auditor.id; db_session.commit()
    assert client.patch(path,json={'qc_vhr_comment':'Done'},headers=h).status_code==200


def test_qc_dashboard_list_consistency_with_blank_legacy_data(client,db_session,auditor_token):
    row(db_session,audited_at=datetime.now(timezone.utc),qc_vhr_comment=' ')
    row(db_session,qc_street_details='Street observation')
    row(db_session,qc_completed_at=datetime.now(timezone.utc))
    h=auth_header(auditor_token); d=client.get('/api/admin/qa-dashboard',headers=h).json()
    assert (d['total'],d['done'],d['pending'])==(3,2,1)
    for status,count in [('DONE',2),('PENDING',1)]:
        assert client.get('/api/admin/records',params={'qc_status':status},headers=h).json()['total']==count


def test_multiselect_all_pages_blanks_facets_and_export(client,db_session,admin_token):
    for district,village in [('East','A'),('East','B'),('West','A'),('North','A'),('West',None)]: row(db_session,district=district,village=village)
    h=auth_header(admin_token); f=json.dumps({'district':['East','West'],'village':['A']})
    a=client.get('/api/admin/records',params={'column_filters':f,'page_size':1},headers=h).json()
    b=client.get('/api/admin/records',params={'column_filters':f,'page_size':1,'page':2},headers=h).json()
    assert a['total']==b['total']==2 and a['records'][0]['id']!=b['records'][0]['id']
    assert client.get('/api/admin/records',params={'column_filters':json.dumps({'village':['__BLANK__']})},headers=h).json()['total']==1
    choices=client.get('/api/admin/records/filter-options',params={'field':'district','column_filters':f},headers=h).json()
    assert {x['value'] for x in choices['options']}=={'East','West','North'}
    export=client.get('/api/admin/records/export',params={'column_filters':f},headers=h)
    assert export.status_code==200,export.text
    assert openpyxl.load_workbook(io.BytesIO(export.content)).active.max_row==3


@pytest.mark.parametrize('field',['password_hash','google_drive_file_id','secret','unknown'])
def test_disallowed_column_fields_rejected(client,admin_token,field):
    h=auth_header(admin_token)
    assert client.get('/api/admin/records/filter-options',params={'field':field},headers=h).status_code==422
    assert client.get('/api/admin/records',params={'column_filters':json.dumps({field:['x']})},headers=h).status_code==422


@pytest.mark.parametrize('raw',['{','[]','{"district":[]}','{"district":[2]}','{"district":"East"}'])
def test_malformed_filters_rejected(client,admin_token,raw):
    assert client.get('/api/admin/records',params={'column_filters':raw},headers=auth_header(admin_token)).status_code==422


def test_qa_user_filter_and_sort_use_qc_author(client,db_session,auditor,auditor_token,admin_token):
    r=row(db_session,assigned_auditor_id=auditor.id)
    client.patch(f'/api/admin/records/{r.id}/qc',json={'qc_vhr_comment':'Done'},headers=auth_header(auditor_token))
    d=client.get('/api/admin/records',params={'column_filters':json.dumps({'qa_user':[auditor.full_name]}),'sort_by':'qa_user'},headers=auth_header(admin_token))
    assert d.status_code==200 and d.json()['total']==1


def test_field_location_choices_are_own_approved_and_cascade(client,db_session,test_user,user_token,test_admin):
    for district,taluk,village in [('East','E1','V1'),('East','E2','V2'),('West','W1','V3')]:
        r=row(db_session,district=district,taluk=taluk,village=village); r.user_id=test_user.id; r.audit_status='APPROVAL'
    foreign=row(db_session,district='Foreign',taluk='F',village='FV'); foreign.user_id=test_admin.id; foreign.audit_status='APPROVAL'; db_session.commit()
    h = auth_header(user_token)
    data = client.get('/api/records/filter-options',params={'district':'East','taluk':'E1'},headers=h).json()
    assert data=={'district':['East','West'],'taluk':['E1','E2'],'village':['V1'],'village_counts':[{'count':1,'name':'V1'}]}
    d=client.get('/api/records',params={'district':'East','taluk':'E1','village':'V1'},headers=h).json()
    assert d['total']==1 and d['records'][0]['village']=='V1'
    multi=client.get('/api/records',params={'district':'East','village':'V1,V2'},headers=h).json()
    assert multi['total']==2


@pytest.mark.parametrize('path',['/api/admin/records','/api/admin/records/export','/api/admin/records/filter-options?field=village','/api/admin/qa-dashboard','/api/records'])
def test_inverted_date_range_rejected(client,admin_token,path):
    r=client.get(path,params={'date_from':'2026-10-02T00:00:00Z','date_to':'2026-10-01T00:00:00Z'},headers=auth_header(admin_token))
    assert r.status_code==422


def test_startup_preserves_qa_assignment_after_admin_decision(db_engine, db_session, auditor, test_admin):
    from app.database.connection import _sync_assigned_auditor_from_audited_by
    record=row(db_session,assigned_auditor_id=auditor.id,audited_by_id=test_admin.id)
    legacy=row(db_session,audited_by_id=auditor.id)
    _sync_assigned_auditor_from_audited_by(db_engine)
    db_session.expire_all()
    assert db_session.get(CaptureRecord,record.id).assigned_auditor_id==auditor.id
    assert db_session.get(CaptureRecord,legacy.id).assigned_auditor_id==auditor.id


def test_admin_only_decision_does_not_claim_qa_user(client,db_session,admin_token,test_admin):
    record=row(db_session)
    d=client.patch(f'/api/admin/records/{record.id}/audit',json={'audit_status':'APPROVAL'},headers=auth_header(admin_token)).json()
    assert d['assigned_auditor_id'] is None and d['assigned_auditor_name'] is None
    assert d['qc_completed_at'] is None and d['qc_by_name'] is None


def test_qc_author_deletion_preserves_record_history(client,db_session,admin_token,test_admin):
    author=User(full_name='Former Admin QA',email='formerqa@tests.invalid',password_hash=test_admin.password_hash,role=UserRole.ADMIN)
    db_session.add(author);db_session.commit()
    row(db_session,qc_by_id=author.id,qc_vhr_comment='Done')
    assert client.delete(f'/api/admin/users/{author.id}',headers=auth_header(admin_token)).status_code==409
