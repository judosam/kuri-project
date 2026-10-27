import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, desc, case

from app.core.config import get_settings
from app.core.dependencies import require_telecaller, require_record_manager
from app.database.connection import get_db
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.schemas.record import (
    RecordDetail,
    RecordListResponse,
    TelecallerFeedbackRequest,
    TelecallerDashboardMetrics,
)
from app.services.activity_log_service import log_activity
from app.services.telecaller_comment_service import (
    append_call_log_entry,
    normalize_to_table,
    parse_comment_to_rows,
    format_rows_to_table,
)
from app.routers.records import _record_to_detail
from app.repositories.record_repository import BUSINESS_TZ, local_day_bounds

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/telecaller", tags=["Telecaller"])


def _eligible_contact_filter():
    """Only records that have at least one valid phone number (Contact Number or Contractor Contact)."""
    return or_(
        and_(
            CaptureRecord.contact_number.isnot(None),
            func.trim(CaptureRecord.contact_number) != "",
            CaptureRecord.contact_number != "-",
            func.lower(func.trim(CaptureRecord.contact_number)) != "na",
            func.lower(func.trim(CaptureRecord.contact_number)) != "nil",
        ),
        and_(
            CaptureRecord.site_contractor_architect_number.isnot(None),
            func.trim(CaptureRecord.site_contractor_architect_number) != "",
            CaptureRecord.site_contractor_architect_number != "-",
            func.lower(func.trim(CaptureRecord.site_contractor_architect_number)) != "na",
            func.lower(func.trim(CaptureRecord.site_contractor_architect_number)) != "nil",
        ),
    )


def sync_unassigned_telecaller_leads(db: Session) -> Optional[int]:
    """If there is exactly one active telecaller, ensure all unassigned contact records are assigned to them."""
    active_telecallers = (
        db.query(User)
        .filter(User.role == UserRole.TELECALLER, User.is_active == True)
        .all()
    )
    if len(active_telecallers) == 1:
        telecaller_id = active_telecallers[0].id
        updated = (
            db.query(CaptureRecord)
            .filter(
                _eligible_contact_filter(),
                CaptureRecord.assigned_telecaller_id.is_(None),
            )
            .update(
                {CaptureRecord.assigned_telecaller_id: telecaller_id},
                synchronize_session=False,
            )
        )
        if updated > 0:
            db.commit()
            logger.info("Auto-assigned %d eligible contact lead(s) to sole active telecaller ID %d", updated, telecaller_id)
        return telecaller_id
    return None


@router.get("/records", response_model=RecordListResponse)
async def list_telecaller_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    telecaller_status: Optional[str] = Query(None),
    filter_assigned: Optional[str] = Query("all"),  # "my", "unassigned", "all"
    current_user: User = Depends(require_telecaller),
    db: Session = Depends(get_db),
):
    """List records with phone numbers for telecalling verification."""
    # Ensure unassigned contact records are auto-assigned if sole active telecaller exists
    sync_unassigned_telecaller_leads(db)

    query = db.query(CaptureRecord).filter(_eligible_contact_filter())

    # Filter by assignment for telecallers
    if current_user.role.value == "TELECALLER":
        if filter_assigned == "my":
            query = query.filter(CaptureRecord.assigned_telecaller_id == current_user.id)
        elif filter_assigned == "unassigned":
            query = query.filter(CaptureRecord.assigned_telecaller_id.is_(None))
        else:
            # "all" (default): Telecaller sees ALL eligible leads in their queue:
            # records assigned to them + unassigned records waiting to be called.
            # Never show records assigned to OTHER telecallers.
            query = query.filter(
                or_(
                    CaptureRecord.assigned_telecaller_id == current_user.id,
                    CaptureRecord.assigned_telecaller_id.is_(None),
                )
            )
    elif filter_assigned == "unassigned":
        query = query.filter(CaptureRecord.assigned_telecaller_id.is_(None))
    elif filter_assigned == "my":
        query = query.filter(CaptureRecord.assigned_telecaller_id == current_user.id)

    # Telecaller call status filter
    if telecaller_status:
        if telecaller_status == "PENDING":
            query = query.filter(
                or_(
                    CaptureRecord.telecaller_status.is_(None),
                    CaptureRecord.telecaller_status == "PENDING",
                    CaptureRecord.telecaller_status == "",
                )
            )
        elif telecaller_status != "ALL":
            query = query.filter(CaptureRecord.telecaller_status == telecaller_status)

    # Search filter
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(CaptureRecord.unique_id).like(term),
                func.lower(CaptureRecord.name).like(term),
                func.lower(CaptureRecord.owner_name_en).like(term),
                func.lower(CaptureRecord.contact_number).like(term),
                func.lower(CaptureRecord.site_contractor_architect_number).like(term),
                func.lower(CaptureRecord.site_contractor_architect_name).like(term),
                func.lower(CaptureRecord.village).like(term),
                func.lower(CaptureRecord.taluk).like(term),
                func.lower(CaptureRecord.district).like(term),
            )
        )

    total = query.count()
    records = (
        query.order_by(
            # Uncalled / pending records first, then recent calls
            case((CaptureRecord.telecaller_called_at.is_(None), 0), else_=1),
            desc(CaptureRecord.id),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    detail_list = [_record_to_detail(r) for r in records]
    return RecordListResponse(
        records=detail_list,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/records/{record_id}", response_model=RecordDetail)
async def get_telecaller_record(
    record_id: int,
    current_user: User = Depends(require_telecaller),
    db: Session = Depends(get_db),
):
    """Get single record details for telecaller modal."""
    record = db.query(CaptureRecord).filter(CaptureRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if current_user.role.value == "TELECALLER":
        if record.assigned_telecaller_id is not None and record.assigned_telecaller_id != current_user.id:
            raise HTTPException(status_code=403, detail="Record is assigned to another telecaller")
    return _record_to_detail(record)


@router.post("/records/{record_id}/feedback", response_model=RecordDetail)
async def save_telecaller_feedback(
    record_id: int,
    request: TelecallerFeedbackRequest,
    current_user: User = Depends(require_telecaller),
    db: Session = Depends(get_db),
):
    """Save call feedback from telecaller."""
    record = db.query(CaptureRecord).filter(CaptureRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    if current_user.role.value == "TELECALLER":
        if record.assigned_telecaller_id is not None and record.assigned_telecaller_id != current_user.id:
            raise HTTPException(status_code=403, detail="Record is assigned to another telecaller")

    record.telecaller_status = request.telecaller_status

    tc_floors = request.telecaller_no_of_floors if request.telecaller_no_of_floors is not None else request.no_of_floors
    if tc_floors is not None:
        record.telecaller_no_of_floors = tc_floors.strip() or None

    tc_exp = request.telecaller_expected_completion if request.telecaller_expected_completion is not None else request.expected_completion
    if tc_exp is not None:
        record.telecaller_expected_completion = tc_exp.strip() or None

    tc_area = request.telecaller_built_up_area if request.telecaller_built_up_area is not None else request.built_up_area
    if tc_area is not None:
        record.telecaller_built_up_area = tc_area.strip() or None

    tc_stage = request.telecaller_stage_of_construction if request.telecaller_stage_of_construction is not None else request.stage_of_construction
    if tc_stage is not None:
        record.telecaller_stage_of_construction = tc_stage.strip() or None
    if request.follow_up_date is not None:
        record.follow_up_date = request.follow_up_date.strip() or None

    new_note = (request.telecaller_comment or "").strip()

    if request.overwrite_comment:
        record.telecaller_comment = normalize_to_table(new_note) if new_note else None
    else:
        caller_name = current_user.full_name or current_user.email or "Telecaller"
        status_label = request.telecaller_status.replace("_", " ").title() if request.telecaller_status else "Call Logged"

        meta_parts = []
        if request.follow_up_date:
            meta_parts.append(f"Follow-up: {request.follow_up_date}")
        if request.stage_of_construction:
            meta_parts.append(f"Stage: {request.stage_of_construction}")

        details_str = " | ".join(meta_parts) if meta_parts else "—"

        record.telecaller_comment = append_call_log_entry(
            existing_comment=record.telecaller_comment,
            caller_name=caller_name,
            status=status_label,
            details=details_str,
            note=new_note,
        )

    record.telecaller_called_at = datetime.now(timezone.utc)
    record.updated_at = record.telecaller_called_at
    record.telecaller_by_id = current_user.id
    record.updated_by_id = current_user.id
    record.updated_by_name = current_user.full_name or current_user.username
    record.updated_by_role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)

    # If unassigned and current user is telecaller, claim it
    if record.assigned_telecaller_id is None and current_user.role.value == "TELECALLER":
        record.assigned_telecaller_id = current_user.id

    db.commit()
    db.refresh(record)

    log_activity(
        db=db,
        action_type="telecaller_call_logged",
        type="record",
        title=f"Telecaller logged call: {request.telecaller_status}",
        detail=f"Record #{record.id} ({record.unique_id or record.name}) call status: {request.telecaller_status}. Comment: {record.telecaller_comment or 'None'}",
        user_id=current_user.id,
        user_name=current_user.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )

    return _record_to_detail(record)


@router.get("/dashboard")
async def get_telecaller_dashboard(
    current_user: User = Depends(require_telecaller),
    db: Session = Depends(get_db),
):
    """Metrics for the telecaller dashboard."""
    # Ensure unassigned contact records are auto-assigned if sole active telecaller exists
    sync_unassigned_telecaller_leads(db)

    base_query = db.query(CaptureRecord).filter(_eligible_contact_filter())

    # User scope if telecaller
    if current_user.role.value == "TELECALLER":
        user_query = base_query.filter(
            or_(
                CaptureRecord.assigned_telecaller_id == current_user.id,
                CaptureRecord.assigned_telecaller_id.is_(None),
            )
        )
        total_eligible = user_query.count()
        total_assigned = base_query.filter(CaptureRecord.assigned_telecaller_id == current_user.id).count()
    else:
        user_query = base_query
        total_eligible = base_query.count()
        total_assigned = base_query.filter(CaptureRecord.assigned_telecaller_id.isnot(None)).count()

    pending_calls = user_query.filter(
        or_(
            CaptureRecord.telecaller_status.is_(None),
            CaptureRecord.telecaller_status == "PENDING",
            CaptureRecord.telecaller_status == "",
        )
    ).count()

    construction_confirmed = user_query.filter(
        CaptureRecord.telecaller_status == "CONSTRUCTION_CONFIRMED"
    ).count()

    connected_follow_up = user_query.filter(
        CaptureRecord.telecaller_status == "CONNECTED_FOLLOW_UP"
    ).count()

    not_reachable = user_query.filter(
        CaptureRecord.telecaller_status == "NOT_REACHABLE"
    ).count()

    wrong_number = user_query.filter(
        CaptureRecord.telecaller_status == "WRONG_NUMBER"
    ).count()

    # Called today
    day_start, day_end = local_day_bounds()
    called_today_query = user_query.filter(
        CaptureRecord.telecaller_called_at >= day_start,
        CaptureRecord.telecaller_called_at < day_end,
    )
    if current_user.role.value == "TELECALLER":
        called_today_query = called_today_query.filter(CaptureRecord.telecaller_by_id == current_user.id)
    called_today = called_today_query.count()

    # Recent calls
    recent_records = (
        user_query.filter(CaptureRecord.telecaller_called_at.isnot(None))
        .order_by(desc(CaptureRecord.telecaller_called_at))
        .limit(8)
        .all()
    )

    return {
        "metrics": {
            "total_eligible": total_eligible,
            "total_assigned": total_assigned,
            "pending_calls": pending_calls,
            "construction_confirmed": construction_confirmed,
            "connected_follow_up": connected_follow_up,
            "not_reachable": not_reachable,
            "wrong_number": wrong_number,
            "called_today": called_today,
        },
        "recent_calls": [_record_to_detail(r) for r in recent_records],
    }
