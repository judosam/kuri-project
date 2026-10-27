"""Loop 3 — Audit gateway tests.

Task sheets uploaded via /admin/records/upload-sheet are STAGED:
audit_status=PENDING, user_id NULL, intended operator parked in
staged_operator_id. Field operators must never see unapproved records;
auditors release (APPROVAL) or block (DISAPPROVAL / COMMERCIAL_PROPERTY)
them via PATCH /admin/records/{id}/audit.
"""
import io

import openpyxl
import pytest

from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.core.security import hash_password


def create_test_excel(headers, rows, sheet_name="Task Dispatch"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def upload_tasks(client, token, rows, headers=None):
    headers = headers or ["operator_email", "unique_id", "coordinates", "site_address"]
    return client.post(
        "/api/admin/records/upload-sheet",
        files={"file": ("tasks.xlsx", io.BytesIO(create_test_excel(headers, rows)), XLSX_MIME)},
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.fixture
def manager(db_session):
    """A MANAGER — the non-admin office role, used to prove the retired
    importer's powers did not simply move sideways to managers."""
    user = User(
        email="manager@example.com",
        password_hash=hash_password("managerpass123"),
        full_name="Field Manager",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def manager_token(client, manager):
    response = client.post(
        "/api/auth/login",
        json={"email": "manager@example.com", "password": "managerpass123"},
    )
    return response.json()["access_token"]


@pytest.fixture
def auditor(db_session):
    user = User(
        email="auditor@example.com",
        password_hash=hash_password("auditorpass123"),
        full_name="Alice Auditor",
        role=UserRole.AUDITOR,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def auditor_token(client, auditor):
    response = client.post(
        "/api/auth/login",
        json={"email": "auditor@example.com", "password": "auditorpass123"},
    )
    return response.json()["access_token"]


def _login_headers(token):
    return {"Authorization": f"Bearer {token}"}


class TestTaskSheetStaging:
    def test_admin_upload_stages_tasks_for_review(self, client, admin_token, test_user):
        """Staging a task sheet is an admin action now that the importer role
        is retired: the row lands PENDING with no operator attached."""
        resp = upload_tasks(
            client,
            admin_token,
            [[test_user.email, "STAGE-1", "11.040756, 77.030313", "Staged Address"]],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["total_dispatched"] == 1
        assert data["dispatched_tasks"][0]["staged"] is True

        record_id = data["dispatched_tasks"][0]["record_id"]
        detail = client.get(
            f"/api/admin/records/{record_id}", headers=_login_headers(admin_token)
        ).json()
        assert detail["audit_status"] == "PENDING"
        assert detail["user_id"] is None
        assert detail["staged_operator_id"] == test_user.id
        assert detail["uploaded_by_id"] is not None

    def test_history_import_remains_immediately_assigned(self, client, admin_token, test_user):
        """History backfill is completed work — assigned and approved at once."""
        resp = client.post(
            "/api/admin/records/upload-sheet",
            data={"mode": "history"},
            files={
                "file": (
                    "history.xlsx",
                    io.BytesIO(
                        create_test_excel(
                            ["operator_email", "unique_id", "coordinates", "site_address"],
                            [[test_user.email, "HIST-1", "11.040756, 77.030313", "History Address"]],
                        )
                    ),
                    XLSX_MIME,
                )
            },
            headers=_login_headers(admin_token),
        )
        assert resp.status_code == 200
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]
        detail = client.get(
            f"/api/admin/records/{record_id}", headers=_login_headers(admin_token)
        ).json()
        assert detail["status"] == "COMPLETED"
        assert detail["user_id"] == test_user.id
        assert detail["audit_status"] == "APPROVAL"


class TestOperatorDataLeakagePrevention:
    def test_staged_task_invisible_to_field_operator(
        self, client, user_token, admin_token, test_user
    ):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "LEAK-1", "11.040756, 77.030313", "Hidden Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]

        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert all(r["id"] != record_id for r in listing["records"])

        # Even a direct fetch by id is denied (403 access-denied / 404 hidden).
        direct = client.get(f"/api/records/{record_id}", headers=_login_headers(user_token))
        assert direct.status_code in (403, 404)

    def test_approved_task_released_to_operator_by_assigner(
        self, client, user_token, admin_token, test_user
    ):
        """Audit approval alone does NOT assign anyone — the Record Assigner
        releases the approved record to the field verifier explicitly."""
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "APPROVE-1", "11.040756, 77.030313", "Approved Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]

        decision = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL", "audit_comment": "Site verified"},
            headers=_login_headers(admin_token),
        )
        assert decision.status_code == 200
        # Decision recorded, but nobody assigned yet:
        assert decision.json()["user_id"] is None
        assert decision.json()["audit_status"] == "APPROVAL"
        assert decision.json()["audited_by_name"] is not None
        assert decision.json()["audited_at"] is not None

        # Still hidden from the operator until the assigner releases it.
        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert all(r["id"] != record_id for r in listing["records"])

        # Assigner releases the approved record to the field verifier.
        release = client.post(
            "/api/admin/records/assign-verifier",
            json={"record_ids": [record_id], "verifier_id": test_user.id},
            headers=_login_headers(admin_token),
        )
        assert release.status_code == 200
        assert release.json()["reassigned_count"] == 1

        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert any(r["id"] == record_id for r in listing["records"])

    def test_disapproved_task_never_reaches_operator(
        self, client, user_token, admin_token, test_user
    ):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "DISAPPROVE-1", "11.040756, 77.030313", "Bad Parcel"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]

        decision = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "DISAPPROVAL", "audit_comment": "Invalid coordinates / duplicate parcel"},
            headers=_login_headers(admin_token),
        )
        assert decision.status_code == 200
        assert decision.json()["audit_status"] == "DISAPPROVAL"
        assert decision.json()["user_id"] is None

        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert all(r["id"] != record_id for r in listing["records"])

    def test_commercial_property_task_never_reaches_operator(
        self, client, user_token, admin_token, test_user
    ):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "COMMERCIAL-1", "11.040756, 77.030313", "Warehouse Site"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]

        decision = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "COMMERCIAL_PROPERTY", "audit_comment": "Identified as commercial warehouse"},
            headers=_login_headers(admin_token),
        )
        assert decision.status_code == 200
        assert decision.json()["audit_status"] == "COMMERCIAL_PROPERTY"
        assert decision.json()["user_id"] is None

        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert all(r["id"] != record_id for r in listing["records"])

    def test_disapproval_can_be_reverted_then_released(
        self, client, user_token, admin_token, test_user
    ):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "REVERT-1", "11.040756, 77.030313", "Revert Parcel"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]

        client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "DISAPPROVAL", "audit_comment": "Needs re-check"},
            headers=_login_headers(admin_token),
        )
        decision = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL", "audit_comment": "Corrected"},
            headers=_login_headers(admin_token),
        )
        assert decision.status_code == 200
        assert decision.json()["audit_status"] == "APPROVAL"
        assert decision.json()["user_id"] is None

        release = client.post(
            "/api/admin/records/assign-verifier",
            json={"record_ids": [record_id], "verifier_id": test_user.id},
            headers=_login_headers(admin_token),
        )
        assert release.status_code == 200
        listing = client.get("/api/records", headers=_login_headers(user_token)).json()
        assert any(r["id"] == record_id for r in listing["records"])


class TestAuditEndpointSecurity:
    def test_operator_cannot_audit(self, client, user_token, admin_token, test_user):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "SEC-1", "11.040756, 77.030313", "Sec Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]
        denied = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL"},
            headers=_login_headers(user_token),
        )
        assert denied.status_code == 403

    def test_manager_cannot_audit(self, client, manager_token, admin_token, test_user):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "SEC-2", "11.040756, 77.030313", "Sec Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]
        denied = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL"},
            headers=_login_headers(manager_token),
        )
        assert denied.status_code == 403

    def test_auditor_endpoint_requires_valid_status(self, client, admin_token, test_user):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "SEC-3", "11.040756, 77.030313", "Sec Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]
        bad = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "SOMETHING_ELSE"},
            headers=_login_headers(admin_token),
        )
        assert bad.status_code == 422


class TestRolePermissions:
    def test_manager_and_auditor_can_view_records_and_map(
        self, client, manager_token, auditor_token, admin_token, test_user
    ):
        for token in (manager_token, auditor_token):
            assert client.get("/api/admin/records", headers=_login_headers(token)).status_code == 200
            assert client.get("/api/admin/locations", headers=_login_headers(token)).status_code == 200
            assert client.get("/api/records", headers=_login_headers(token)).status_code == 200

    def test_sheet_import_endpoints_reject_non_admins(
        self, client, manager_token, auditor_token, test_user
    ):
        """Importing and exporting sheets stayed admin-only; retiring the
        importer role did not hand those powers to managers or auditors."""
        rows = [[test_user.email, "NOPE-1", "11.040756, 77.030313", "Nope Address"]]
        for token in (manager_token, auditor_token):
            headers = _login_headers(token)
            assert client.get("/api/admin/records/template", headers=headers).status_code == 403
            assert client.get("/api/admin/records/export", headers=headers).status_code == 403
            assert upload_tasks(client, token, rows).status_code == 403

    def test_auditor_cannot_reassign_records(self, client, auditor_token, test_user):
        denied = client.post(
            "/api/admin/records/reassign",
            json={"record_ids": [1], "target_user_id": test_user.id},
            headers=_login_headers(auditor_token),
        )
        assert denied.status_code == 403

    def test_operator_cannot_access_admin_records_or_map(self, client, user_token):
        assert client.get("/api/admin/records", headers=_login_headers(user_token)).status_code == 403
        assert client.get("/api/admin/locations", headers=_login_headers(user_token)).status_code == 403

    def test_auditor_can_view_record_details(self, client, auditor_token, admin_token, test_user):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, "VIEW-1", "11.040756, 77.030313", "View Address"]],
        )
        record_id = resp.json()["dispatched_tasks"][0]["record_id"]
        detail = client.get(f"/api/admin/records/{record_id}", headers=_login_headers(auditor_token))
        assert detail.status_code == 200
        assert detail.json()["audit_status"] == "PENDING"


class TestAuditServiceRules:
    def test_approval_never_assigns_and_verifier_requires_approval(
        self, db_session, test_user, test_admin
    ):
        from app.services.record_service import RecordService

        # Staged record (user_id None) approved by an auditor.
        staged = CaptureRecord(user_id=None, name="Routed sheet row")
        db_session.add(staged)
        db_session.commit()
        db_session.refresh(staged)

        service = RecordService(db_session)
        decided = service.audit_record(staged, "APPROVAL", None, test_admin)
        assert decided.audit_status == "APPROVAL"
        assert decided.user_id is None  # release is the assigner's separate step

        assigned = service.assign_verifier(decided, test_user.id, test_admin)
        assert assigned.user_id == test_user.id

        # Blocked outcomes can never be assigned to a verifier.
        blocked = CaptureRecord(user_id=None, name="Blocked row")
        db_session.add(blocked)
        db_session.commit()
        db_session.refresh(blocked)
        service.audit_record(blocked, "DISAPPROVAL", "bad parcel", test_admin)
        with pytest.raises(ValueError):
            service.assign_verifier(blocked, test_user.id, test_admin)
        assert blocked.user_id is None

    def test_legacy_records_default_to_approval(self, db_session, test_user):
        record = CaptureRecord(user_id=test_user.id, name="Ad-hoc capture")
        db_session.add(record)
        db_session.commit()
        assert record.audit_status == "APPROVAL"

    def test_directly_created_staged_record_stays_pending(self, db_session):
        record = CaptureRecord(user_id=None, name="Staged sheet row")
        db_session.add(record)
        db_session.commit()
        assert record.audit_status == "PENDING"


class TestRoutingAndReleaseWorkflow:
    """Admin: import → route to auditor → auditor decides → admin releases
    approved rows to a field verifier."""

    def _stage_one(self, client, admin_token, test_user, uid):
        resp = upload_tasks(
            client, admin_token,
            [[test_user.email, uid, "11.040756, 77.030313", "Assigner Address"]],
        )
        assert resp.status_code == 200
        return resp.json()["dispatched_tasks"][0]["record_id"]

    def test_full_route_and_release_loop(self, client, admin_token, auditor, test_user):
        record_id = self._stage_one(client, admin_token, test_user, "FLOW-1")

        # 1. Admin routes the staged record to the auditor.
        routed = client.post(
            "/api/admin/records/assign-auditor",
            json={"record_ids": [record_id], "auditor_id": auditor.id},
            headers=_login_headers(admin_token),
        )
        assert routed.status_code == 200
        assert routed.json()["reassigned_count"] == 1
        detail = client.get(f"/api/admin/records/{record_id}", headers=_login_headers(admin_token)).json()
        assert detail["assigned_auditor_id"] == auditor.id
        assert detail["assigned_auditor_name"] == auditor.full_name

        # 2. Admin makes the final decision after QA review.
        auditor_login = client.post(
            "/api/auth/login",
            json={"email": "auditor@example.com", "password": "auditorpass123"},
        )
        decision = client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL", "audit_comment": "Verified against survey parcel"},
            headers=_login_headers(admin_token),
        )
        assert decision.status_code == 200
        assert decision.json()["audit_status"] == "APPROVAL"
        assert decision.json()["user_id"] is None

        # 3. Admin sees the decision live and releases to the verifier.
        release = client.post(
            "/api/admin/records/assign-verifier",
            json={"record_ids": [record_id], "verifier_id": test_user.id},
            headers=_login_headers(admin_token),
        )
        assert release.status_code == 200
        assert release.json()["reassigned_count"] == 1
        final = client.get(f"/api/admin/records/{record_id}", headers=_login_headers(admin_token)).json()
        assert final["user_id"] == test_user.id

    def test_only_pending_records_can_be_routed(
        self, client, admin_token, auditor, test_user
    ):
        record_id = self._stage_one(client, admin_token, test_user, "FLOW-2")
        client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL"},
            headers=_login_headers(admin_token),
        )
        routed = client.post(
            "/api/admin/records/assign-auditor",
            json={"record_ids": [record_id], "auditor_id": auditor.id},
            headers=_login_headers(admin_token),
        )
        assert routed.status_code == 200
        assert routed.json()["reassigned_count"] == 1
        # When reassigned to QC user, audit_status and status become Pending
        detail = client.get(f"/api/admin/records/{record_id}", headers=_login_headers(admin_token)).json()
        assert detail["audit_status"] == "PENDING"
        assert detail["status"] == "NOT_COMPLETED"

    def test_non_auditor_cannot_be_routed(self, client, admin_token, test_user):
        record_id = self._stage_one(client, admin_token, test_user, "FLOW-3")
        bad = client.post(
            "/api/admin/records/assign-auditor",
            json={"record_ids": [record_id], "auditor_id": test_user.id},
            headers=_login_headers(admin_token),
        )
        assert bad.status_code == 400
        assert "active auditor" in bad.json()["detail"]

    def test_operator_cannot_route_or_release(self, client, user_token, admin_token, auditor, test_user):
        record_id = self._stage_one(client, admin_token, test_user, "FLOW-4")
        assert client.post(
            "/api/admin/records/assign-auditor",
            json={"record_ids": [record_id], "auditor_id": auditor.id},
            headers=_login_headers(user_token),
        ).status_code == 403
        assert client.post(
            "/api/admin/records/assign-verifier",
            json={"record_ids": [record_id], "verifier_id": test_user.id},
            headers=_login_headers(user_token),
        ).status_code == 403

    def test_auditor_cannot_release_to_verifier(self, client, admin_token, auditor_token, test_user):
        record_id = self._stage_one(client, admin_token, test_user, "FLOW-5")
        client.patch(
            f"/api/admin/records/{record_id}/audit",
            json={"audit_status": "APPROVAL"},
            headers=_login_headers(admin_token),
        )
        denied = client.post(
            "/api/admin/records/assign-verifier",
            json={"record_ids": [record_id], "verifier_id": test_user.id},
            headers=_login_headers(auditor_token),
        )
        assert denied.status_code == 403

    def test_auditor_directory_lists_only_auditors(self, client, manager_token, auditor):
        resp = client.get("/api/admin/auditors", headers=_login_headers(manager_token))
        assert resp.status_code == 200
        entries = resp.json()
        assert all(e["role"] == "AUDITOR" for e in entries)
        assert any(e["id"] == auditor.id for e in entries)


class TestRetiredImporterRole:
    """The TASK_IMPORTER (Record Assigner) role is retired: admins import and
    route, and no account can be created with the old role any more."""

    def test_retired_role_cannot_be_created(self, client, admin_token):
        created = client.post(
            "/api/admin/users",
            headers=_login_headers(admin_token),
            json={
                "email": "assigner@example.com",
                "full_name": "Retired Assigner",
                "role": "TASK_IMPORTER",
                "password": "AssignerPass123!",
            },
        )
        assert created.status_code == 422

    def test_retired_role_is_not_an_assignable_role(self):
        assert "TASK_IMPORTER" not in {role.value for role in UserRole}

    def test_startup_migration_promotes_legacy_importers(self, db_session):
        """A row still holding the retired role is promoted to ADMIN, so the
        enum never has to deserialise a value it no longer knows."""
        from sqlalchemy import text

        from app.database.connection import _retire_task_importer_role

        # Write the retired value straight into the column (bypassing the enum) —
        # exactly what a database created before the retirement looks like.
        db_session.execute(
            text(
                "INSERT INTO users (email, password_hash, full_name, role, is_active, must_change_password, created_at) "
                "VALUES ('legacy-importer@example.com', 'x', 'Legacy Importer', 'TASK_IMPORTER', 1, 0, CURRENT_TIMESTAMP)"
            )
        )
        db_session.commit()

        _retire_task_importer_role(db_session.get_bind())

        promoted = db_session.execute(
            text("SELECT role FROM users WHERE email = 'legacy-importer@example.com'")
        ).scalar()
        assert promoted == "ADMIN"
