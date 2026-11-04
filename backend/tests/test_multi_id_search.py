import pytest
from app.models.capture_record import CaptureRecord
from app.repositories.record_repository import RecordRepository

def test_multi_id_search(db_session, test_user):
    repo = RecordRepository(db_session)
    r1 = repo.create(user_id=test_user.id, name="Test 1", unique_id="CBE-900101", coordinates="11.0, 77.0")
    r2 = repo.create(user_id=test_user.id, name="Test 2", unique_id="CBE-900102", coordinates="11.0, 77.0")
    r3 = repo.create(user_id=test_user.id, name="Test 3", unique_id="CBE-900103", coordinates="11.0, 77.0")

    # 1. Comma separated search
    records, total = repo.list_records(search="CBE-900101, CBE-900103")
    uids = {r.unique_id for r in records}
    assert "CBE-900101" in uids
    assert "CBE-900103" in uids
    assert "CBE-900102" not in uids

    # 2. Multi-line newline separated search (like copied from Excel)
    records, total = repo.list_records(search="CBE-900102\nCBE-900103")
    uids = {r.unique_id for r in records}
    assert "CBE-900102" in uids
    assert "CBE-900103" in uids
    assert "CBE-900101" not in uids

    # 3. Space-separated UIDs
    records, total = repo.list_records(search="CBE-900101 CBE-900102")
    uids = {r.unique_id for r in records}
    assert "CBE-900101" in uids
    assert "CBE-900102" in uids
    assert "CBE-900103" not in uids
