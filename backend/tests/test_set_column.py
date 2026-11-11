import pytest
from app.models.capture_record import CaptureRecord
from app.schemas.record import RecordDetail
from app.routers.records import _record_to_detail
from app.services.record_excel_service import build_records_report
import openpyxl
import io

def test_set_name_in_model_and_detail(db_session):
    """Test that set_name is stored and serialized in RecordDetail."""
    from app.database.connection import SessionLocal
    # Query database
    db = SessionLocal()
    try:
        rec = db.query(CaptureRecord).filter(CaptureRecord.set_name.isnot(None)).first()
        assert rec is not None
        assert rec.set_name in ('CBE District', 'CBE Corporation', 'Manually Added by QA', 'Manually Added by Field User')

        detail = _record_to_detail(rec)
        assert detail.set_name == rec.set_name
    finally:
        db.close()


def test_excel_export_replaces_source_with_set(db_session):
    """Verify that the generated Excel report header includes 'SET' and excludes 'Record Source'."""
    from app.database.connection import SessionLocal
    db = SessionLocal()
    try:
        records = db.query(CaptureRecord).limit(5).all()
        excel_bytes = build_records_report(records, _record_to_detail, include_images=False)
        
        wb = openpyxl.load_workbook(io.BytesIO(excel_bytes), data_only=True)
        ws = wb["Inspections Report"]
        headers = [cell.value for cell in ws[1]]
        
        assert "SET" in headers
        assert "Record Source" not in headers
        
        set_col_idx = headers.index("SET") + 1
        for row in range(2, ws.max_row + 1):
            val = ws.cell(row=row, column=set_col_idx).value
            assert val is not None and len(str(val).strip()) > 0
    finally:
        db.close()


def test_set_name_in_filter_fields_and_options(client, admin_token, test_admin, db_session):
    """Verify that set_name is allowed in FILTER_FIELDS and filter-options endpoint succeeds."""
    from app.services.record_filter_service import FILTER_FIELDS, parse_column_filters
    
    assert "set_name" in FILTER_FIELDS
    parsed = parse_column_filters('{"set_name": ["CBE District"]}')
    assert parsed == {"set_name": ["CBE District"]}

    # Create a test record in db_session
    rec = CaptureRecord(
        user_id=test_admin.id,
        name="Test Set Record",
        latitude=11.0,
        longitude=77.0,
        status="PENDING",
        set_name="CBE District",
    )
    db_session.add(rec)
    db_session.commit()

    # Test the API endpoint directly
    response = client.get(
        "/api/admin/records/filter-options?field=set_name",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "options" in data
    assert isinstance(data["options"], list)
    option_values = [opt["value"] for opt in data["options"]]
    assert "CBE District" in option_values

    # Test that /api/admin/records returns set_name in the record list
    res_list = client.get(
        "/api/admin/records",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_list.status_code == 200
    list_data = res_list.json()
    assert "records" in list_data
    found = [r for r in list_data["records"] if r["id"] == rec.id]
    assert len(found) == 1
    assert found[0]["set_name"] == "CBE District"


