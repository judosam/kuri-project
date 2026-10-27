import io
import json
import zipfile
from datetime import datetime, timezone
from unittest.mock import patch

import openpyxl
from PIL import Image
from jose import jwt

from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.core.security import hash_password


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_session_persists_and_logout_revokes(client, user_token):
    claims = jwt.get_unverified_claims(user_token)
    assert "exp" not in claims and claims["sid"]
    assert client.get('/api/auth/me', headers=headers(user_token)).status_code == 200
    assert client.post('/api/auth/logout', headers=headers(user_token)).status_code == 200
    assert client.get('/api/auth/me', headers=headers(user_token)).status_code == 401


def test_legacy_login_upgrades_to_persistent_session(client, test_user):
    from app.core.security import create_access_token
    token = create_access_token({'sub':str(test_user.id)})
    response = client.get('/api/auth/me', headers=headers(token))
    assert response.status_code == 200
    replacement = response.headers['x-session-token']
    assert 'exp' not in jwt.get_unverified_claims(replacement)
    assert client.get('/api/auth/me', headers=headers(replacement)).status_code == 200


def test_password_change_keeps_current_device_only(client, user_token):
    other = client.post('/api/auth/login', json={'email':'test@example.com','password':'testpass123'}).json()['access_token']
    response = client.post('/api/auth/change-password', headers=headers(user_token), json={'current_password':'testpass123','new_password':'newpass12345'})
    assert response.status_code == 200
    assert client.get('/api/auth/me', headers=headers(user_token)).status_code == 200
    assert client.get('/api/auth/me', headers=headers(other)).status_code == 401


def test_inspection_without_photos_and_full_download(client, user_token, test_user, db_session):
    task = CaptureRecord(user_id=test_user.id, name='Site inspection', street_address='23 Test Street', status='NOT_COMPLETED', survey_no='001', subdivision_no='2')
    db_session.add(task); db_session.commit()
    response = client.post('/api/records', headers=headers(user_token), json={'task_id':task.id,'name':task.name,'photos':[],'relationship_with_building':'Tenant','date_of_visit':'2026-09-23'})
    assert response.status_code == 201
    record = response.json()
    assert record['id'] == task.id and record['status'] == 'COMPLETED'
    assert record['relationship_with_building'] == 'Tenant' and record['images'] == []
    assert db_session.query(CaptureRecord).count() == 1
    result = client.get(f'/api/records/{task.id}/download', headers=headers(user_token))
    assert result.status_code == 200
    with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
        assert 'record.html' in archive.namelist()
        data = json.loads(archive.read('record.json'))
        assert data['relationship_with_building'] == 'Tenant'
        assert data['street_address'] == '23 Test Street'
    assert client.get(f'/api/records/{task.id}/download').status_code == 401


def test_uploaded_photo_label_and_append_do_not_overwrite(client, user_token):
    record = client.post('/api/records', headers=headers(user_token), json={'name':'Uploaded images'}).json()
    buf=io.BytesIO(); Image.new('RGB',(800,600),'#557799').save(buf,format='JPEG')
    for expected in (1,2):
        with patch('app.routers.records.ImageService.process_image', return_value=buf.getvalue()) as process:
            result=client.post(f"/api/records/{record['id']}/upload", headers=headers(user_token), files=[('files',('image.jpg',buf.getvalue(),'image/jpeg'))], data={'sources':'uploaded','latitudes':'11.1','longitudes':'76.9'})
            assert result.status_code == 200
            assert process.call_args.kwargs['uploaded'] == 'test@example.com'
            photos=result.json()['images']
            assert len(photos) == expected
            assert photos[-1]['source'] == 'uploaded'
            assert photos[-1]['latitude'] == photos[-1]['longitude'] == 0
            assert len({photo['google_drive_file_id'] for photo in photos}) == expected
    archive=client.get(f"/api/records/{record['id']}/download",headers=headers(user_token))
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        assert len([name for name in bundle.namelist() if name.startswith('photos/')]) == 2


def test_download_respects_ownership(client, user_token, db_session):
    other=User(email='other@example.com',full_name='Other',password_hash=hash_password('password123'),role=UserRole.USER)
    db_session.add(other);db_session.commit()
    task=CaptureRecord(user_id=other.id,name='Private')
    db_session.add(task);db_session.commit()
    assert client.get(f'/api/records/{task.id}/download',headers=headers(user_token)).status_code == 403


def test_previous_template_roundtrip(client, admin_token, test_user):
    response=client.get('/api/admin/records/import-previous/template',headers=headers(admin_token))
    assert response.status_code == 200
    workbook=openpyxl.load_workbook(io.BytesIO(response.content))
    sheet=workbook['Previous Records']
    fields=[cell.value for cell in sheet[1]]
    assert 'relationship_with_building' in fields
    assert 'survey_number' not in fields and 'sub_division' not in fields
    values={'operator_email':test_user.email,'unique_id':'PREV-NEW-001','relationship_with_building':'Owner','street_address':'23 Example Street','date_of_visit':'2026-09-23'}
    for index,field in enumerate(fields,1): sheet.cell(2,index,values.get(field,''))
    buf=io.BytesIO();workbook.save(buf)
    files={'file':('previous.xlsx',buf.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
    preview=client.post('/api/admin/records/import-previous/preview',headers=headers(admin_token),files=files)
    assert preview.status_code == 200 and preview.json()['valid_count'] == 1
    imported=client.post('/api/admin/records/import-previous/commit',headers=headers(admin_token),files=files)
    assert imported.status_code == 200 and imported.json()['imported_count'] == 1
    record_id=imported.json()['records'][0]['record_id']
    detail=client.get(f'/api/admin/records/{record_id}',headers=headers(admin_token)).json()
    assert detail['relationship_with_building'] == 'Owner'


def test_existing_database_migration_preserves_records(db_engine, db_session, test_user, monkeypatch):
    from sqlalchemy import text, inspect
    import app.database.connection as connection
    record=CaptureRecord(user_id=test_user.id,name='Keep this existing record',survey_no='003')
    db_session.add(record);db_session.commit()
    with db_engine.begin() as db:
        db.execute(text('ALTER TABLE capture_records DROP COLUMN relationship_with_building'))
        db.execute(text('ALTER TABLE captured_images DROP COLUMN source'))
        db.execute(text('DROP TABLE login_sessions'))
    monkeypatch.setattr(connection,'engine',db_engine)
    connection.create_tables()
    with db_engine.connect() as db:
        row=db.execute(text('SELECT name, survey_no, relationship_with_building FROM capture_records')).one()
        assert tuple(row)==('Keep this existing record','003',None)
    inspector=inspect(db_engine)
    assert 'login_sessions' in inspector.get_table_names()
    assert 'source' in {column['name'] for column in inspector.get_columns('captured_images')}


def test_uploaded_watermark_says_uploaded_image(monkeypatch):
    from PIL import ImageDraw
    from app.services.image_service import ImageService
    drawn=[]
    original=ImageDraw.ImageDraw.text
    def capture(self,xy,text,*args,**kwargs):
        drawn.append(str(text))
        return original(self,xy,text,*args,**kwargs)
    monkeypatch.setattr(ImageDraw.ImageDraw,'text',capture)
    buf=io.BytesIO();Image.new('RGB',(1200,800),'white').save(buf,format='JPEG')
    ImageService().process_image(image_bytes=buf.getvalue(),latitude=11,longitude=76,captured_at=datetime.now(timezone.utc),uploaded='operator@example.com')
    assert any('Uploaded image' in label for label in drawn)
    assert not any('IST' in label for label in drawn)
