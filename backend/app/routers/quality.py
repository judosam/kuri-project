import io
import logging
from datetime import datetime, timezone
import re

from PIL import Image

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, and_, case, cast, func, not_, or_
from sqlalchemy.orm import Session

from app.core.dependencies import require_active_user, require_auditor, require_record_manager
from app.database.connection import get_db
from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.services.activity_log_service import log_activity
from app.services.google_drive_service import GoogleDriveService
from app.services.image_service import ImageService, validate_image_magic_bytes
from app.services.local_storage_service import LocalStorageService
from app.services.record_filter_service import BLANK, FILTER_FIELDS, filter_column, filtered_query, has_qc_expression, parse_column_filters

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Quality review"])


def record_filters(status: str | None = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
                   search: str | None = Query(None, max_length=200), user_id: int | None = None,
                   date_from: datetime | None = None, date_to: datetime | None = None,
                   date_field: str = Query("assigned_at", pattern="^(created_at|assigned_at|captured_at|completed_at|qc_completed_at)$"),
                   qc_status: str | None = Query(None, pattern="^(DONE|PENDING)$"),
                   audit_status: str | None = Query(None, pattern="^(PENDING|APPROVAL|DISAPPROVAL|COMMERCIAL_PROPERTY|RE_AUDITED)$"),
                   column_filters: str | None = Query(None, max_length=16000),
                   assigned_auditor_id: int | None = Query(None, ge=1),
                   unassigned_user: bool = False, unassigned_auditor: bool = False):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="From date must be before the To date")
    return dict(status=status, search=search, user_id=user_id, date_from=date_from, date_to=date_to,
                date_field=date_field, qc_status=qc_status, audit_status=audit_status,
                column_filters=parse_column_filters(column_filters), assigned_auditor_id=assigned_auditor_id,
                unassigned_user=unassigned_user, unassigned_auditor=unassigned_auditor)


@router.get("/admin/records/filter-options")
async def column_options(field: str, choice_search: str = Query("", max_length=200),
                         filters: dict = Depends(record_filters), user: User = Depends(require_record_manager),
                         db: Session = Depends(get_db)):
    if field not in FILTER_FIELDS:
        raise HTTPException(status_code=422, detail="This column does not support multiple selection")
    if user.role == UserRole.AUDITOR and field in ("audited_by", "photo_count"):
        raise HTTPException(status_code=403, detail="This column belongs to the admin portal")
    if user.role == UserRole.AUDITOR:
        filters["assigned_auditor_id"] = user.id
        filters["unassigned_auditor"] = False
    filters["column_filters"] = {k: v for k, v in filters["column_filters"].items() if k != field}
    column = func.coalesce(cast(filter_column(field), String), "")
    query = filtered_query(db, **filters)
    if choice_search:
        query = query.filter(column.ilike(f"%{choice_search}%"))
    rows = query.with_entities(column, func.count(CaptureRecord.id)).group_by(column).order_by(column).limit(501).all()
    return {"options": [{"value": value or BLANK, "label": value or "(Blanks)", "count": count}
                        for value, count in rows[:500]], "truncated": len(rows) > 500}


@router.get("/records/filter-options")
async def field_location_options(
    status: str | None = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    district: str | None = None,
    taluk: str | None = None,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db)
):
    if user.role not in (UserRole.USER, UserRole.FIELD_VERIFIER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Field verifier access required")
    base = db.query(CaptureRecord)
    if user.role in (UserRole.USER, UserRole.FIELD_VERIFIER):
        base = base.filter(
            CaptureRecord.audit_status.not_in(["DISAPPROVAL", "COMMERCIAL_PROPERTY"]),
            or_(CaptureRecord.user_id == user.id, CaptureRecord.reassigned_to_id == user.id),
        )
    elif user.role != UserRole.ADMIN:
        base = base.filter(CaptureRecord.user_id == user.id)
    if status:
        st = status.upper()
        is_completed = or_(
            CaptureRecord.status.in_(["COMPLETED", "Updated Revisited", "UPDATED_REVISITED"]),
            func.coalesce(CaptureRecord.revisit_status, "") == "COMPLETED",
        )
        is_not_interested = or_(
            CaptureRecord.status.in_(["NOT_INTERESTED", "Not Interested"]),
            CaptureRecord.status.ilike("%not_interested%"),
            CaptureRecord.status.ilike("%not interested%"),
        )
        is_duplicate = or_(
            CaptureRecord.status.in_(["DUPLICATE", "Duplicate"]),
            CaptureRecord.status.ilike("%duplicate%"),
        )
        is_construction_finished = or_(
            CaptureRecord.status.in_(["CONSTRUCTION_FINISHED", "Construction Finished"]),
            CaptureRecord.status.ilike("%construction_finished%"),
            CaptureRecord.status.ilike("%construction finished%"),
        )
        is_closed = or_(is_not_interested, is_duplicate, is_construction_finished)
        if st == "COMPLETED":
            base = base.filter(is_completed)
        elif st in ("NOT_COMPLETED", "PENDING"):
            base = base.filter(not_(is_completed), not_(is_closed))
        elif st in ("CLOSED", "OTHER"):
            base = base.filter(is_closed)
        elif st == "REASSIGNED":
            is_reassigned = and_(
                not_(is_completed),
                not_(is_closed),
                or_(
                    CaptureRecord.reassigned_to_id.isnot(None),
                    CaptureRecord.revisit_status.in_(["REASSIGNED", "PENDING_REVISIT"]),
                ),
            )
            base = base.filter(is_reassigned)
        elif st in ("NOT_INTERESTED", "NOT INTERESTED"):
            base = base.filter(is_not_interested)
        elif st == "DUPLICATE":
            base = base.filter(is_duplicate)
        elif st in ("CONSTRUCTION_FINISHED", "CONSTRUCTION FINISHED"):
            base = base.filter(is_construction_finished)
        else:
            base = base.filter(CaptureRecord.status == status)
    result = {}
    for field in ("district", "taluk", "village"):
        query = base
        if district and field != "district":
            query = query.filter(CaptureRecord.district == district)
        if taluk and field == "village":
            query = query.filter(CaptureRecord.taluk == taluk)
        column = getattr(CaptureRecord, field)
        if field == "village":
            rows = query.with_entities(column, func.count(CaptureRecord.id)).filter(column.is_not(None), column != "").group_by(column).order_by(column).all()
            cleaned_map: dict[str, int] = {}
            for raw_name, cnt in rows:
                norm_name = re.sub(r'\s+', ' ', raw_name).strip()
                if norm_name:
                    cleaned_map[norm_name] = cleaned_map.get(norm_name, 0) + cnt
            sorted_villages = sorted(cleaned_map.keys())
            result["village"] = sorted_villages
            result["village_counts"] = [{"name": v, "count": cleaned_map[v]} for v in sorted_villages]
        else:
            result[field] = [row[0] for row in query.with_entities(column).filter(column.is_not(None), column != "").distinct().order_by(column).all()]
    return result


@router.get("/admin/qa-dashboard")
async def qa_dashboard(filters: dict = Depends(record_filters), user: User = Depends(require_auditor),
                       db: Session = Depends(get_db)):
    if user.role == UserRole.AUDITOR:
        filters["assigned_auditor_id"] = user.id
        filters["unassigned_auditor"] = False
    query = filtered_query(db, **filters)
    total, done = query.with_entities(func.count(CaptureRecord.id), func.sum(case((has_qc_expression(), 1), else_=0))).one()
    categories = query.with_entities(CaptureRecord.qc_vhr_comment, func.count(CaptureRecord.id)).filter(
        has_qc_expression()).group_by(CaptureRecord.qc_vhr_comment).order_by(func.count(CaptureRecord.id).desc()).limit(6).all()
    return {"total": total, "done": done or 0, "pending": total - (done or 0),
            "completion_rate": round((done or 0) * 100 / total, 1) if total else 0,
            "categories": [{"label": label or "Other QC details", "count": count} for label, count in categories]}


class QcRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qc_vhr_comment: str = Field(min_length=1, max_length=120)
    qc_street_details: str = Field(default="", max_length=2000)
    qc_builder_contact: str = Field(default="", max_length=2000)
    qc_sqfeet: str = Field(default="", max_length=50)
    assigned_auditor_id: int | None = None


@router.patch("/admin/records/{record_id}/qc")
async def save_qc(record_id: int, request: QcRequest, user: User = Depends(require_auditor),
                  db: Session = Depends(get_db)):
    record = db.get(CaptureRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if user.role == UserRole.AUDITOR and record.assigned_auditor_id != user.id and request.assigned_auditor_id != user.id:
        raise HTTPException(status_code=403, detail="This record is assigned to another QA reviewer")
    if not request.qc_vhr_comment.strip():
        raise HTTPException(status_code=422, detail="Select a QC comment")
    now = datetime.now(timezone.utc)
    if record.qc_completed_at:
        record.qc_edited_at = now
    else:
        record.qc_completed_at = now
    dump = request.model_dump()
    new_auditor_id = dump.pop("assigned_auditor_id", None)
    for field, value in dump.items():
        setattr(record, field, (value.strip() or None) if isinstance(value, str) else value)
    record.qc_by_id = user.id
    if new_auditor_id is not None:
        record.assigned_auditor_id = new_auditor_id if new_auditor_id > 0 else None
    elif user.role == UserRole.AUDITOR and record.assigned_auditor_id is None:
        record.assigned_auditor_id = user.id
    db.commit()
    log_activity(db=db, action_type="record_qc", type="record", title="QC assessment saved", user_id=user.id,
                 user_name=user.full_name, record_id=record.id, record_name=record.name, status="success")
    from app.routers.admin import _record_to_detail
    return _record_to_detail(record)


@router.post("/admin/records/{record_id}/qc-reference-image")
async def upload_qc_reference_image(
    record_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    record = db.get(CaptureRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if user.role == UserRole.AUDITOR and record.assigned_auditor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="This record is assigned to another QA reviewer")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Empty file uploaded")
    if not validate_image_magic_bytes(content):
        raise HTTPException(status_code=422, detail="Invalid image format. Supported formats: JPEG, PNG, WebP")

    try:
        img = Image.open(io.BytesIO(content))
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        max_dim = 2048
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=90, optimize=True)
        processed_bytes = out.getvalue()
    except Exception as e:
        logger.error(f"Image processing error: {e}")
        raise HTTPException(status_code=422, detail="Could not process image")

    # Local storage
    local = LocalStorageService()
    filename = f"Record_{record.id}_QC_Ref.jpg"
    storage_folder = "qc_reference"
    key = local.save_file(processed_bytes, filename, folder=storage_folder)

    # Thumbnail
    try:
        thumb_bytes = ImageService().create_thumbnail(processed_bytes, max_dim=240)
        local.save_file(thumb_bytes, f"thumb_{filename}", folder=storage_folder)
    except Exception as e:
        logger.warning(f"Could not generate reference thumbnail: {e}")

    # Google Drive upload
    try:
        drive = GoogleDriveService()
        drive.upload_image(
            file_content=processed_bytes,
            file_name=filename,
            folder_path="qc_reference",
            content_type="image/jpeg",
        )
    except Exception as e:
        logger.warning(f"Google Drive upload error for reference image: {e}")

    # Update record
    record.qc_reference_image_key = key
    now = datetime.now(timezone.utc)
    if record.qc_completed_at:
        record.qc_edited_at = now
    else:
        record.qc_completed_at = now
    record.qc_by_id = user.id
    if user.role == UserRole.AUDITOR and record.assigned_auditor_id is None:
        record.assigned_auditor_id = user.id

    db.commit()
    log_activity(
        db=db,
        action_type="upload_qc_reference",
        type="record",
        title="QC reference image attached",
        user_id=user.id,
        user_name=user.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    from app.routers.admin import _record_to_detail
    return _record_to_detail(record)


@router.delete("/admin/records/{record_id}/qc-reference-image")
async def delete_qc_reference_image(
    record_id: int,
    user: User = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    record = db.get(CaptureRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if user.role == UserRole.AUDITOR and record.assigned_auditor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="This record is assigned to another QA reviewer")

    if record.qc_reference_image_key:
        try:
            LocalStorageService().delete_file(record.qc_reference_image_key)
        except Exception as e:
            logger.warning(f"Failed to delete local reference image: {e}")
        record.qc_reference_image_key = None
        db.commit()
        log_activity(
            db=db,
            action_type="delete_qc_reference",
            type="record",
            title="QC reference image removed",
            user_id=user.id,
            user_name=user.full_name,
            record_id=record.id,
            record_name=record.name,
            status="success",
        )

    from app.routers.admin import _record_to_detail
    return _record_to_detail(record)


@router.get("/admin/records/{record_id}/qc-reference-image")
async def admin_get_qc_reference_image(
    record_id: int,
    thumb: bool = Query(False, description="Serve thumbnail"),
    user: User = Depends(require_record_manager),
    db: Session = Depends(get_db),
):
    record = db.get(CaptureRecord, record_id)
    if not record or not record.qc_reference_image_key:
        raise HTTPException(status_code=404, detail="QC reference image not found")

    local = LocalStorageService()
    file_path = local.get_thumbnail_path(record.qc_reference_image_key) if thumb else None
    if not file_path:
        file_path = local.get_file_path(record.qc_reference_image_key)
    if not file_path:
        raise HTTPException(status_code=404, detail="Image file not found on disk")

    return FileResponse(
        file_path,
        media_type="image/jpeg",
        filename=f"Record_{record_id}_QC_Ref.jpg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"qc-ref-{record_id}-{"thumb" if thumb else "full"}"',
        },
    )
