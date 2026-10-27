import io
import json
import openpyxl
import pytest
from app.models.user import User, UserRole


def test_upload_sheet_stream_full_lifecycle(client, admin_token, test_admin, test_user, db_session):
    # Create an in-memory workbook with rows missing village and taluk
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Tasks"
    headers = [
        "Operator Email", "Unique ID", "Site Address", "Coordinates",
        "Taluk", "Village", "District"
    ]
    ws.append(headers)
    # Row 1: Vilankurichi coordinates (11.05, 76.99) with empty village/taluk/district
    ws.append([test_user.email, "TASK-STREAM-001", "Site near Vilankurichi IT Park", "11.052, 76.995", "", "", ""])
    # Row 2: Kalapatti with village name provided but empty taluk/district
    ws.append([test_user.email, "TASK-STREAM-002", "Kalapatti Site", "11.07, 77.03", "", "Kalapatti", ""])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    response = client.post(
        "/api/admin/records/upload-sheet-stream",
        files={"file": ("test_tasks.xlsx", bio.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mode": "dispatch"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    lines = [line.strip() for line in response.text.strip().split("\n") if line.strip()]
    assert len(lines) >= 3

    events = [json.loads(line) for line in lines]
    types = [e["type"] for e in events]
    assert "init" in types
    if "progress" not in types:
        print("\nEVENTS:", events)
    assert "progress" in types
    assert "done" in types

    done_event = [e for e in events if e["type"] == "done"][0]
    assert done_event["result"]["success"] is True
    assert done_event["result"]["total_dispatched"] == 2
    assert done_event["result"]["auto_resolved_count"] >= 1
