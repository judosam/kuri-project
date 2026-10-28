import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.config import get_settings
from app.core.dependencies import (
    require_admin,
    require_admin_or_manager,
    require_auditor,
    require_record_manager,
)
from app.database.connection import get_db
from app.models.activity_log import ActivityLog
from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User, UserRole
from app.models.login_session import LoginSession
from app.repositories.image_repository import ImageRepository
from app.repositories.record_repository import RecordRepository
from app.repositories.user_repository import UserRepository
from app.schemas.activity import ActivityEntry, ActivityLogResponse, ActivitySummary
from app.schemas.record import (
    AddressResolveResponse,
    AuditDecisionRequest,
    DashboardResponse,
    ImageDetail,
    RecordAssignAuditorRequest,
    RecordAssignVerifierRequest,
    RecordBulkAuditRequest,
    RecordBulkAuditResponse,
    RecordBulkStatusRequest,
    RecordBulkStatusResponse,
    RecordDetail,
    RecordListResponse,
    RecordReassignRequest,
    RecordReassignResponse,
    RecordUnassignRequest,
    RecordUnassignResponse,
    RecordUpdateRequest,
    TaskDispatchBatchRequest,
    TelecallerAssignRequest,
)
from app.schemas.auth import AdminResetPasswordResponse, SimpleMessageResponse
from app.schemas.user import UserCreate, UserDetail, UserListResponse, UserResetPasswordRequest, UserUpdate
from app.services.activity_log_service import backfill_historical_logs_if_empty, log_activity
from app.services.local_storage_service import LocalStorageService
from app.services.record_service import RecordService
from app.services.record_filter_service import SORT_PATTERN, parse_column_filters
from app.services.telecaller_comment_service import normalize_to_table

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/admin", tags=["Admin"])


def _store_processed_image(processed: bytes, file_name: str, folder: str) -> tuple[str, str]:
    """Persist watermarked bytes immediately to local storage / Cloud Storage FUSE."""
    from app.services.image_service import ImageService
    local = LocalStorageService()
    relative_path = local.save_file(processed, file_name, folder=folder)

    # Save compact thumbnail for sub-second feed loading
    try:
        thumb_bytes = ImageService().create_thumbnail(processed, max_dim=160)
        local.save_file(thumb_bytes, f"thumb_{file_name}", folder=folder)
    except Exception as e:
        logger.warning(f"Could not generate local thumbnail for {file_name}: {e}")

    return relative_path, "local"


# ─── Dashboard ────────────────────────────────────────────────────────
@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    status: str | None = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    preset: str = Query("allTime"),
    custom_from: str | None = Query(None),
    custom_to: str | None = Query(None),
    district: str | None = Query(None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    record_service = RecordService(db)
    user_repo = UserRepository(db)
    metrics = record_service.get_dashboard_metrics(
        date_from=date_from,
        date_to=date_to,
        status=status,
        preset=preset,
        custom_from=custom_from,
        custom_to=custom_to,
        district=district,
    )
    return DashboardResponse(
        daily_activity=metrics["daily_activity"],
        manually_added_records=metrics["manually_added_records"],
        construction_yes_records=metrics["construction_yes_records"],
        mobile_numbers_collected=metrics["mobile_numbers_collected"],
        total_records=metrics["total_records"],
        today_records=metrics["today_records"],
        month_records=metrics["month_records"],
        total_users=user_repo.count(),
        today_completed_records=metrics.get("today_completed_records", 0),
        total_completed_records=metrics.get("total_completed_records", 0),
        pending_records=metrics.get("pending_records", 0),
        total_photos=metrics.get("total_photos", 0),
        completion_rate=metrics.get("completion_rate", 0.0),
        inspector_stats=metrics.get("inspector_stats", []),
        recent_records=[_record_to_detail(r) for r in metrics["recent_records"]],
        total_commercial_properties=metrics.get("total_commercial_properties", 0),
        eligible_for_field=metrics.get("eligible_for_field", 0),
        unassigned_properties=metrics.get("unassigned_properties", 0),
        period_info=metrics.get("period_info"),
        overview=metrics.get("overview"),
        funnel=metrics.get("funnel"),
        telecalling=metrics.get("telecalling"),
        trends=metrics.get("trends"),
        distribution=metrics.get("distribution"),
        recent_activities=metrics.get("recent_activities"),
    )


@router.get("/assignment-operators")
async def assignment_operators(
    user: User = Depends(require_record_manager), db: Session = Depends(get_db),
):
    # A small directory for assignment, without exposing account management data.
    # Field verifiers are first-class assignment targets alongside USER operators.
    operators = (
        db.query(User)
        .filter(User.role.in_([UserRole.USER, UserRole.FIELD_VERIFIER]), User.is_active.is_(True))
        .order_by(User.full_name, User.id)
        .all()
    )
    return [
        {"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role.value, "is_active": True}
        for u in operators
    ]


@router.get("/auditors")
async def auditor_directory(
    user: User = Depends(require_record_manager), db: Session = Depends(get_db),
):
    # Directory of active auditors and admins for QC review / reassignment
    auditors = db.query(User).filter(
        User.role == UserRole.AUDITOR,
        User.is_active.is_(True),
    ).order_by(User.full_name, User.id).all()
    return [{"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role.value if hasattr(u.role, "value") else str(u.role), "is_active": True} for u in auditors]


@router.post("/records/reassign", response_model=RecordReassignResponse)
async def reassign_records(
    request: RecordReassignRequest,
    admin: User = Depends(require_admin_or_manager),
    db: Session = Depends(get_db),
):
    """
    Reassign selected pending (NOT_COMPLETED) records to target_user_id.
    Completed records will stay with their current user.
    """
    user_repo = UserRepository(db)
    target_user = user_repo.get_by_id(request.target_user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    if not target_user.is_active or target_user.role not in (UserRole.USER, UserRole.FIELD_VERIFIER):
        raise HTTPException(status_code=400, detail="Select an active field operator or field verifier.")

    record_repo = RecordRepository(db)
    try:
        reassigned, skipped = record_repo.reassign_pending_records(
            record_ids=request.record_ids, target_user_id=target_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    log_activity(
        db=db,
        action_type="record_reassign",
        type="record",
        title=f"Reassigned {reassigned} pending record(s) to {target_user.full_name}",
        detail=f"{reassigned} pending record(s) reassigned to {target_user.full_name} ({target_user.email}). {skipped} completed record(s) remained with current user.",
        user_id=admin.id,
        user_name=admin.full_name,
        status="success",
    )

    msg = f"Successfully reassigned {reassigned} pending record(s) to {target_user.full_name}."
    if skipped > 0:
        msg += f" {skipped} completed record(s) will stay with their current user."

    return RecordReassignResponse(
        success=True,
        reassigned_count=reassigned,
        skipped_completed_count=skipped,
        target_user_id=target_user.id,
        target_user_name=target_user.full_name,
        message=msg,
    )


@router.post("/records/assign-auditor", response_model=RecordReassignResponse)
async def assign_auditor_endpoint(
    request: RecordAssignAuditorRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Route staged records to an auditor for review.

    Allowed for ADMIN / MANAGER — routing is a supervisory job, the decision
    itself stays auditor-only.
    """
    role_name = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if role_name not in ("ADMIN", "MANAGER", "AUDITOR"):
        raise HTTPException(status_code=403, detail="Admin, manager, or auditor access required to reassign QC records")

    user_repo = UserRepository(db)
    auditor = user_repo.get_by_id(request.auditor_id)
    if not auditor:
        raise HTTPException(status_code=404, detail="Auditor not found")
    auditor_role = auditor.role.value if hasattr(auditor.role, "value") else str(auditor.role)
    if auditor_role not in ("AUDITOR", "ADMIN", "MANAGER") or not auditor.is_active:
        raise HTTPException(status_code=400, detail="Select an active auditor or administrator.")

    record_service = RecordService(db)
    routed, skipped = 0, 0
    for rid in dict.fromkeys(request.record_ids):
        record = record_service.get_record(rid)
        if not record:
            skipped += 1
            continue
        try:
            record_service.assign_auditor(record, request.auditor_id, current_user)
            routed += 1
        except ValueError:
            skipped += 1

    log_activity(
        db=db,
        action_type="record_assign_auditor",
        type="record",
        title=f"Routed {routed} staged record(s) to auditor {auditor.full_name}",
        detail=(
            f"{routed} staged record(s) routed to auditor {auditor.full_name} ({auditor.email}) "
            f"by {current_user.full_name} ({role_name}). {skipped} skipped (missing or not pending)."
        ),
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    msg = f"Successfully routed {routed} staged record(s) to {auditor.full_name} for audit."
    if skipped:
        msg += f" {skipped} record(s) skipped (not found or not pending)."
    return RecordReassignResponse(
        success=True,
        reassigned_count=routed,
        skipped_completed_count=skipped,
        target_user_id=auditor.id,
        target_user_name=auditor.full_name,
        message=msg,
    )


@router.post("/records/assign-verifier", response_model=RecordReassignResponse)
async def assign_verifier_endpoint(
    request: RecordAssignVerifierRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Release auditor-APPROVED records to a field verifier.

    Allowed for ADMIN / MANAGER. Only records whose audit status is APPROVAL
    can be assigned; this is the step that actually puts the task into the
    field operator's mobile app.
    """
    role_name = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if role_name not in ("ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Only admins and managers can assign field verifiers")

    user_repo = UserRepository(db)
    verifier = user_repo.get_by_id(request.verifier_id)
    if not verifier:
        raise HTTPException(status_code=404, detail="Field verifier not found")
    verifier_role = verifier.role.value if hasattr(verifier.role, "value") else str(verifier.role)
    if verifier_role not in ("USER", "FIELD_VERIFIER") or not verifier.is_active:
        raise HTTPException(status_code=400, detail="Select an active field verifier (operator).")

    record_service = RecordService(db)
    assigned, skipped = 0, 0
    skipped_reasons = 0
    for rid in dict.fromkeys(request.record_ids):
        record = record_service.get_record(rid)
        if not record:
            skipped += 1
            continue
        try:
            record_service.assign_verifier(record, request.verifier_id, current_user)
            assigned += 1
        except ValueError:
            skipped += 1
            skipped_reasons += 1

    log_activity(
        db=db,
        action_type="record_assign_verifier",
        type="record",
        title=f"Assigned {assigned} approved record(s) to field verifier {verifier.full_name}",
        detail=(
            f"{assigned} auditor-approved record(s) assigned to field verifier {verifier.full_name} "
            f"({verifier.email}) by {current_user.full_name} ({role_name}). "
            f"{skipped} skipped (missing or not approved)."
        ),
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    msg = f"Successfully assigned {assigned} approved record(s) to field verifier {verifier.full_name}."
    if skipped:
        msg += f" {skipped} record(s) skipped (missing or not auditor-approved)."
    return RecordReassignResponse(
        success=True,
        reassigned_count=assigned,
        skipped_completed_count=skipped,
        target_user_id=verifier.id,
        target_user_name=verifier.full_name,
        message=msg,
    )


@router.post("/records/unassign-verifier", response_model=RecordUnassignResponse)
async def unassign_verifier_endpoint(
    request: RecordUnassignRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Bulk unassign field verifiers from records (clears user_id and assigned_at)."""
    role_name = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if role_name not in ("ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Only admins and managers can unassign field verifiers")

    unique_ids = list(dict.fromkeys(request.record_ids))
    unassigned = 0
    for i in range(0, len(unique_ids), 500):
        chunk = unique_ids[i:i + 500]
        count = db.query(CaptureRecord).filter(
            CaptureRecord.id.in_(chunk),
            CaptureRecord.status != "COMPLETED",
        ).update(
            {
                CaptureRecord.user_id: None,
                CaptureRecord.assigned_at: None,
                CaptureRecord.staged_operator_id: None,
            },
            synchronize_session=False,
        )
        unassigned += count
    db.commit()
    skipped = len(unique_ids) - unassigned

    log_activity(
        db=db,
        action_type="record_unassign_verifier",
        type="record",
        title=f"Unassigned field verifier from {unassigned} record(s)",
        detail=f"{unassigned} record(s) unassigned from field verifier by {current_user.full_name} ({role_name}). {skipped} skipped (completed or not found).",
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    msg = f"Successfully unassigned field verifier from {unassigned} record(s)."
    if skipped:
        msg += f" {skipped} record(s) skipped (already completed or not found)."
    return RecordUnassignResponse(
        success=True,
        unassigned_count=unassigned,
        skipped_count=skipped,
        message=msg,
    )


@router.post("/records/unassign-auditor", response_model=RecordUnassignResponse)
async def unassign_auditor_endpoint(
    request: RecordUnassignRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Bulk unassign auditors from records (clears assigned_auditor_id)."""
    role_name = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if role_name not in ("ADMIN", "MANAGER", "AUDITOR"):
        raise HTTPException(status_code=403, detail="Only admins, managers, and auditors can unassign auditors")

    unique_ids = list(dict.fromkeys(request.record_ids))
    unassigned = 0
    for i in range(0, len(unique_ids), 500):
        chunk = unique_ids[i:i + 500]
        count = db.query(CaptureRecord).filter(
            CaptureRecord.id.in_(chunk)
        ).update(
            {CaptureRecord.assigned_auditor_id: None},
            synchronize_session=False,
        )
        unassigned += count
    db.commit()
    skipped = len(unique_ids) - unassigned

    log_activity(
        db=db,
        action_type="record_unassign_auditor",
        type="record",
        title=f"Unassigned auditor from {unassigned} record(s)",
        detail=f"{unassigned} record(s) unassigned from auditor by {current_user.full_name} ({role_name}).",
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    msg = f"Successfully unassigned auditor from {unassigned} record(s)."
    if skipped:
        msg += f" {skipped} record(s) skipped."
    return RecordUnassignResponse(
        success=True,
        unassigned_count=unassigned,
        skipped_count=skipped,
        message=msg,
    )


@router.get("/telecallers", response_model=List[UserDetail])
async def list_telecallers_endpoint(
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """List all active telecallers."""
    return [
        UserDetail.model_validate(u)
        for u in db.query(User).filter(User.role == UserRole.TELECALLER, User.is_active == True).order_by(User.full_name).all()
    ]


@router.post("/records/assign-telecaller", response_model=RecordReassignResponse)
async def assign_telecaller_endpoint(
    request: TelecallerAssignRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Assign records to a telecaller."""
    user_repo = UserRepository(db)
    telecaller = user_repo.get_by_id(request.telecaller_id)
    if not telecaller or not telecaller.is_active or telecaller.role != UserRole.TELECALLER:
        raise HTTPException(status_code=400, detail="Select an active telecaller.")

    unique_ids = list(dict.fromkeys(request.record_ids))
    assigned = db.query(CaptureRecord).filter(
        CaptureRecord.id.in_(unique_ids)
    ).update(
        {CaptureRecord.assigned_telecaller_id: telecaller.id},
        synchronize_session=False,
    )
    db.commit()

    log_activity(
        db=db,
        action_type="record_assign_telecaller",
        type="record",
        title=f"Assigned {assigned} record(s) to telecaller {telecaller.full_name}",
        detail=f"{assigned} record(s) assigned to telecaller {telecaller.full_name} ({telecaller.email}) by {current_user.full_name}.",
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    return RecordReassignResponse(
        success=True,
        reassigned_count=assigned,
        skipped_completed_count=len(unique_ids) - assigned,
        target_user_id=telecaller.id,
        target_user_name=telecaller.full_name,
        message=f"Successfully assigned {assigned} record(s) to telecaller {telecaller.full_name}.",
    )


@router.post("/records/unassign-telecaller", response_model=RecordUnassignResponse)
async def unassign_telecaller_endpoint(
    request: RecordUnassignRequest,
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Bulk unassign telecaller from records."""
    unique_ids = list(dict.fromkeys(request.record_ids))
    unassigned = db.query(CaptureRecord).filter(
        CaptureRecord.id.in_(unique_ids)
    ).update(
        {CaptureRecord.assigned_telecaller_id: None},
        synchronize_session=False,
    )
    db.commit()

    log_activity(
        db=db,
        action_type="record_unassign_telecaller",
        type="record",
        title=f"Unassigned telecaller from {unassigned} record(s)",
        detail=f"{unassigned} record(s) unassigned from telecaller by {current_user.full_name}.",
        user_id=current_user.id,
        user_name=current_user.full_name,
        status="success",
    )

    return RecordUnassignResponse(
        success=True,
        unassigned_count=unassigned,
        skipped_count=len(unique_ids) - unassigned,
        message=f"Successfully unassigned telecaller from {unassigned} record(s).",
    )


# ─── Activity Logs ────────────────────────────────────────────────────
def _build_activity_entries(db: Session) -> List[ActivityEntry]:
    """Return unified activity feed from activity_logs table, backfilling if empty."""
    backfill_historical_logs_if_empty(db)
    logs = (
        db.query(ActivityLog)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .all()
    )
    entries: List[ActivityEntry] = []
    for l in logs:
        entries.append(
            ActivityEntry(
                id=f"log-{l.id}",
                ts=l.created_at,
                type=l.type,
                title=l.title,
                detail=l.detail,
                user_id=l.user_id,
                user_name=l.user_name,
                record_id=l.record_id,
                record_name=l.record_name,
            )
        )
    return entries


def _count_in_range(entries: List[ActivityEntry], start: datetime, end: datetime) -> int:
    def _naive(d: datetime) -> datetime:
        return d.replace(tzinfo=None) if d.tzinfo else d

    # Boundaries are normalized too, so aware callers (datetime.now(timezone.utc))
    # and naive SQLite timestamps always compare like-for-like.
    start, end = _naive(start), _naive(end)
    return sum(1 for e in entries if start <= _naive(e.ts) <= end)


@router.get("/logs", response_model=ActivityLogResponse)
async def get_activity_logs(
    entry_type: Optional[str] = Query(None, description="record | photo | user | auth | security"),
    user_id: Optional[int] = None,
    limit: int = Query(300, ge=1, le=1000),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    all_entries = _build_activity_entries(db)

    # Summary windows mirror the dashboard's UTC day/month boundaries.
    # SQLite returns naive UTC datetimes, so the boundaries are naive too.
    now = datetime.now(timezone.utc)
    today_start = datetime.combine(now.date(), datetime.min.time())
    week_start = datetime.combine(now.date() - timedelta(days=now.weekday()), datetime.min.time())
    month_start = datetime.combine(now.date().replace(day=1), datetime.min.time())
    summary = ActivitySummary(
        today=_count_in_range(all_entries, today_start, now),
        week=_count_in_range(all_entries, week_start, now),
        month=_count_in_range(all_entries, month_start, now),
    )

    clean_type = entry_type.strip().lower() if entry_type else None
    filtered = all_entries
    if clean_type and clean_type in ("record", "photo", "user", "auth", "security"):
        filtered = [e for e in filtered if e.type == clean_type]
    if user_id is not None:
        filtered = [e for e in filtered if e.user_id == user_id]

    return ActivityLogResponse(
        items=filtered[:limit],
        total=len(filtered),
        summary=summary,
    )


# ─── User Management ──────────────────────────────────────────────────
@router.get("/users", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user_repo = UserRepository(db)
    users, total = user_repo.list_users(page=page, page_size=page_size, search=search, is_active=is_active)
    return UserListResponse(
        users=[UserDetail.model_validate(u) for u in users],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/users", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.core.security import generate_strong_password, hash_password

    user_repo = UserRepository(db)
    if user_repo.get_by_email(request.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    raw_password = (
        request.password.strip()
        if (request.password and request.password.strip())
        else generate_strong_password(16)
    )

    user = user_repo.create(
        email=request.email,
        password_hash=hash_password(raw_password),
        full_name=request.full_name,
        role=UserRole(request.role),
        must_change_password=True,
    )
    role_name = user.role.value.capitalize() if hasattr(user.role, "value") else str(user.role).capitalize()
    log_activity(
        db=db,
        action_type="user_create",
        type="user",
        title="User account created",
        detail=f"{user.full_name} ({user.email}) · Role: {role_name} created by {admin.full_name}",
        user_id=admin.id,
        user_name=admin.full_name,
        status="success",
    )
    res = UserDetail.model_validate(user)
    res.temporary_password = raw_password
    return res




@router.get("/users/{user_id}", response_model=UserDetail)
async def get_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserDetail.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = UserRepository(db).get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    # Use a guarded SQL delete, bypassing the ORM's record-deletion cascade.
    has_records = db.query(CaptureRecord.id).filter(or_(
        CaptureRecord.user_id == user_id, CaptureRecord.uploaded_by_id == user_id,
        CaptureRecord.audited_by_id == user_id, CaptureRecord.assigned_auditor_id == user_id,
        CaptureRecord.staged_operator_id == user_id, CaptureRecord.qc_by_id == user_id,
    )).exists()
    if db.query(has_records).scalar():
        raise HTTPException(status_code=409, detail="This user has inspection records. Reassign pending records first, or deactivate the account to preserve completed inspection history.")
    name = user.full_name or user.email
    db.query(LoginSession).filter(LoginSession.user_id == user_id).delete(synchronize_session=False)
    db.query(ActivityLog).filter(ActivityLog.user_id == user_id).update({ActivityLog.user_id: None}, synchronize_session=False)
    deleted = db.query(User).filter(User.id == user_id, ~has_records).delete(synchronize_session=False)
    if not deleted:
        db.rollback()
        raise HTTPException(status_code=409, detail="The user now has inspection records. Refresh and try again.")
    db.add(ActivityLog(action_type="USER_DELETED", type="user", title="User account deleted",
                       detail=f"Deleted account: {name} (ID {user_id})", user_id=admin.id, user_name=admin.full_name))
    db.commit()
    return Response(status_code=204)


@router.put("/users/{user_id}", response_model=UserDetail)
async def update_user(
    user_id: int,
    request: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    update_data = request.model_dump(exclude_unset=True)
    if "role" in update_data:
        update_data["role"] = UserRole(update_data["role"])
    user = user_repo.update(user, **update_data)
    return UserDetail.model_validate(user)


@router.post("/users/{user_id}/activate", response_model=UserDetail)
async def activate_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserDetail.model_validate(user_repo.activate(user))


@router.post("/users/{user_id}/deactivate", response_model=UserDetail)
async def deactivate_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate your own account")
    return UserDetail.model_validate(user_repo.deactivate(user))



@router.post("/users/{user_id}/reset-password", response_model=AdminResetPasswordResponse)
async def reset_user_password(
    user_id: int,
    request: Optional[UserResetPasswordRequest] = None,
    http_req: Request = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin reset password: generates a high-entropy 16-character CSPRNG temporary password,
    forces must_change_password=True, and returns the temporary password in response once."""
    from app.core.security import generate_strong_password, hash_password

    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    client_ip = http_req.client.host if http_req and http_req.client else "unknown"

    has_custom = bool(request and request.new_password and request.new_password.strip())
    temp_password = (
        request.new_password.strip()
        if has_custom
        else generate_strong_password(16)
    )
    if len(temp_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters long")

    user.password_hash = hash_password(temp_password)
    if request and request.must_change_password is not None:
        user.must_change_password = request.must_change_password
    else:
        user.must_change_password = not has_custom
    db.commit()
    db.refresh(user)

    if user.id == admin.id and http_req:
        from app.core.security import decode_access_token
        from app.models.login_session import LoginSession
        auth_header = http_req.headers.get("authorization", "")
        token = auth_header.split()[1] if len(auth_header.split()) == 2 else None
        if token:
            payload = decode_access_token(token) or {}
            if payload.get("sid"):
                session_obj = db.get(LoginSession, payload["sid"])
                if session_obj:
                    session_obj.password_fingerprint = hashlib.sha256(user.password_hash.encode()).hexdigest()
                    db.commit()

    log_activity(
        db=db,
        action_type="admin_password_reset",
        type="security",
        title="Admin password reset",
        detail=f"{'Custom password set' if has_custom else 'Temporary password generated'} for {user.full_name} ({user.email}) by Admin {admin.full_name}",
        user_id=admin.id,
        user_name=admin.full_name,
        ip_address=client_ip,
        status="success",
    )

    return AdminResetPasswordResponse(
        id=user.id,
        user_id=user.id,
        email=user.email,
        temporary_password=temp_password,
        message="Password updated successfully." if has_custom else "Temporary password generated. Share securely with user.",
        must_change_password=user.must_change_password,
    )


# ─── Record Management ────────────────────────────────────────────────
@router.get("/records", response_model=RecordListResponse)
async def admin_list_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    search: Optional[str] = None,
    user_id: Optional[int] = None,
    assigned_auditor_id: Optional[int] = Query(None, ge=1),
    unassigned_user: bool = False,
    unassigned_auditor: bool = False,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    audit_status: Optional[str] = Query(None, pattern="^(PENDING|APPROVAL|DISAPPROVAL|COMMERCIAL_PROPERTY|RE_AUDITED)$"),
    qc_status: Optional[str] = Query(None, pattern="^(DONE|PENDING)$"),
    sort_by: str = Query("assigned_at", pattern=SORT_PATTERN),
    column_filters: Optional[str] = Query(None, max_length=16000),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    date_field: str = Query("created_at", pattern="^(created_at|assigned_at|captured_at|completed_at|qc_completed_at)$"),
    admin: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="From date must be before the To date")
    record_service = RecordService(db)
    records, total = record_service.get_all_records(
        page=page, page_size=page_size, status=status, search=search, user_id=user_id,
        date_from=date_from, date_to=date_to,
        sort_by=sort_by, sort_order=sort_order,
        date_field=date_field,
        audit_status=audit_status,
        qc_status=qc_status,
        column_filters=parse_column_filters(column_filters),
        assigned_auditor_id=assigned_auditor_id, unassigned_user=unassigned_user, unassigned_auditor=unassigned_auditor,
    )
    return RecordListResponse(
        records=[_record_to_detail(r) for r in records],
        total=total, page=page, page_size=page_size,
    )


@router.get("/records/template")
async def download_dispatch_template(admin: User = Depends(require_admin)):
    """Return styled Microsoft Excel (.xlsx) template for Google Sheets / Excel task dispatch.
    
    Operator assignment is strictly via 'operator_email' (no user_id needed).
    """
    import io
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Task Dispatch"

    # Ensure grid lines are visible
    ws.views.sheetView[0].showGridLines = True

    headers = [
        "unique_id",
        "coordinates",
        "site_address",
        "street_address",
        "village",
        "taluk",
        "district",
        "survey_no",
        "subdivision_no",
        "land_use",
        "owner_name_en",
        "contact_number",
        "stage_of_construction",
        "no_of_floors",
        "built_up_area",
        "expected_completion",
                "auditor_email",
        "operator_email",
    ]

    sample_rows = [
        [
            "UID-1001",
            "11.016844, 76.955832",
            "142/3A, Trichy Road, Kurichy, Coimbatore",
            "Trichy Road",
            "Kurichy",
            "Coimbatore South",
            "Coimbatore",
            "142/3A",
            "1",
            "Residential",
            "Ramesh Kumar",
            "9876543210",
            "Plastering",
            "G+2",
            "2500 sq.ft",
            "Dec 2026",
            ""
            "",
            "",
        ],
        [
            "UID-1002",
            "11.040756, 77.030313",
            "89/1, Avinashi Road, Saravanampatty, Coimbatore",
            "Avinashi Road",
            "Saravanampatty",
            "Coimbatore North",
            "Coimbatore",
            "89/1",
            "2",
            "Commercial",
            "Suresh Reddy",
            "9845123456",
            "Roof Slab",
            "G+3",
            "4500 sq.ft",
            "Mar 2027",
            ""
            "",
            "",
        ],
    ]

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)

    ws.append(headers)
    ws.row_dimensions[1].height = 28

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    data_font = Font(name="Segoe UI", size=10)
    data_alignment = Alignment(vertical="center")
    cell_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for r_idx, row in enumerate(sample_rows, start=2):
        ws.append(row)
        ws.row_dimensions[r_idx].height = 22
        for col_num in range(1, len(row) + 1):
            cell = ws.cell(row=r_idx, column=col_num)
            cell.font = data_font
            cell.alignment = data_alignment
            cell.border = cell_border

    ws.freeze_panes = "A2"

    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="task_dispatch_template.xlsx"'},
    )



@router.get("/records/bulk-edit/template")
async def download_bulk_edit_template(admin: User = Depends(require_admin)):
    """Return styled Microsoft Excel (.xlsx) template for bulk updating existing leads.
    
    unique_id is mandatory to match and update each existing lead.
    """
    import io
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Bulk Edit Leads"
    ws.views.sheetView[0].showGridLines = True

    headers = [
        "unique_id",
        "company_name",
        "site_address",
        "street_address",
        "village",
        "taluk",
        "district",
        "owner_name_en",
        "contact_number",
        "site_contractor_architect_name",
        "site_contractor_architect_number",
        "stage_of_construction",
        "no_of_floors",
        "built_up_area",
        "expected_completion",
        "construction_happening",
        "type_of_construction",
        "status",
        "remarks",
    ]

    sample_rows = [
        [
            "CBE-110154-769878",
            "Sri Lakshmi Builders",
            "Pappanaickenpalayam, Coimbatore",
            "Kamraj Road",
            "Pappanaickenpalayam",
            "Coimbatore North",
            "Coimbatore",
            "R. Senthil",
            "9876543210",
            "M. Natarajan",
            "9845123456",
            "Brickwork",
            "G+2",
            "3200 sq.ft",
            "Jan 2027",
            "Yes",
            "RCC Framed",
            "COMPLETED",
            "Verified on site",
        ],
    ]

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)

    ws.append(headers)
    ws.row_dimensions[1].height = 28

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment

    data_font = Font(name="Segoe UI", size=10)
    data_alignment = Alignment(vertical="center")
    cell_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for r_idx, row in enumerate(sample_rows, start=2):
        ws.append(row)
        ws.row_dimensions[r_idx].height = 22
        for col_num in range(1, len(row) + 1):
            cell = ws.cell(row=r_idx, column=col_num)
            cell.font = data_font
            cell.alignment = data_alignment
            cell.border = cell_border

    ws.freeze_panes = "A2"

    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="bulk_edit_leads_template.xlsx"'},
    )


@router.post("/records/bulk-edit")
async def bulk_edit_leads(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Bulk update existing leads from an uploaded Excel file using unique_id."""
    import openpyxl
    import io

    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xltx")):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx) files are supported")

    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active

    headers = [str(cell.value).strip().lower() if cell.value is not None else "" for cell in ws[1]]
    if "unique_id" not in headers:
        raise HTTPException(
            status_code=400,
            detail="Header 'unique_id' is required to match leads for bulk update.",
        )

    uid_idx = headers.index("unique_id")
    field_map = {
        "company_name": "name",
        "project_name": "name",
        "name": "name",
        "site_address": "site_address",
        "street_address": "street_address",
        "village": "village",
        "taluk": "taluk",
        "district": "district",
        "owner_name_en": "owner_name_en",
        "contact_number": "contact_number",
        "site_contractor_architect_name": "site_contractor_architect_name",
        "site_contractor_architect_number": "site_contractor_architect_number",
        "stage_of_construction": "stage_of_construction",
        "no_of_floors": "no_of_floors",
        "built_up_area": "built_up_area",
        "expected_completion": "expected_completion",
        "construction_happening": "construction_happening",
        "type_of_construction": "type_of_construction",
        "status": "status",
        "remarks": "remarks",
    }

    updated_count = 0
    not_found = []
    errors = []
    now = datetime.now(timezone.utc)

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(row):
            continue
        uid_val = str(row[uid_idx]).strip() if uid_idx < len(row) and row[uid_idx] is not None else ""
        if not uid_val:
            continue

        record = db.query(CaptureRecord).filter(CaptureRecord.unique_id == uid_val).first()
        if not record:
            not_found.append(uid_val)
            continue

        has_changes = False
        for col_idx, col_name in enumerate(headers):
            if col_idx >= len(row) or col_name == "unique_id":
                continue
            val = row[col_idx]
            if val is None:
                continue
            val_str = str(val).strip()
            if not val_str:
                continue

            attr = field_map.get(col_name)
            if attr and hasattr(record, attr):
                setattr(record, attr, val_str)
                has_changes = True

        if has_changes:
            record.updated_by_id = admin.id
            record.updated_by_name = admin.full_name or admin.username
            record.updated_by_role = admin.role.value if hasattr(admin.role, "value") else str(admin.role)
            record.updated_at = now
            updated_count += 1

    db.commit()

    log_activity(
        db=db,
        action_type="bulk_edit_leads",
        type="record",
        title="Bulk lead update via Excel",
        detail=f"{updated_count} lead(s) updated by {admin.full_name}",
        user_id=admin.id,
        user_name=admin.full_name,
        status="success",
    )

    return {
        "status": "success",
        "updated_count": updated_count,
        "not_found_count": len(not_found),
        "not_found": not_found[:50],
        "errors": errors,
    }


@router.get("/records/export")
async def export_records(
    status: Optional[str] = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    user_id: Optional[int] = Query(None),
    assigned_auditor_id: Optional[int] = Query(None, ge=1),
    unassigned_user: bool = False,
    unassigned_auditor: bool = False,
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    date_field: str = Query("created_at", pattern="^(created_at|assigned_at|captured_at|completed_at|qc_completed_at)$"),
    audit_status: Optional[str] = Query(None, pattern="^(PENDING|APPROVAL|DISAPPROVAL|COMMERCIAL_PROPERTY|RE_AUDITED)$"),
    qc_status: Optional[str] = Query(None, pattern="^(DONE|PENDING)$"),
    column_filters: Optional[str] = Query(None, max_length=16000),
    include_images: bool = Query(True),
    sections: Optional[str] = Query(None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export matching records across all pages with customizable sections and photos."""
    from app.services.record_excel_service import build_records_report, iter_report_records
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="From date must be before the To date")
    parsed_sections = [s.strip().lower() for s in sections.split(",") if s.strip()] if sections else None
    records = iter_report_records(RecordService(db), status=status, user_id=user_id,
                                  date_from=date_from, date_to=date_to, search=search, date_field=date_field, audit_status=audit_status, qc_status=qc_status, column_filters=parse_column_filters(column_filters),
                                  assigned_auditor_id=assigned_auditor_id, unassigned_user=unassigned_user, unassigned_auditor=unassigned_auditor)
    content = build_records_report(records, _record_to_detail, include_images=include_images, sections=parsed_sections)
    log_activity(db=db, action_type="record_download", type="record", title="Full records report exported",
                 detail=f"Excel report exported (photos={'included' if include_images else 'excluded'}, sections={sections or 'all'})", user_id=admin.id,
                 user_name=admin.full_name, status="success")
    filename = f"field_inspections_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(content=content,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/records/upload-sheet")
async def upload_tasks_sheet(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mode: str = Form("dispatch"),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Upload Microsoft Excel (.xlsx) sheet.

    mode='dispatch': stage inspection tasks for an operator (status
    NOT_COMPLETED, audit_status PENDING, user_id NULL until an auditor
    approves). mode='history': backfill already-completed field work directly
    assigned to the operator (status COMPLETED, inspection columns like
    date_of_visit/remarks are also stored).

    Operators are matched strictly by email (required column: 'operator_email').
    CSV files are rejected with a helpful guide to export Google Sheets as .xlsx.
    """
    if mode == "history" and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Task importers must send new tasks through auditor review. Only admins can import previous completed records.")

    if mode not in ("dispatch", "history"):
        raise HTTPException(status_code=400, detail="mode must be 'dispatch' or 'history'")
    import io
    import openpyxl

    filename = file.filename or ""
    lower_filename = filename.lower()

    # 1. Strict CSV rejection with actionable guidance
    if lower_filename.endswith(".csv") or file.content_type == "text/csv":
        raise HTTPException(
            status_code=400,
            detail=(
                "CSV format is not supported. Please upload an Excel sheet (.xlsx). "
                "If you are using Google Sheets, export it via: File → Download → Microsoft Excel (.xlsx)"
            ),
        )

    # 2. File format check
    if not (lower_filename.endswith(".xlsx") or lower_filename.endswith(".xls") or "spreadsheet" in (file.content_type or "").lower()):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Please upload a Microsoft Excel (.xlsx) file.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # 3. Parse workbook with openpyxl
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read Excel file. The file may be corrupt or invalid: {str(e)}",
        )

    ws = wb.active
    if not ws:
        raise HTTPException(status_code=400, detail="No active worksheet found in Excel file.")

    raw_rows = []
    for row in ws.iter_rows(values_only=True):
        if any(c is not None and str(c).strip() != "" for c in row):
            raw_rows.append([str(c).strip() if c is not None else "" for c in row])

    if not raw_rows:
        raise HTTPException(status_code=400, detail="The Excel sheet contains no rows of data.")

    header_row = raw_rows[0]
    headers = [str(h).strip().lower().replace(" ", "_") for h in header_row]

    # 4. Unrecognized sheet defense: Check if at least one expected column exists
    expected_key_columns = {
        "operator_email", "email", "assigned_email", "operator", "user_email", "verifier_email", "field_verifier_email",
        "audit_user", "auditor_email", "auditor",
        "coordinates", "coordinate", "coords", "gps", "site_address", "address", "unique_id", "uid", "street_address",
        "survey_no", "survey_number", "village", "taluk", "district",
    }
    if not any(h in expected_key_columns for h in headers):
        raise HTTPException(
            status_code=400,
            detail=(
                "Unrecognized sheet format: None of the expected task columns "
                "(such as 'unique_id', 'coordinates', 'site_address', or 'operator_email') were found. "
                "Please download and use the official template."
            ),
        )

    user_repo = UserRepository(db)
    record_service = RecordService(db)

    email_cache = {}
    created_records = []
    dispatched_tasks = []
    errors = []
    record_coordinates = {}
    data_rows = raw_rows[1:]

    for idx, row in enumerate(data_rows, start=2):
        row_dict = {headers[i]: row[i] if i < len(row) else "" for i in range(len(headers))}

        # Skip rows where all values are blank
        if not any(v.strip() for v in row_dict.values()):
            continue

        # Assigner sheets carry an `audit_user` / `auditor_email` column — the
        # auditor this row is routed to for review.
        audit_email = (
            row_dict.get("audit_user")
            or row_dict.get("auditor_email")
            or row_dict.get("auditor")
            or ""
        ).strip().lower()
        routed_auditor = None
        if audit_email:
            if audit_email in email_cache:
                routed_auditor = email_cache[audit_email]
            else:
                routed_auditor = user_repo.get_by_email(audit_email)
                email_cache[audit_email] = routed_auditor
            if not routed_auditor:
                errors.append({
                    "row": idx,
                    "column": "audit_user",
                    "message": f"Auditor with email '{audit_email}' does not exist in the system.",
                })
                continue
            audit_role = routed_auditor.role.value if hasattr(routed_auditor.role, "value") else str(routed_auditor.role)
            if audit_role != "AUDITOR" or not routed_auditor.is_active:
                errors.append({
                    "row": idx,
                    "column": "audit_user",
                    "message": f"'{audit_email}' is a {audit_role} account — audit_user must be an active auditor.",
                })
                continue

        # Extract operator email (primary) or fallback to user_id if present
        op_email = (
            row_dict.get("operator_email")
            or row_dict.get("field_verifier_email")
            or row_dict.get("verifier_email")
            or row_dict.get("email")
            or row_dict.get("assigned_email")
            or row_dict.get("user_email")
            or row_dict.get("operator")
            or ""
        ).strip().lower()

        target_user = None

        if op_email:
            if op_email in email_cache:
                target_user = email_cache[op_email]
            else:
                target_user = user_repo.get_by_email(op_email)
                email_cache[op_email] = target_user

            if not target_user:
                errors.append({
                    "row": idx,
                    "column": "operator_email",
                    "message": f"Operator with email '{op_email}' does not exist in the system.",
                })
                continue
            target_role = target_user.role.value if hasattr(target_user.role, "value") else str(target_user.role)
            if target_role not in ("USER", "FIELD_VERIFIER") or not target_user.is_active:
                errors.append({
                    "row": idx,
                    "column": "operator_email",
                    "message": f"'{op_email}' is a {target_role} account — tasks can only be dispatched to active field operators (USER) or field verifiers (FIELD_VERIFIER).",
                })
                continue
        else:
            # Check for fallback user_id if supplied
            user_id_val = row_dict.get("user_id") or row_dict.get("userid")
            if user_id_val and str(user_id_val).strip().isdigit():
                uid = int(str(user_id_val).strip())
                target_user = user_repo.get_by_id(uid)
                if not target_user:
                    errors.append({
                        "row": idx,
                        "column": "user_id",
                        "message": f"User ID {uid} does not exist in the system.",
                    })
                    continue
            elif mode == "history":
                errors.append({
                    "row": idx,
                    "column": "operator_email",
                    "message": "Missing operator email. Column 'operator_email' is required for historical records import.",
                })
                continue

        raw_visit_order = row_dict.get("visit_order") or row_dict.get("order")
        visit_order = None
        if raw_visit_order and str(raw_visit_order).strip().isdigit():
            visit_order = int(str(raw_visit_order).strip())

        unique_id = row_dict.get("unique_id") or row_dict.get("uid") or ""
        cumulative_dist = ""
        street_address = row_dict.get("street_address") or row_dict.get("street") or ""
        land_use = row_dict.get("land_use") or ""
        survey_no = row_dict.get("survey_no") or row_dict.get("survey_number") or ""
        subdivision_no = row_dict.get("subdivision_no") or row_dict.get("sub_division") or ""
        owner_name_en = row_dict.get("owner_name_en") or row_dict.get("owner_name") or row_dict.get("owner") or ""
        site_address = row_dict.get("site_address") or row_dict.get("address") or ""
        survey_number = row_dict.get("survey_number") or survey_no
        sub_division = row_dict.get("sub_division") or subdivision_no
        taluk = row_dict.get("taluk") or ""
        village = row_dict.get("village") or ""
        district = row_dict.get("district") or ""

        # Coordinates validation
        coords_str = row_dict.get("coordinates") or row_dict.get("coordinate") or ""
        lat_col = row_dict.get("latitude") or row_dict.get("lat") or ""
        lng_col = row_dict.get("longitude") or row_dict.get("lng") or ""

        if lat_col and lng_col:
            coords_str = f"{lat_col}, {lng_col}"

        if coords_str:
            parts = [p.strip() for p in coords_str.split(",") if p.strip()]
            if len(parts) == 2:
                try:
                    lat_val = float(parts[0])
                    lng_val = float(parts[1])
                    if not (-90 <= lat_val <= 90 and -180 <= lng_val <= 180):
                        errors.append({
                            "row": idx,
                            "column": "coordinates",
                            "message": f"Coordinates out of range: '{coords_str}'. Latitude must be -90..90, Longitude -180..180.",
                        })
                        continue
                except ValueError:
                    errors.append({
                        "row": idx,
                        "column": "coordinates",
                        "message": f"Invalid coordinate numbers '{coords_str}'. Must be decimal values.",
                    })
                    continue
            else:
                errors.append({
                    "row": idx,
                    "column": "coordinates",
                    "message": f"Invalid coordinate format '{coords_str}'. Expected 'lat, lng'.",
                })
                continue

        # ── Auto-resolve Village, Taluk, District if empty ──
        if not (taluk.strip() and village.strip() and district.strip()):
            from app.services.village_master_service import get_village_master_service
            res = get_village_master_service().resolve_record_location(
                village=village,
                taluk=taluk,
                district=district,
                coordinates=coords_str,
                site_address=site_address,
                street_address=street_address,
            )
            taluk = res["taluk"]
            village = res["village"]
            district = res["district"]
            if res.get("formatted_address"):
                if not street_address:
                    street_address = res["formatted_address"]
                if not site_address:
                    site_address = res["formatted_address"]

        record_name = unique_id or (f"Site Visit - {site_address[:30]}" if site_address else f"Visit #{visit_order or idx}")
        record_desc = f"Assigned inspection for {owner_name_en or 'owner'} at {site_address or street_address or 'site'}"

        if mode == "history":
            record_desc = f"Backfilled inspection for {owner_name_en or 'owner'} at {site_address or street_address or 'site'}"
            record_status = "COMPLETED"
        else:
            record_status = "NOT_COMPLETED"

        # Audit workflow gating: a dispatched task sheet is STAGED — the target
        # operator is parked in staged_operator_id and user_id stays NULL until
        # an auditor approves, so operators cannot see the task yet. History
        # backfill is completed work and is assigned immediately.
        staged_operator_id = (target_user.id if target_user else None) if mode == "dispatch" else None
        assigned_user_id = None if mode == "dispatch" else (target_user.id if target_user else None)

        extra: dict = {}
        if mode == "dispatch":
            # Staged for audit: hidden from field operators until approval.
            extra["audit_status"] = "PENDING"
            if routed_auditor is not None:
                # The assigner's sheet named this row's auditor (audit_user
                # column) — route it at import time so the auditor's queue
                # is already scoped when they sign in.
                extra["assigned_auditor_id"] = routed_auditor.id
        if mode == "history":
            # Inspection result columns — only meaningful for completed visits.
            for col in (
                "date_of_visit", "construction_happening", "remarks",
                "type_of_construction", "relationship_with_building", "building_user_name", "spoken_with", "contact_number",
                "stage_of_construction", "site_contractor_architect_name",
                "site_contractor_architect_number", "follow_up_date",
            ):
                val = str(row_dict.get(col) or "").strip()
                if val:
                    extra[col] = val

        rec = record_service.create_record(
            user_id=assigned_user_id,
            name=record_name,
            # Dispatch tasks are staged unassigned (PENDING via extra); history
            # rows are assigned immediately and default to APPROVAL in the repo.
            staged_operator_id=staged_operator_id,
            uploaded_by_id=current_user.id,
            description=record_desc,
            # No formatted_address: that field means "address of the place the
            # operator actually stood", which cannot exist before the visit.
            # The admin's text stays in site_address/street_address.
            status=record_status,
            # Backfilled rows are admin-uploaded history, not app captures, so
            # the Records table labels them "Uploaded / Imported".
            source="imported" if mode == "history" else "captured",
            unique_id=unique_id,
            
            coordinates=coords_str,
            street_address=street_address,
            land_use=land_use,
            survey_no=survey_no,
            subdivision_no=subdivision_no,
            owner_name_en=owner_name_en,
            site_address=site_address,
            survey_number=survey_number,
            sub_division=sub_division,
            taluk=taluk,
            village=village,
            district=district,
            **extra,
        )
        created_records.append(rec.id)
        dispatched_tasks.append({
            "record_id": rec.id,
            "unique_id": unique_id,
            # Audit-routed sheets have no operator — the named auditor fills these.
            "operator_email": target_user.email if target_user else (routed_auditor.email if routed_auditor else None),
            "operator_name": target_user.full_name if target_user else (routed_auditor.full_name if routed_auditor else None),
            "auditor_email": routed_auditor.email if routed_auditor else None,
            "auditor_name": routed_auditor.full_name if routed_auditor else None,
            "site_address": site_address or street_address,
            "village": village,
            "taluk": taluk,
            "district": district,
            "staged": mode == "dispatch",
        })
        if coords_str:
            record_coordinates[str(rec.id)] = coords_str

    if created_records:
        # Cache each new site's Google Maps satellite image while the sheet is
        # being processed, so the importer, auditor and field verifier panels all
        # open on saved imagery instead of re-downloading tiles.
        from app.services.gmap_snapshot_service import generate_snapshots_for_records

        background_tasks.add_task(generate_snapshots_for_records, list(created_records))

        log_activity(
            db=db,
            action_type="task_dispatch",
            type="record",
            title="Historical field data imported" if mode == "history" else "Task dispatch sheet uploaded (staged for audit)",
            detail=(
                f"{len(created_records)} completed record(s) backfilled by {current_user.full_name}"
                if mode == "history"
                else f"{len(created_records)} task(s) staged for audit by {current_user.full_name}"
            ),
            user_id=current_user.id,
            user_name=current_user.full_name,
            status="success",
        )

    return {
        "success": len(created_records) > 0,
        "total_rows": len(data_rows),
        "total_dispatched": len(created_records),
        "failed_count": len(errors),
        "sheet_name": ws.title,
        "mode": mode,
        "created_ids": created_records,
        "errors": errors,
        "dispatched_tasks": dispatched_tasks,
        "record_coordinates": record_coordinates,
    }


@router.post("/records/upload-sheet-stream")
async def upload_tasks_sheet_stream(
    file: UploadFile = File(...),
    mode: str = Form("dispatch"),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Upload task sheet with live NDJSON streaming progress updates.

    Automatically resolves and backfills empty village, taluk, or district
    using Village Master.xlsx and reverse geocoding.
    """
    if mode == "history" and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Task importers must send new tasks through auditor review. Only admins can import previous completed records.",
        )

    if mode not in ("dispatch", "history"):
        raise HTTPException(status_code=400, detail="mode must be 'dispatch' or 'history'")

    filename = file.filename or ""
    lower_filename = filename.lower()

    if lower_filename.endswith(".csv") or file.content_type == "text/csv":
        raise HTTPException(
            status_code=400,
            detail="CSV format is not supported. Please upload an Excel sheet (.xlsx).",
        )

    if not (
        lower_filename.endswith(".xlsx")
        or lower_filename.endswith(".xls")
        or "spreadsheet" in (file.content_type or "").lower()
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Please upload a Microsoft Excel (.xlsx) file.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    import io
    import json
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read Excel file. The file may be corrupt or invalid: {str(e)}",
        )

    ws = wb.active
    if not ws:
        raise HTTPException(status_code=400, detail="No active worksheet found in Excel file.")

    raw_rows = []
    for row in ws.iter_rows(values_only=True):
        if any(c is not None and str(c).strip() != "" for c in row):
            raw_rows.append([str(c).strip() if c is not None else "" for c in row])

    if not raw_rows:
        raise HTTPException(status_code=400, detail="The Excel sheet contains no rows of data.")

    header_row = raw_rows[0]
    headers = [str(h).strip().lower().replace(" ", "_") for h in header_row]

    expected_key_columns = {
        "operator_email",
        "email",
        "assigned_email",
        "operator",
        "user_email",
        "verifier_email",
        "audit_user",
        "auditor_email",
        "coordinates",
        "coordinate",
        "site_address",
        "address",
        "unique_id",
        "uid",
        "street_address",
        "street",
        "survey_no",
        "survey_number",
        "village",
        "taluk",
        "district",
    }
    if not any(h in expected_key_columns for h in headers):
        raise HTTPException(
            status_code=400,
            detail=(
                "Unrecognized sheet format: None of the expected task columns "
                "(such as 'operator_email', 'coordinates', 'site_address', or 'unique_id') were found. "
                "Please download and use the official template."
            ),
        )

    data_rows = raw_rows[1:]
    total_data_rows = len(data_rows)

    def event_stream():
        from app.services.gmap_snapshot_service import generate_snapshots_for_records
        from app.services.village_master_service import get_village_master_service

        vms = get_village_master_service()
        user_repo = UserRepository(db)
        record_service = RecordService(db)

        email_cache = {}
        created_records = []
        dispatched_tasks = []
        errors = []
        auto_resolved_count = 0

        yield json.dumps({
            "type": "init",
            "total_rows": total_data_rows,
            "sheet_name": ws.title or "Sheet1",
            "filename": filename,
        }) + "\n"

        for idx, row in enumerate(data_rows, start=1):
            excel_row_num = idx + 1
            row_dict = {headers[i]: row[i] if i < len(row) else "" for i in range(len(headers))}

            if not any(v.strip() for v in row_dict.values()):
                continue

            audit_email = (
                row_dict.get("audit_user")
                or row_dict.get("auditor_email")
                or ""
            ).strip().lower()
            routed_auditor = None
            if audit_email:
                if audit_email in email_cache:
                    routed_auditor = email_cache[audit_email]
                else:
                    routed_auditor = user_repo.get_by_email(audit_email)
                    email_cache[audit_email] = routed_auditor
                if not routed_auditor:
                    err = {
                        "row": excel_row_num,
                        "column": "audit_user",
                        "message": f"Auditor with email '{audit_email}' does not exist in the system.",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue
                audit_role = (
                    routed_auditor.role.value
                    if hasattr(routed_auditor.role, "value")
                    else str(routed_auditor.role)
                )
                if audit_role != "AUDITOR" or not routed_auditor.is_active:
                    err = {
                        "row": excel_row_num,
                        "column": "audit_user",
                        "message": f"'{audit_email}' is a {audit_role} account — audit_user must be an active auditor.",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue

            op_email = (
                row_dict.get("operator_email")
                or row_dict.get("email")
                or row_dict.get("assigned_email")
                or row_dict.get("user_email")
                or row_dict.get("operator")
                or row_dict.get("verifier_email")
                or ""
            ).strip().lower()

            target_user = None
            if op_email:
                if op_email in email_cache:
                    target_user = email_cache[op_email]
                else:
                    target_user = user_repo.get_by_email(op_email)
                    email_cache[op_email] = target_user

                if not target_user:
                    err = {
                        "row": excel_row_num,
                        "column": "operator_email",
                        "message": f"Operator with email '{op_email}' does not exist in the system.",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue
                target_role = (
                    target_user.role.value
                    if hasattr(target_user.role, "value")
                    else str(target_user.role)
                )
                if target_role not in ("USER", "FIELD_VERIFIER") or not target_user.is_active:
                    err = {
                        "row": excel_row_num,
                        "column": "operator_email",
                        "message": f"'{op_email}' is a {target_role} account — tasks can only be dispatched to active field operators (USER) or field verifiers (FIELD_VERIFIER).",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue
            else:
                user_id_val = row_dict.get("user_id") or row_dict.get("userid")
                if user_id_val and str(user_id_val).strip().isdigit():
                    uid = int(str(user_id_val).strip())
                    target_user = user_repo.get_by_id(uid)
                    if not target_user:
                        err = {
                            "row": excel_row_num,
                            "column": "user_id",
                            "message": f"User ID {uid} does not exist in the system.",
                        }
                        errors.append(err)
                        yield json.dumps({
                            "type": "row_error",
                            "row_index": idx,
                            "total_rows": total_data_rows,
                            "percent": round((idx / total_data_rows) * 100),
                            "error": err,
                        }) + "\n"
                        continue
                elif mode == "history":
                    err = {
                        "row": excel_row_num,
                        "column": "operator_email",
                        "message": "Missing operator email. Column 'operator_email' is required for historical records import.",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue

            raw_visit_order = row_dict.get("visit_order") or row_dict.get("order")
            visit_order = None
            if raw_visit_order and str(raw_visit_order).strip().isdigit():
                visit_order = int(str(raw_visit_order).strip())

            unique_id = row_dict.get("unique_id") or row_dict.get("uid") or ""
            cumulative_dist = (
                row_dict.get("distance_km")
                or row_dict.get("distance")
                or ""
            )
            street_address = row_dict.get("street_address") or row_dict.get("street") or ""
            land_use = row_dict.get("land_use") or ""
            survey_no = row_dict.get("survey_no") or row_dict.get("survey_number") or ""
            subdivision_no = row_dict.get("subdivision_no") or row_dict.get("sub_division") or ""
            owner_name_en = row_dict.get("owner_name_en") or row_dict.get("owner_name") or row_dict.get("owner") or ""
            site_address = row_dict.get("site_address") or row_dict.get("address") or ""
            survey_number = row_dict.get("survey_number") or survey_no
            sub_division = row_dict.get("sub_division") or subdivision_no
            taluk = row_dict.get("taluk") or ""
            village = row_dict.get("village") or ""
            district = row_dict.get("district") or ""

            # Coordinates validation
            coords_str = row_dict.get("coordinates") or row_dict.get("coordinate") or ""
            lat_col = row_dict.get("latitude") or row_dict.get("lat") or ""
            lng_col = row_dict.get("longitude") or row_dict.get("lng") or ""
            if lat_col and lng_col:
                coords_str = f"{lat_col}, {lng_col}"

            if coords_str:
                parts = [p.strip() for p in coords_str.split(",") if p.strip()]
                if len(parts) == 2:
                    try:
                        lat_val = float(parts[0])
                        lng_val = float(parts[1])
                        if not (-90 <= lat_val <= 90 and -180 <= lng_val <= 180):
                            err = {
                                "row": excel_row_num,
                                "column": "coordinates",
                                "message": f"Coordinates out of range: '{coords_str}'. Latitude must be -90..90, Longitude -180..180.",
                            }
                            errors.append(err)
                            yield json.dumps({
                                "type": "row_error",
                                "row_index": idx,
                                "total_rows": total_data_rows,
                                "percent": round((idx / total_data_rows) * 100),
                                "error": err,
                            }) + "\n"
                            continue
                    except ValueError:
                        err = {
                            "row": excel_row_num,
                            "column": "coordinates",
                            "message": f"Invalid coordinate numbers '{coords_str}'. Must be decimal values.",
                        }
                        errors.append(err)
                        yield json.dumps({
                            "type": "row_error",
                            "row_index": idx,
                            "total_rows": total_data_rows,
                            "percent": round((idx / total_data_rows) * 100),
                            "error": err,
                        }) + "\n"
                        continue
                else:
                    err = {
                        "row": excel_row_num,
                        "column": "coordinates",
                        "message": f"Invalid coordinate format '{coords_str}'. Expected 'lat, lng'.",
                    }
                    errors.append(err)
                    yield json.dumps({
                        "type": "row_error",
                        "row_index": idx,
                        "total_rows": total_data_rows,
                        "percent": round((idx / total_data_rows) * 100),
                        "error": err,
                    }) + "\n"
                    continue

            # ── Auto-resolve Village / Taluk / District using Master Sheet ──
            was_auto_resolved = False
            resolution_method = None
            if not (taluk.strip() and village.strip() and district.strip()):
                res = vms.resolve_record_location(
                    village=village,
                    taluk=taluk,
                    district=district,
                    coordinates=coords_str,
                    site_address=site_address,
                    street_address=street_address,
                )
                taluk = res["taluk"]
                village = res["village"]
                district = res["district"]
                was_auto_resolved = res["resolved"]
                resolution_method = res["method"]
                if was_auto_resolved:
                    auto_resolved_count += 1
                if res.get("formatted_address"):
                    if not street_address:
                        street_address = res["formatted_address"]
                    if not site_address:
                        site_address = res["formatted_address"]

            record_name = unique_id or (
                f"Site Visit - {site_address[:30]}"
                if site_address
                else f"Visit #{visit_order or idx}"
            )
            record_desc = (
                f"Assigned inspection for {owner_name_en or 'owner'} at "
                f"{site_address or street_address or 'site'}"
            )

            if mode == "history":
                record_desc = (
                    f"Backfilled inspection for {owner_name_en or 'owner'} at "
                    f"{site_address or street_address or 'site'}"
                )
                record_status = "COMPLETED"
            else:
                record_status = "NOT_COMPLETED"

            staged_operator_id = (
                target_user.id if (mode == "dispatch" and target_user) else None
            )
            assigned_user_id = (
                None if mode == "dispatch" else (target_user.id if target_user else None)
            )

            extra: dict = {}
            if mode == "dispatch":
                extra["audit_status"] = "PENDING"
                if routed_auditor is not None:
                    extra["assigned_auditor_id"] = routed_auditor.id
            if mode == "history":
                for col in (
                    "date_of_visit",
                    "construction_happening",
                    "remarks",
                    "type_of_construction",
                    "relationship_with_building",
                    "building_user_name",
                    "spoken_with",
                    "contact_number",
                    "stage_of_construction",
                    "site_contractor_architect_name",
                    "site_contractor_architect_number",
                    "follow_up_date",
                ):
                    val = str(row_dict.get(col) or "").strip()
                    if val:
                        extra[col] = val

            rec = record_service.create_record(
                user_id=assigned_user_id,
                name=record_name,
                staged_operator_id=staged_operator_id,
                uploaded_by_id=current_user.id,
                description=record_desc,
                status=record_status,
                source="imported" if mode == "history" else "captured",
                    unique_id=unique_id,
                
                coordinates=coords_str,
                street_address=street_address,
                land_use=land_use,
                survey_no=survey_no,
                subdivision_no=subdivision_no,
                owner_name_en=owner_name_en,
                site_address=site_address,
                survey_number=survey_number,
                sub_division=sub_division,
                taluk=taluk,
                village=village,
                district=district,
                **extra,
            )
            created_records.append(rec.id)
            dispatched_tasks.append({
                "record_id": rec.id,
                "unique_id": unique_id,
                "operator_email": (
                    target_user.email
                    if target_user
                    else (routed_auditor.email if routed_auditor else None)
                ),
                "operator_name": (
                    target_user.full_name
                    if target_user
                    else (routed_auditor.full_name if routed_auditor else None)
                ),
                "auditor_email": routed_auditor.email if routed_auditor else None,
                "auditor_name": routed_auditor.full_name if routed_auditor else None,
                "site_address": site_address or street_address,
                "village": village,
                "taluk": taluk,
                "district": district,
                "staged": mode == "dispatch",
            })

            pct = round((idx / total_data_rows) * 100)
            yield json.dumps({
                "type": "progress",
                "row_index": idx,
                "total_rows": total_data_rows,
                "percent": pct,
                "record_id": rec.id,
                "unique_id": unique_id,
                "name": record_name,
                "village": village,
                "taluk": taluk,
                "district": district,
                "auto_resolved": was_auto_resolved,
                "resolution_method": resolution_method,
                "status": f"Imported #{rec.id} ({unique_id or record_name})"
                + (f" → Auto-filled: {village}, {taluk}" if was_auto_resolved else ""),
            }) + "\n"

        if created_records:
            try:
                import threading
                from app.services.gmap_snapshot_service import generate_snapshots_for_records
                threading.Thread(
                    target=generate_snapshots_for_records,
                    args=(list(created_records),),
                    kwargs={"zoom": 18},
                    daemon=True,
                ).start()
            except Exception as e:
                logger.warning("Snapshot generation background error: %s", e)

            try:
                log_activity(
                    db=db,
                    action_type="task_dispatch" if mode == "dispatch" else "previous_records_import",
                    type="record",
                    title=(
                        "Historical field data imported"
                        if mode == "history"
                        else "Task dispatch sheet uploaded"
                    ),
                    detail=(
                        f"{len(created_records)} task(s) imported from '{filename}'. "
                        f"{auto_resolved_count} records had missing Village/Taluk/District auto-resolved from Village Master."
                    ),
                    user_id=current_user.id,
                    user_name=current_user.full_name,
                    status="success",
                )
            except Exception as e:
                logger.warning("Activity log failed: %s", e)

        yield json.dumps({
            "type": "done",
            "result": {
                "success": len(created_records) > 0,
                "total_rows": total_data_rows,
                "total_dispatched": len(created_records),
                "failed_count": len(errors),
                "auto_resolved_count": auto_resolved_count,
                "sheet_name": ws.title or "Sheet1",
                "errors": errors,
                "dispatched_tasks": dispatched_tasks,
            },
        }) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


# ─── Import Previous Records (old field work, backfilled by an admin) ──
def _parse_previous_records_sheet(db: Session, file: UploadFile, content: bytes):
    """Validate + parse an uploaded legacy field-records sheet.

    Raises HTTPException(400) for whole-file problems; per-row problems come
    back inside the parsed sheet as row-level validation errors.
    """
    from app.services.previous_records_import_service import (
        PreviousRecordsImportService,
        SheetImportError,
    )

    service = PreviousRecordsImportService(db)
    try:
        return service, service.parse(file.filename or "", file.content_type, content)
    except SheetImportError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)


@router.get("/records/import-previous/template")
async def download_previous_template(admin: User = Depends(require_admin)):
    from pathlib import Path
    path = Path(__file__).parent.parent / "templates" / "previous_records_template.xlsx"
    if path.exists():
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="previous_records_template.xlsx",
        )
    import io
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Previous Records"
    ws.views.sheetView[0].showGridLines = True
    headers = [
        "operator_email", "unique_id", "coordinates", "site_address",
        "street_address", "village", "taluk", "district", "survey_no", "subdivision_no",
        "land_use", "owner_name_en", "date_of_visit",
        "construction_happening", "type_of_construction", "stage_of_construction",
        "building_user_name", "relationship_with_building", "spoken_with", "contact_number",
        "site_contractor_architect_name", "site_contractor_architect_number", "remarks",
    ]
    sample_rows = [
        [
            "operator1@company.com", 1, "PREV-1001", "11.016844, 76.955832",
            "142/3A, Trichy Road, Kurichy, Coimbatore", "Trichy Road", "Kurichy",
            "Coimbatore South", "Coimbatore", "142/3A", "1", "Residential", "Ramesh Kumar",
            "2.5", "2024-03-15", "Yes", "Residential", "Roof Level", "Ramesh Kumar", "Owner",
            "9876543210", "Suresh Builders", "9876500001", "Construction in progress, boundary wall completed",
        ],
        [
            "operator1@company.com", 2, "PREV-1002", "11.040756, 77.030313",
            "89/1, Avinashi Road, Saravanampatty, Coimbatore", "Avinashi Road", "Saravanampatty",
            "Coimbatore North", "Coimbatore", "89/1", "2", "Commercial", "Suresh Reddy",
            "5.1", "2024-03-16", "No", "Commercial", "Vacant Plot", "Suresh Reddy", "Owner",
            "9876543211", "", "", "Vacant plot, no active construction observed",
        ],
    ]
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)
    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment
    data_font = Font(name="Segoe UI", size=10)
    data_alignment = Alignment(vertical="center")
    cell_border = Border(left=Side(style="thin", color="E2E8F0"), right=Side(style="thin", color="E2E8F0"), top=Side(style="thin", color="E2E8F0"), bottom=Side(style="thin", color="E2E8F0"))
    for r_idx, row in enumerate(sample_rows, start=2):
        ws.append(row)
        ws.row_dimensions[r_idx].height = 22
        for col_num in range(1, len(row) + 1):
            cell = ws.cell(row=r_idx, column=col_num)
            cell.font = data_font
            cell.alignment = data_alignment
            cell.border = cell_border
    ws.freeze_panes = "A2"
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="previous_records_template.xlsx"'},
    )


@router.post("/records/import-previous/preview")
async def preview_previous_records_sheet(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Dry-run an old field-records Excel sheet: validate every row, write nothing.

    Returns per-row values with their validation errors so the admin can review
    the data before a single record reaches the database.
    """
    content = await file.read()
    _, parsed = _parse_previous_records_sheet(db, file, content)
    summary = parsed.summary()
    logger.info(
        "Previous-records preview by admin %s: %s valid / %s invalid rows",
        admin.id,
        summary["valid_count"],
        summary["invalid_count"],
    )
    return summary


@router.post("/records/import-previous/commit")
async def import_previous_records_sheet(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Import the valid rows of an old field-records sheet into the records table.

    Every imported row is flagged ``source="imported"`` so it appears in the
    same Records table as field-captured records, clearly marked as uploaded.
    Rows with validation errors are reported and skipped — never half-written.
    """
    content = await file.read()
    service, parsed = _parse_previous_records_sheet(db, file, content)
    report = service.import_rows(parsed, admin)

    # Pull each imported site's Google Maps satellite image into the shared
    # snapshot cache while the sheet is still fresh. Runs after the response so
    # a slow tile download can never delay or fail the import itself.
    if report["imported_count"]:
        from app.services.gmap_snapshot_service import generate_snapshots_for_records

        background_tasks.add_task(
            generate_snapshots_for_records, [row["record_id"] for row in report["records"]]
        )

    if report["imported_count"]:
        first = report["records"][0]
        log_activity(
            db=db,
            action_type="previous_records_import",
            type="record",
            title="Previous field records imported",
            detail=(
                f"{report['imported_count']} old field record(s) imported from "
                f"'{report['sheet_name']}' by {admin.full_name}"
            ),
            user_id=admin.id,
            user_name=admin.full_name,
            record_id=first["record_id"],
            record_name=first["unique_id"] or f"Record #{first['record_id']}",
            status="success",
        )

    return report


@router.post("/records/{record_id}/photos", response_model=RecordDetail)
async def admin_upload_record_photos(
    record_id: int,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Attach admin-uploaded site photos to an imported (old) field record.

    The bytes go through the same resize/JPEG pipeline as the mobile field app,
    but the stamp is the admin-side one — "Uploaded by <admin email>": the photo
    was not taken on a device, so it carries no borrowed GPS/time telemetry.
    Photos are appended after any existing frames, never replacing them.
    """
    from app.routers.records import canonical_photo_name
    from app.services.image_service import ImageService
    from app.services.previous_records_import_service import parse_coordinates, parse_visit_datetime

    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    image_repo = ImageRepository(db)
    existing_images = image_repo.get_by_record_id(record_id)

    # GPS: kept on the row for the map + verification section, but the admin
    # stamp never claims a device fix, so nothing here is burned into the
    # pixels. Old paper records rarely carry GPS at all.
    parsed = parse_coordinates(record.coordinates)
    # Accuracy is only known when it comes from a real device fix; coordinates
    # typed into the old register carry no accuracy.
    accuracy: Optional[float] = None
    if parsed is None:
        first_fix = next(
            (
                img
                for img in sorted(existing_images, key=lambda i: i.photo_order)
                if img.latitude and img.longitude and (img.latitude != 0 or img.longitude != 0)
            ),
            None,
        )
        if first_fix is not None:
            parsed = (first_fix.latitude, first_fix.longitude)
            accuracy = first_fix.location_accuracy or None
    latitude, longitude = parsed if parsed is not None else (0.0, 0.0)

    captured_at = (
        parse_visit_datetime(getattr(record, "date_of_visit", None))
        or record.created_at
        or datetime.now(timezone.utc)
    )
    address = record.formatted_address or record.admin_formatted_address or record.site_address

    image_service = ImageService()
    errors: List[str] = []
    next_order = max((img.photo_order for img in existing_images), default=0) + 1
    saved = 0

    for file in files:
        try:
            content = await file.read()
            if len(content) > settings.max_upload_size_bytes:
                errors.append(f"{file.filename} exceeds max size ({settings.MAX_UPLOAD_SIZE_MB}MB)")
                continue
            if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
                errors.append(f"{file.filename} invalid type: {file.content_type}")
                continue

            processed = image_service.process_image(
                image_bytes=content,
                latitude=latitude,
                longitude=longitude,
                captured_at=captured_at,
                location_name=record.location_name,
                formatted_address=address,
                accuracy=accuracy,
                uploaded=admin.email,
            )

            file_name = canonical_photo_name(record_id, next_order)
            storage_key, storage_type = _store_processed_image(
                processed, file_name, f"{record.user_id}/{record_id}"
            )
            logger.info("Saved imported photo %s via %s: %s", file_name, storage_type, storage_key)

            # Enqueue asynchronous sync to Google Drive
            from app.routers.records import sync_to_drive_background
            background_tasks.add_task(
                sync_to_drive_background,
                file_bytes=processed,
                file_name=file_name,
                folder=f"{record.user_id}/{record_id}",
            )

            image_repo.create(
                record_id=record_id,
                google_drive_file_id=storage_key,
                file_name=file_name,
                photo_order=next_order,
                source="uploaded",
                latitude=latitude,
                longitude=longitude,
                # The column is NOT NULL — 0.0 means "no device radar fix",
                # exactly as the field capture flow records it.
                location_accuracy=accuracy or 0.0,
                captured_at=captured_at,
            )
            next_order += 1
            saved += 1
        except Exception as exc:  # noqa: BLE001 - one bad photo must not fail the batch
            logger.error("Failed to process %s: %s", file.filename, exc, exc_info=True)
            errors.append(f"Error processing {file.filename}")

    record = record_service.get_record(record_id)
    if saved:
        if record.status == "NOT_COMPLETED":
            record.status = "COMPLETED"
            db.commit()
            db.refresh(record)
        log_activity(
            db=db,
            action_type="photo_upload",
            type="photo",
            title=f"{saved} photo{'s' if saved != 1 else ''} uploaded",
            detail=(
                f"{saved} photo(s) uploaded to imported Record #{record.id} "
                f"('{record.name}') by {admin.full_name} and stamped 'Uploaded by {admin.email}'"
            ),
            user_id=admin.id,
            user_name=admin.full_name,
            record_id=record.id,
            record_name=record.name,
            status="success",
        )

    return _record_to_detail(record, errors=errors or None)


@router.get("/records/{record_id}", response_model=RecordDetail)
async def admin_get_record(record_id: int, admin: User = Depends(require_record_manager), db: Session = Depends(get_db)):
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    return _record_to_detail(record)


# ─── Audit workflow (auditor decisions on staged task sheets) ─────────

@router.patch("/records/{record_id}/audit", response_model=RecordDetail)
async def audit_record(
    record_id: int,
    payload: AuditDecisionRequest,
    auditor: User = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Apply an auditor decision to a record.

    APPROVAL releases the staged task to its intended field operator
    (user_id = staged_operator_id) so it appears in their mobile app.
    DISAPPROVAL / COMMERCIAL_PROPERTY keep the record unassigned and
    permanently hidden from field operators. Every decision stores the
    auditor, the timestamp, and the comment for the audit trail.
    """
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    try:
        record = record_service.audit_record(
            record,
            payload.audit_status,
            payload.audit_comment,
            auditor,
            qc_vhr_comment=(payload.qc_vhr_comment or "") if "qc_vhr_comment" in payload.model_fields_set else None,
            qc_street_details=(payload.qc_street_details or "") if "qc_street_details" in payload.model_fields_set else None,
            qc_builder_contact=(payload.qc_builder_contact or "") if "qc_builder_contact" in payload.model_fields_set else None,
            qc_sqfeet=(payload.qc_sqfeet or "") if "qc_sqfeet" in payload.model_fields_set else None,
            coordinates=payload.coordinates,
        )
        if "assigned_auditor_id" in payload.model_fields_set:
            if payload.assigned_auditor_id and payload.assigned_auditor_id > 0:
                record.assigned_auditor_id = payload.assigned_auditor_id
            elif payload.assigned_auditor_id in (0, None):
                record.assigned_auditor_id = None

        # Also persist any field verification attributes provided in the audit request
        field_attrs = [
            "type_of_construction", "stage_of_construction", "remarks",
            "building_user_name", "spoken_with", "contact_number",
            "site_contractor_architect_name", "site_contractor_architect_number",
            "relationship_with_building", "construction_happening", "date_of_visit",
            "follow_up_date",
        ]
        has_field_attr = any(f in payload.model_fields_set for f in field_attrs)
        if has_field_attr:
            for f in field_attrs:
                if f in payload.model_fields_set:
                    val = getattr(payload, f)
                    setattr(record, f, (val.strip() or None) if isinstance(val, str) else val)

        db.commit()
        db.refresh(record)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    titles = {
        "APPROVAL": "Record approved by auditor",
        "DISAPPROVAL": "Record disapproved by auditor",
        "COMMERCIAL_PROPERTY": "Record flagged as commercial property",
        "RE_AUDITED": "Record re-audited / QC updated",
    }
    role_name = auditor.role.value if hasattr(auditor.role, "value") else str(auditor.role)
    log_activity(
        db=db,
        action_type="record_audit",
        type="record",
        title=titles.get(payload.audit_status, "Record audit updated"),
        detail=(
            f"Record #{record.id} ('{record.name}') set to {payload.audit_status} "
            f"by {auditor.full_name} ({role_name})"
            + (f" — comment: {record.audit_comment}" if record.audit_comment else "")
        ),
        user_id=auditor.id,
        user_name=auditor.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    return _record_to_detail(record)


@router.post("/records/bulk-audit", response_model=RecordBulkAuditResponse)
async def bulk_audit_records(
    request: RecordBulkAuditRequest,
    auditor: User = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Apply an audit decision in bulk to selected records.

    Admins and Auditors can perform this action.
    Updates audit_status, audit_comment, audited_by_id, audited_at,
    and assigned_auditor_id (QA User).
    """
    record_service = RecordService(db)
    audited, skipped = 0, 0

    for rid in dict.fromkeys(request.record_ids):
        record = record_service.get_record(rid)
        if not record:
            skipped += 1
            continue
        try:
            record_service.audit_record(
                record=record,
                audit_status=request.audit_status,
                audit_comment=request.audit_comment,
                auditor=auditor,
            )
            audited += 1
        except (ValueError, PermissionError):
            skipped += 1

    decision_labels = {
        "APPROVAL": "Approval",
        "PENDING": "Pending",
        "DISAPPROVAL": "Disapproval",
        "COMMERCIAL_PROPERTY": "Commercial Property",
    }
    label = decision_labels.get(request.audit_status, request.audit_status)
    role_name = auditor.role.value if hasattr(auditor.role, "value") else str(auditor.role)

    log_activity(
        db=db,
        action_type="record_bulk_audit",
        type="record",
        title=f"Bulk audit decision applied: {audited} record(s) -> {label}",
        detail=(
            f"{audited} record(s) marked as {label} by {auditor.full_name} ({role_name}). "
            f"{skipped} skipped (completed or permission error)."
        ),
        user_id=auditor.id,
        user_name=auditor.full_name,
        status="success",
    )

    msg = f"Successfully updated {audited} record(s) to '{label}'."
    if skipped:
        msg += f" {skipped} record(s) skipped."

    return RecordBulkAuditResponse(
        success=True,
        audited_count=audited,
        skipped_count=skipped,
        audit_status=request.audit_status,
        message=msg,
    )


@router.post("/records/bulk-status", response_model=RecordBulkStatusResponse)
async def bulk_status_records(
    request: RecordBulkStatusRequest,
    user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Bulk update verification status on selected records.

    Allows updating verification status to COMPLETED, NOT_COMPLETED,
    NOT_INTERESTED, DUPLICATE, or CONSTRUCTION_FINISHED.
    """
    record_service = RecordService(db)
    updated, skipped = 0, 0

    status_map = {
        "NOT_INTERESTED": "Not Interested",
        "DUPLICATE": "Duplicate",
        "CONSTRUCTION_FINISHED": "Construction Finished",
        "Not Interested": "Not Interested",
        "Duplicate": "Duplicate",
        "Construction Finished": "Construction Finished",
        "COMPLETED": "COMPLETED",
        "PENDING": "NOT_COMPLETED",
        "NOT_COMPLETED": "NOT_COMPLETED",
    }
    canonical_status = status_map.get(request.status, request.status)
    now = datetime.now(timezone.utc)

    for rid in dict.fromkeys(request.record_ids):
        record = record_service.get_record(rid)
        if not record:
            skipped += 1
            continue

        record.status = canonical_status
        if canonical_status == "COMPLETED" and record.revisit_status in ("REASSIGNED", "PENDING_REVISIT"):
            record.revisit_status = "COMPLETED"

        record.updated_by_id = user.id
        record.updated_by_name = user.full_name or user.username
        record.updated_by_role = user.role.value if hasattr(user.role, "value") else str(user.role)
        record.updated_at = now

        if request.remarks:
            cleaned = request.remarks.strip()
            if cleaned:
                if record.remarks:
                    record.remarks = f"{record.remarks}\n[Status: {canonical_status}] {cleaned}"
                else:
                    record.remarks = f"[Status: {canonical_status}] {cleaned}"

        db.add(record)
        updated += 1

    db.commit()

    role_name = user.role.value if hasattr(user.role, "value") else str(user.role)
    log_activity(
        db=db,
        action_type="record_bulk_status",
        type="record",
        title=f"Bulk verification status updated: {updated} record(s) -> {canonical_status}",
        detail=f"{updated} record(s) marked as {canonical_status} by {user.full_name} ({role_name}). {skipped} skipped." + (f" Remarks: {request.remarks}" if request.remarks else ""),
        user_id=user.id,
        user_name=user.full_name,
        status="success",
    )

    msg = f"Successfully updated {updated} record(s) to '{canonical_status}'."
    if skipped:
        msg += f" {skipped} record(s) skipped."

    return RecordBulkStatusResponse(
        success=True,
        updated_count=updated,
        skipped_count=skipped,
        status=canonical_status,
        message=msg,
    )


@router.get("/records/{record_id}/export")
async def admin_export_full_record(record_id: int, admin: User = Depends(require_record_manager), db: Session = Depends(get_db)):
    record = RecordService(db).get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    from app.services.record_excel_service import build_record_excel
    content = build_record_excel(record, _record_to_detail(record).model_dump(mode='json'))
    log_activity(db=db, action_type='record_download', type='record', title='Full record exported to Excel',
                 detail=f'Record #{record.id}', user_id=admin.id, user_name=admin.full_name,
                 record_id=record.id, record_name=record.name, status='success')
    return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': f'attachment; filename="Record_{record.id}_full.xlsx"'})


@router.post("/records/{record_id}/resolve-address", response_model=AddressResolveResponse)
async def admin_resolve_record_address(
    record_id: int,
    force: bool = Query(False, description="Re-resolve even if an address is already stored"),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Resolve the Google Geocoding address for a record from its captured GPS."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    record, error = record_service.resolve_address(record, force=force)
    from app.services.record_service import compute_record_deviation
    deviation = compute_record_deviation(record)

    return AddressResolveResponse(
        resolved=bool(record.formatted_address),
        address=record.formatted_address,
        admin_address=record.admin_formatted_address,
        place_name=record.location_name,
        deviation_meters=deviation.get("distance_meters") if deviation else None,
        deviation_formatted=deviation.get("formatted") if deviation else None,
        deviation_status=deviation.get("status") if deviation else None,
        error=error,
    )


@router.get("/records/{record_id}/images")
async def admin_get_record_images(
    record_id: int, admin: User = Depends(require_record_manager), db: Session = Depends(get_db)
):
    image_repo = ImageRepository(db)
    images = image_repo.get_by_record_id(record_id)
    return [
        ImageDetail(
            id=img.id,
            google_drive_file_id=img.google_drive_file_id,
            file_name=img.file_name,
            photo_order=img.photo_order,
                source=getattr(img, "source", "camera"),
            latitude=img.latitude,
            longitude=img.longitude,
            location_accuracy=img.location_accuracy,
            captured_at=img.captured_at,
            created_at=img.created_at,
            # Admin uses same serve endpoint so images render in the UI
            image_url=f"/api/admin/records/{record_id}/image/{img.id}",
        )
        for img in images
    ]


@router.get("/records/{record_id}/image/{image_id}")
async def admin_get_image(
    record_id: int,
    image_id: int,
    thumb: bool = Query(False, description="Serve lightweight thumbnail if available"),
    download: bool = Query(False, description="Log activity as photo download"),
    admin: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Serve image file: streams local file (or thumbnail) or redirects to Google Drive download URL."""
    image_repo = ImageRepository(db)
    image = image_repo.get_by_record_and_image_id(record_id, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    if download:
        record_service = RecordService(db)
        record = record_service.get_record(record_id)
        role_name = admin.role.value.capitalize() if hasattr(admin.role, "value") else str(admin.role).capitalize()
        rec_name = record.name if record else f"Record #{record_id}"
        log_activity(
            db=db,
            action_type="photo_download",
            type="photo",
            title="Photo downloaded by Admin",
            detail=f"Photo '{image.file_name}' (Order #{image.photo_order}) from Record #{record_id} ('{rec_name}') downloaded by {admin.full_name} ({role_name})",
            user_id=admin.id,
            user_name=admin.full_name,
            record_id=record_id,
            record_name=rec_name,
            status="success",
        )

    storage_key = image.google_drive_file_id

    if storage_key.startswith("pending:"):
        raise HTTPException(status_code=404, detail="Image not yet uploaded")

    if storage_key.startswith("simulated-"):
        raise HTTPException(status_code=404, detail="Image not available (simulated upload)")

    cache_headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": f'"{image.id}-{"thumb" if thumb else "full"}"',
    }

    # Local storage: has path separators (/ or \)
    if "/" in storage_key or "\\" in storage_key:
        local = LocalStorageService()
        file_path = None
        if thumb:
            file_path = local.get_thumbnail_path(storage_key)
        if not file_path:
            file_path = local.get_file_path(storage_key)
        if not file_path:
            raise HTTPException(status_code=404, detail="Image file not found")
        content_disposition = "attachment" if download else "inline"
        return FileResponse(
            file_path,
            media_type="image/jpeg",
            filename=image.file_name,
            content_disposition_type=content_disposition,
            headers=cache_headers,
        )

    # Check local fallback even if storage_key is Drive ID
    local = LocalStorageService()
    candidate_local_path = f"{record.user_id}/{record_id}/{image.file_name}"
    local_path = None
    if thumb:
        local_path = local.get_thumbnail_path(candidate_local_path)
    if not local_path:
        local_path = local.get_file_path(candidate_local_path)
    if local_path:
        content_disposition = "attachment" if download else "inline"
        return FileResponse(
            local_path,
            media_type="image/jpeg",
            filename=image.file_name,
            content_disposition_type=content_disposition,
            headers=cache_headers,
        )

    # Google Drive file ID (no separators — just alphanumeric)
    try:
        from app.services.google_drive_service import GoogleDriveService
        drive = GoogleDriveService()
        if drive.service:
            content = drive.service.files().get_media(fileId=storage_key).execute()
            disposition = "attachment" if download else "inline"
            return Response(content=content, media_type="image/jpeg", headers={
                "Content-Disposition": f'{disposition}; filename="{image.file_name}"',
                **cache_headers,
            })
    except Exception as e:
        logger.error(f"Failed to download from Drive: {e}")
    raise HTTPException(status_code=404, detail="Image not available from Drive")


@router.get("/records/{record_id}/gmap-image")
async def admin_get_gmap_image(
    record_id: int,
    zoom: Optional[int] = Query(None, ge=15, le=21, description="Satellite tile zoom level"),
    thumb: bool = Query(False, description="Serve the small list-view thumbnail"),
    admin: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Serve the record's Google Maps satellite snapshot (importer / auditor panels).

    Snapshots are downloaded once and cached per location + zoom. A record that
    predates this feature — or a zoom never built for it — is generated on the
    spot and then reused by every later viewer.
    """
    from app.services.gmap_snapshot_service import (
        GmapSnapshotService,
        clamp_zoom,
        ensure_record_snapshot,
        parse_record_coordinates,
        zoom_from_key,
    )

    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    local = LocalStorageService()
    snapshot = GmapSnapshotService()
    coordinates = parse_record_coordinates(record)
    requested_zoom = clamp_zoom(zoom if zoom is not None else getattr(record, "gmap_zoom", None))

    storage_key = None
    if coordinates:
        candidate = snapshot.stored_key(coordinates[0], coordinates[1], requested_zoom)
        if local.get_file_path(candidate):
            storage_key = candidate  # cached already — reuse, never re-download
    if storage_key is None:
        ensure_record_snapshot(db, record, zoom=zoom)
        storage_key = getattr(record, "gmap_image_key", None)
    if not storage_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No satellite snapshot available — the record has no usable coordinates.",
        )

    file_path = local.get_thumbnail_path(storage_key) if thumb else None
    if not file_path:
        file_path = local.get_file_path(storage_key)
    if not file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Satellite snapshot file not found")

    # The served file's own zoom, so the viewer pins the site on the picture it
    # actually received (a cached snapshot may predate the requested zoom).
    served_zoom = zoom_from_key(storage_key) or requested_zoom
    return FileResponse(
        file_path,
        media_type="image/jpeg",
        filename=f"Record_{record_id}_Satellite.jpg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"gmap-{record_id}-{served_zoom}-{"thumb" if thumb else "full"}"',
            "X-Gmap-Zoom": str(served_zoom),
        },
    )


@router.post("/records/{record_id}/gmap-image", response_model=RecordDetail)
async def admin_generate_gmap_image(
    record_id: int,
    zoom: Optional[int] = Query(None, ge=15, le=21, description="Satellite tile zoom level"),
    refresh: bool = Query(False, description="Re-download tiles even if a cached snapshot exists"),
    admin: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Download (or re-download) the record's Google Maps satellite snapshot.

    Also fills an empty street address from the Google Geocoding API, so a sheet
    row that arrived with coordinates but no address still shows where it is.
    """
    from app.services.gmap_snapshot_service import ensure_record_snapshot

    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    stored = ensure_record_snapshot(db, record, zoom=zoom, refresh=refresh)
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Could not build a satellite snapshot. The record needs coordinates "
                "and the server needs outbound access to Google Maps tiles."
            ),
        )

    log_activity(
        db=db,
        action_type="gmap_snapshot",
        type="record",
        title="Google Maps satellite image saved",
        detail=(
            f"Satellite snapshot for Record #{record.id} ('{record.name}') "
            f"stored at zoom {getattr(record, 'gmap_zoom', None)} by {admin.full_name}"
        ),
        user_id=admin.id,
        user_name=admin.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    return _record_to_detail(record)


@router.post("/records/{record_id}/image/{image_id}/log-download", response_model=SimpleMessageResponse)
async def admin_log_image_download(
    record_id: int,
    image_id: int,
    admin: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Log an audit event when an admin downloads a photo from the record viewer."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    image_repo = ImageRepository(db)
    image = image_repo.get_by_record_and_image_id(record_id, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    role_name = admin.role.value.capitalize() if hasattr(admin.role, "value") else str(admin.role).capitalize()
    log_activity(
        db=db,
        action_type="photo_download",
        type="photo",
        title="Photo downloaded by Admin",
        detail=f"Photo '{image.file_name}' (Order #{image.photo_order}) from Record #{record.id} ('{record.name}') downloaded by {admin.full_name} ({role_name})",
        user_id=admin.id,
        user_name=admin.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    return SimpleMessageResponse(message="Download logged successfully")


@router.put("/records/{record_id}", response_model=RecordDetail)
async def admin_update_record(
    record_id: int, request: RecordUpdateRequest,
    admin: User = Depends(require_record_manager), db: Session = Depends(get_db),
):
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

    if admin.role.value == "MANAGER":
        raise HTTPException(status_code=403, detail="Managers can only view and assign records")

    if admin.role.value == "AUDITOR":
        if record.assigned_auditor_id not in (None, admin.id) and ("assigned_auditor_id" not in request.model_fields_set or request.assigned_auditor_id != admin.id):
            raise HTTPException(status_code=403, detail="This record is assigned to another QA reviewer")

    update_kwargs = {}
    if admin.role.value == "AUDITOR" and record.assigned_auditor_id is None and "assigned_auditor_id" not in request.model_fields_set:
        update_kwargs["assigned_auditor_id"] = admin.id

    for f in [
        "name", "description", "status",
        "unique_id", "coordinates",
        "street_address", "land_use", "survey_no", "subdivision_no", "owner_name_en",
        "site_address", "survey_number", "sub_division", "taluk", "village", "district",
        "date_of_visit", "construction_happening", "remarks", "type_of_construction",
        "relationship_with_building", "building_user_name", "spoken_with", "contact_number", "stage_of_construction",
        "no_of_floors", "built_up_area", "expected_completion",
        "site_contractor_architect_name", "site_contractor_architect_number", "follow_up_date",
        "audit_status", "audit_comment",
        "qc_vhr_comment", "qc_street_details", "qc_builder_contact", "qc_sqfeet",
        "qc_reference_image_key", "qc_reference_image_url",
        "telecaller_status", "telecaller_comment",
        "telecaller_no_of_floors", "telecaller_expected_completion", "telecaller_built_up_area", "telecaller_stage_of_construction",
        "updated_coordinates", "revisit_status", "updated_information",
    ]:
        val = getattr(request, f, None)
        if val is not None:
            update_kwargs[f] = val

    if "updated_coordinates" in update_kwargs and update_kwargs["updated_coordinates"]:
        # Ensure coordinates is kept in sync with the latest visit/revisit coordinates
        if "coordinates" not in update_kwargs:
            update_kwargs["coordinates"] = update_kwargs["updated_coordinates"]

    # Handle assigned_auditor_id (0 or None means unassign)
    if "assigned_auditor_id" in request.model_fields_set:
        auditor_id = request.assigned_auditor_id
        update_kwargs["assigned_auditor_id"] = auditor_id if auditor_id and auditor_id > 0 else None

    # Handle assigned_telecaller_id (0 or None means unassign)
    if "assigned_telecaller_id" in request.model_fields_set:
        telecaller_id = request.assigned_telecaller_id
        update_kwargs["assigned_telecaller_id"] = telecaller_id if telecaller_id and telecaller_id > 0 else None

    # If QC fields are updated, update qc timestamps
    has_qc_update = any(k in update_kwargs for k in ["qc_vhr_comment", "qc_street_details", "qc_builder_contact", "qc_sqfeet", "qc_reference_image_key", "qc_reference_image_url"])
    if has_qc_update:
        now_utc = datetime.now(timezone.utc)
        update_kwargs["qc_edited_at"] = now_utc
        if not record.qc_completed_at:
            update_kwargs["qc_completed_at"] = now_utc
        if not record.qc_by_id:
            update_kwargs["qc_by_id"] = admin.id

    # If telecaller status or comment is updated
    if "telecaller_status" in update_kwargs or "telecaller_comment" in update_kwargs:
        if update_kwargs.get("telecaller_comment"):
            update_kwargs["telecaller_comment"] = normalize_to_table(update_kwargs["telecaller_comment"])
        now_utc = datetime.now(timezone.utc)
        update_kwargs["telecaller_called_at"] = request.telecaller_called_at or now_utc
        if not record.telecaller_by_id:
            update_kwargs["telecaller_by_id"] = admin.id

    # If audit decision is updated
    if "audit_status" in update_kwargs and update_kwargs["audit_status"] != record.audit_status:
        now_utc = datetime.now(timezone.utc)
        update_kwargs["audited_at"] = now_utc
        update_kwargs["audited_by_id"] = admin.id

    if update_kwargs:
        update_kwargs["updated_by_id"] = admin.id
        update_kwargs["updated_by_name"] = admin.full_name or admin.username
        update_kwargs["updated_by_role"] = admin.role.value if hasattr(admin.role, 'value') else str(admin.role)
        update_kwargs["updated_at"] = datetime.now(timezone.utc)
        record = record_service.record_repo.update(record, touch_updated_at=False, **update_kwargs)

    # Auto-route to telecaller if phone contact exists and sole active telecaller is present
    has_contact = bool(
        (record.contact_number and record.contact_number.strip() and record.contact_number.strip() != "-") or
        (record.site_contractor_architect_number and record.site_contractor_architect_number.strip() and record.site_contractor_architect_number.strip() != "-")
    )
    if has_contact and not record.assigned_telecaller_id:
        active_telecallers = (
            db.query(User)
            .filter(User.role == UserRole.TELECALLER, User.is_active == True)
            .all()
        )
        if len(active_telecallers) == 1:
            record = record_service.record_repo.update(
                record, assigned_telecaller_id=active_telecallers[0].id
            )

    role_name = admin.role.value.capitalize() if hasattr(admin.role, "value") else str(admin.role).capitalize()
    
    # Granular action classification for accurate record history
    has_field_update = any(
        k in update_kwargs
        for k in [
            "construction_happening", "date_of_visit", "type_of_construction",
            "stage_of_construction", "no_of_floors", "built_up_area",
            "expected_completion", "relationship_with_building", "building_user_name",
            "spoken_with", "contact_number", "site_contractor_architect_name",
            "site_contractor_architect_number", "remarks", "follow_up_date",
        ]
    )
    if has_field_update:
        action_type = "field_verification_update"
        action_title = "Field verification updated"
        action_detail = f"Field verification for Record #{record.id} ('{record.name}') updated by {admin.full_name} ({role_name})"
    elif has_qc_update or ("audit_status" in update_kwargs):
        action_type = "qc_assessment_update"
        action_title = "QC assessment updated"
        action_detail = f"QC assessment for Record #{record.id} ('{record.name}') updated by {admin.full_name} ({role_name})"
    elif any(k.startswith("telecaller_") for k in update_kwargs):
        action_type = "telecaller_update"
        action_title = "Telecaller feedback updated"
        action_detail = f"Telecaller verification for Record #{record.id} ('{record.name}') updated by {admin.full_name} ({role_name})"
    else:
        action_type = "record_edit"
        action_title = "Field record updated"
        action_detail = f"Record #{record.id} ('{record.name}') updated by {admin.full_name} ({role_name})"

    log_activity(
        db=db,
        action_type=action_type,
        type="record",
        title=action_title,
        detail=action_detail,
        user_id=admin.id,
        user_name=admin.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    return _record_to_detail(record)


@router.delete("/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_record(
    record_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    rec_id = record.id
    rec_name = record.name
    photo_count = len(record.images or [])
    role_name = admin.role.value.capitalize() if hasattr(admin.role, "value") else str(admin.role).capitalize()
    record_service.delete_record(record)
    log_activity(
        db=db,
        action_type="record_delete",
        type="record",
        title="Field record deleted",
        detail=f"Record #{rec_id} ('{rec_name}') and {photo_count} photo(s) permanently deleted by {admin.full_name} ({role_name})",
        user_id=admin.id,
        user_name=admin.full_name,
        record_id=rec_id,
        record_name=rec_name,
        status="success",
    )


@router.get("/locations")
async def admin_get_locations(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    record_search: Optional[str] = Query(None, max_length=200),
    location_search: Optional[str] = Query(None, max_length=200),
    user_id: Optional[int] = Query(None, ge=1),
    current_user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    """Map pins. Task importers and auditors get read access alongside admins/managers."""
    return RecordService(db).get_all_locations(
        date_from=date_from,
        date_to=date_to,
        record_search=record_search,
        location_search=location_search,
        user_id=user_id,
    )


# ─── Helpers ──────────────────────────────────────────────────────────
def _record_to_detail(record, errors: Optional[List[str]] = None) -> RecordDetail:
    from app.services.record_service import compute_record_deviation
    deviation = compute_record_deviation(record)
    assigned_at = getattr(record, "assigned_at", None) or record.created_at
    assigned_date = (
        assigned_at.strftime("%Y-%m-%d")
        if hasattr(assigned_at, "strftime")
        else (str(assigned_at)[:10] if assigned_at else None)
    )

    try:
        last_modified = record.last_modified_at if hasattr(record, "last_modified_at") else (getattr(record, "reassigned_at", None) or getattr(record, "assigned_at", None) or record.created_at)
    except Exception:
        last_modified = getattr(record, "reassigned_at", None) or getattr(record, "assigned_at", None) or record.created_at
    updated_at = getattr(record, "updated_at", None) or last_modified

    return RecordDetail(
        id=record.id,
        is_manually_added=record.is_manually_added,
        user_id=record.user_id,
        user_name=record.user.full_name if record.user else None,
        name=record.name,
        description=record.description,
        location_name=record.location_name,
        formatted_address=record.formatted_address,
        place_id=record.place_id,
        # Address resolved from the admin-given coordinates — the same field the
        # records endpoint already returns, so the admin viewer is never blank.
        admin_formatted_address=getattr(record, "admin_formatted_address", None),
        deviation_meters=deviation.get("distance_meters") if deviation else None,
        deviation_formatted=deviation.get("formatted") if deviation else None,
        deviation_status=deviation.get("status") if deviation else None,
        created_at=record.created_at,
        updated_at=updated_at,
        last_modified_at=last_modified,
        assigned_at=assigned_at,
        assigned_date=assigned_date,
        field_latitude=getattr(record, "field_latitude", None),
        field_longitude=getattr(record, "field_longitude", None),
        field_location_accuracy=getattr(record, "field_location_accuracy", None),
        field_captured_at=getattr(record, "field_captured_at", None),
        errors=errors,
        source=getattr(record, "source", "captured") or "captured",
        status=getattr(record, "status", "NOT_COMPLETED") or "NOT_COMPLETED",
        updated_by_id=getattr(record, "updated_by_id", None),
        updated_by_name=getattr(record, "updated_by_name", None),
        updated_by_role=getattr(record, "updated_by_role", None),
        unique_id=getattr(record, "unique_id", None),
        coordinates=getattr(record, "coordinates", None),
        street_address=getattr(record, "street_address", None),
        land_use=getattr(record, "land_use", None),
        survey_no=getattr(record, "survey_no", None),
        subdivision_no=getattr(record, "subdivision_no", None),
        owner_name_en=getattr(record, "owner_name_en", None),
        site_address=getattr(record, "site_address", None),
        survey_number=getattr(record, "survey_number", None),
        sub_division=getattr(record, "sub_division", None),
        taluk=getattr(record, "taluk", None),
        village=getattr(record, "village", None),
        district=getattr(record, "district", None),
        date_of_visit=getattr(record, "date_of_visit", None),
        construction_happening=getattr(record, "construction_happening", None),
        remarks=getattr(record, "remarks", None),
        type_of_construction=getattr(record, "type_of_construction", None),
        relationship_with_building=getattr(record, "relationship_with_building", None),
        building_user_name=getattr(record, "building_user_name", None),
        contact_number=getattr(record, "contact_number", None),
        stage_of_construction=getattr(record, "stage_of_construction", None),
        no_of_floors=getattr(record, "no_of_floors", None),
        expected_completion=getattr(record, "expected_completion", None),
        built_up_area=getattr(record, "built_up_area", None),
        site_contractor_architect_name=getattr(record, "site_contractor_architect_name", None),
        site_contractor_architect_number=getattr(record, "site_contractor_architect_number", None),
        spoken_with=getattr(record, "spoken_with", None),
        follow_up_date=getattr(record, "follow_up_date", None),
        audit_status=getattr(record, "audit_status", None) or "PENDING",
        audit_comment=getattr(record, "audit_comment", None),
        audited_by_id=getattr(record, "audited_by_id", None),
        audited_by_name=(record.audited_by.full_name if getattr(record, "audited_by", None) else None),
        audited_at=getattr(record, "audited_at", None),
        uploaded_by_id=getattr(record, "uploaded_by_id", None),
        uploaded_by_name=(record.uploaded_by.full_name if getattr(record, "uploaded_by", None) else None),
        staged_operator_id=getattr(record, "staged_operator_id", None),
        staged_operator_name=(record.staged_operator.full_name if getattr(record, "staged_operator", None) else None),
        assigned_auditor_id=getattr(record, "assigned_auditor_id", None),
        assigned_auditor_name=(record.assigned_auditor.full_name or record.assigned_auditor.email) if getattr(record, "assigned_auditor", None) else None,
        qc_by_id=getattr(record, "qc_by_id", None),
        qc_by_name=(record.qc_by.full_name if getattr(record, "qc_by", None) else None),
        qc_vhr_comment=getattr(record, "qc_vhr_comment", None),
        qc_street_details=getattr(record, "qc_street_details", None),
        qc_builder_contact=getattr(record, "qc_builder_contact", None),
        qc_status="DONE" if (
            getattr(record, "qc_completed_at", None) is not None
            or bool(getattr(record, "qc_vhr_comment", None) and str(record.qc_vhr_comment).strip())
            or bool(getattr(record, "qc_street_details", None) and str(record.qc_street_details).strip())
            or bool(getattr(record, "qc_builder_contact", None) and str(record.qc_builder_contact).strip())
            or bool(getattr(record, "qc_sqfeet", None) and str(record.qc_sqfeet).strip())
        ) else "PENDING",
        qc_completed_at=getattr(record, "qc_completed_at", None),
        qc_edited_at=getattr(record, "qc_edited_at", None),
        assigned_telecaller_id=getattr(record, "assigned_telecaller_id", None),
        assigned_telecaller_name=(record.assigned_telecaller.full_name or record.assigned_telecaller.email) if getattr(record, "assigned_telecaller", None) else None,
        telecaller_status=getattr(record, "telecaller_status", None),
        telecaller_comment=getattr(record, "telecaller_comment", None),
        telecaller_called_at=getattr(record, "telecaller_called_at", None),
        telecaller_by_id=getattr(record, "telecaller_by_id", None),
        telecaller_no_of_floors=getattr(record, "telecaller_no_of_floors", None),
        telecaller_expected_completion=getattr(record, "telecaller_expected_completion", None),
        telecaller_built_up_area=getattr(record, "telecaller_built_up_area", None),
        telecaller_stage_of_construction=getattr(record, "telecaller_stage_of_construction", None),
        telecaller_by_name=(record.telecaller_by.full_name or record.telecaller_by.email) if getattr(record, "telecaller_by", None) else None,
        reassigned_to_id=getattr(record, "reassigned_to_id", None),
        reassigned_to_name=(record.reassigned_to.full_name or record.reassigned_to.email) if getattr(record, "reassigned_to", None) else None,
        reassigned_at=getattr(record, "reassigned_at", None),
        revisit_status=getattr(record, "revisit_status", None),
        updated_coordinates=getattr(record, "updated_coordinates", None),
        updated_information=getattr(record, "updated_information", None),
        gmap_image_url=f"/api/admin/records/{record.id}/gmap-image" if getattr(record, "gmap_image_key", None) else None,
        gmap_zoom=getattr(record, "gmap_zoom", None),
        gmap_captured_at=getattr(record, "gmap_captured_at", None),
        qc_reference_image_key=getattr(record, "qc_reference_image_key", None),
        qc_reference_image_url=f"/api/admin/records/{record.id}/qc-reference-image" if getattr(record, "qc_reference_image_key", None) else None,
        images=[
            ImageDetail(
                id=img.id,
                google_drive_file_id=img.google_drive_file_id,
                file_name=img.file_name,
                photo_order=img.photo_order,
                source=getattr(img, "source", "camera"),
                latitude=img.latitude,
                longitude=img.longitude,
                location_accuracy=img.location_accuracy,
                captured_at=img.captured_at,
                created_at=img.created_at,
                image_url=f"/api/admin/records/{record.id}/image/{img.id}",
            )
            for img in (record.images or [])
        ],
    )
