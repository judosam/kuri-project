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
