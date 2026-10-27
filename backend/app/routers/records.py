import logging
from datetime import datetime, timezone, datetime as dt, timezone as dt_timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dependencies import require_active_user, require_record_writer
from app.database.connection import get_db
from app.models.user import User, UserRole
from app.repositories.image_repository import ImageRepository
from app.schemas.record import (
    AddressResolveResponse,
    ImageDetail,
    MarkStatusRequest,
    RecordCreateRequest,
    RecordDetail,
    RecordListResponse,
    UserDashboardResponse,
)
from app.services.activity_log_service import log_activity
from app.services.google_drive_service import GoogleDriveService
from app.services.image_service import ImageService
from app.services.local_storage_service import LocalStorageService
from app.services.location_cache_service import (
    LocationCacheService,
    get_location_cache_service,
)
from app.services.location_service import LocationService
from app.services.record_service import RecordService
from app.services.record_filter_service import SORT_PATTERN

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/records", tags=["Records"])


def canonical_photo_name(record_id: int, order: int) -> str:
    """Human-readable, deterministic photo file name (no client UUIDs).

    e.g. Record_39_Photo_1.jpg — used for the DB row, the on-disk file,
    and every UI label. Client-supplied names are ignored.
    """
    return f"Record_{record_id}_Photo_{order}.jpg"


def sync_to_drive_background(file_bytes: bytes, file_name: str, folder: str):
    """Asynchronously sync a saved photo to Google Drive in the background."""
    try:
        drive = GoogleDriveService()
        if drive.service:
            file_id = drive.upload_image(file_bytes, file_name, folder_path=folder)
            if file_id:
                logger.info(f"Background Drive sync succeeded for {file_name}: {file_id}")
            else:
                logger.warning(f"Background Drive sync returned None for {file_name}")
    except Exception as e:
        logger.warning(f"Background Drive sync failed for {file_name}: {e}")


def _save_image(processed: bytes, file_name: str, folder: str) -> tuple[str, str]:
    """
    Save processed image bytes locally immediately for fast persistence and sub-second responses.
    Returns (storage_key, storage_type).
    """
    local = LocalStorageService()
    relative_path = local.save_file(processed, file_name, folder=folder)

    # Save compact thumbnail for sub-second feed loading
    try:
        thumb_bytes = ImageService().create_thumbnail(processed, max_dim=160)
        local.save_file(thumb_bytes, f"thumb_{file_name}", folder=folder)
    except Exception as e:
        logger.warning(f"Could not generate local thumbnail for {file_name}: {e}")

    return relative_path, "local"


@router.post("", response_model=RecordDetail, status_code=status.HTTP_201_CREATED)
async def create_record(
    request: RecordCreateRequest,
    user: User = Depends(require_record_writer),
    db: Session = Depends(get_db),
):
    """Create a capture record with photo metadata (GPS), or complete a pre-dispatched task. Images uploaded separately."""
    record_service = RecordService(db)
    image_repo = ImageRepository(db)
    existing = None
    was_completed = False
    if request.task_id:
        existing = record_service.get_record(request.task_id)
        if not existing or not record_service.can_access(user, existing):
            raise HTTPException(status_code=404, detail="Assigned task is unavailable. Refresh your records before retrying.")
        was_completed = existing.status == "COMPLETED"

    if (
        getattr(request, "construction_happening", None) in ("No", "NO", "no")
        and not (getattr(request, "remarks", None) and getattr(request, "remarks", "").strip())
    ):
        raise HTTPException(status_code=400, detail="Remarks are mandatory when construction is not happening.")

    # Resolve location from first photo's GPS; inspections completed without
    # photos send a standalone device fix instead.
    location_name = formatted_address = place_id = None
    first_gps = None
    if request.photos:
        for p in request.photos:
            if p.latitude != 0 or p.longitude != 0:
                first_gps = p
                break
    if first_gps is None and request.field_gps and (request.field_gps.latitude != 0 or request.field_gps.longitude != 0):
        first_gps = request.field_gps
    if first_gps is not None:
        cache_entry = get_location_cache_service().resolve(
            first_gps.latitude,
            first_gps.longitude,
            geocode_func=LocationService().reverse_geocode,
        )
        if cache_entry:
            location_name = cache_entry.location_name
            formatted_address = cache_entry.formatted_address
            place_id = cache_entry.place_id

    def _normalize_dt(val):
        if val is None:
            return None
        if isinstance(val, (int, float)):
            try:
                ts = val / 1000.0 if val > 1e11 else float(val)
                return dt.fromtimestamp(ts, tz=dt_timezone.utc)
            except Exception:
                return None
        if isinstance(val, dt):
            return val.replace(tzinfo=dt_timezone.utc) if val.tzinfo is None else val
        try:
            parsed = dt.fromisoformat(str(val).replace("Z", "+00:00"))
            return parsed.replace(tzinfo=dt_timezone.utc) if parsed.tzinfo is None else parsed
        except Exception:
            return None

    # Resolve capture timestamp from photos, field_gps or now
    capture_dt = None
    if request.photos:
        for p in request.photos:
            p_dt = _normalize_dt(getattr(p, "captured_at", None))
            if p_dt and (capture_dt is None or p_dt > capture_dt):
                capture_dt = p_dt
    if capture_dt is None and request.field_gps:
        g_dt = _normalize_dt(getattr(request.field_gps, "captured_at", None))
        if g_dt:
            capture_dt = g_dt
    if capture_dt is None:
        capture_dt = dt.now(dt_timezone.utc)

    cur_lat = None
    cur_lon = None
    cur_acc = None
    if first_gps is not None:
        cur_lat = first_gps.latitude
        cur_lon = first_gps.longitude
        cur_acc = getattr(first_gps, "location_accuracy", None)
    elif request.field_gps is not None and (request.field_gps.latitude != 0 or request.field_gps.longitude != 0):
        cur_lat = request.field_gps.latitude
        cur_lon = request.field_gps.longitude
        cur_acc = request.field_gps.location_accuracy

    cur_coords = f"{cur_lat:.6f}, {cur_lon:.6f}" if (cur_lat is not None and cur_lon is not None and (cur_lat != 0 or cur_lon != 0)) else None

    # If task_id is provided, complete that pre-dispatched task instead of creating a duplicate row
    if request.task_id:
        if existing and record_service.can_access(user, existing):
            record = existing
            was_completed = record.status in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")
            is_revisit = (
                record.reassigned_to_id is not None
                or record.revisit_status in ("REASSIGNED", "PENDING_REVISIT", "Updated Revisited", "UPDATED_REVISITED")
                or was_completed
            )
            closed_map = {
                "NOT_INTERESTED": "Not Interested",
                "Not Interested": "Not Interested",
                "DUPLICATE": "Duplicate",
                "Duplicate": "Duplicate",
                "CONSTRUCTION_FINISHED": "Construction Finished",
                "Construction Finished": "Construction Finished",
            }
            if request.status in closed_map:
                target_status = closed_map[request.status]
            elif is_revisit:
                target_status = "Updated Revisited"
            else:
                target_status = "COMPLETED"

            update_data = {
                "status": target_status,
                "field_captured_at": capture_dt,
            }
            if not request.photos and cur_lat is not None and cur_lon is not None and (cur_lat != 0 or cur_lon != 0):
                update_data["field_latitude"] = cur_lat
                update_data["field_longitude"] = cur_lon
                if cur_acc is not None:
                    update_data["field_location_accuracy"] = cur_acc

            if is_revisit:
                update_data["revisit_status"] = "Updated Revisited"
                if cur_coords:
                    update_data["updated_coordinates"] = cur_coords
                    update_data["coordinates"] = cur_coords

                info_parts = []
                if request.remarks:
                    info_parts.append(request.remarks.strip())
                if request.stage_of_construction:
                    info_parts.append(f"Stage: {request.stage_of_construction}")
                if request.construction_happening:
                    info_parts.append(f"Construction: {request.construction_happening}")
                if info_parts:
                    update_data["updated_information"] = " | ".join(info_parts)
            else:
                if cur_coords and not (record.coordinates or "").strip():
                    update_data["coordinates"] = cur_coords

            for field in (
                "date_of_visit", "construction_happening", "remarks",
                "type_of_construction", "relationship_with_building",
                "building_user_name", "contact_number", "stage_of_construction",
                "no_of_floors", "expected_completion", "built_up_area",
                "site_contractor_architect_name", "site_contractor_architect_number",
                "spoken_with", "follow_up_date",
            ):
                val = getattr(request, field, None)
                if val is not None:
                    if field == "remarks" and isinstance(val, str):
                        clean_remarks = val.strip() or None
                        # Disallow duplicating admin task description into inspection remarks
                        if clean_remarks and (
                            (record.description and clean_remarks == record.description.strip())
                            or (request.description and clean_remarks == request.description.strip())
                        ):
                            clean_remarks = None
                        update_data[field] = clean_remarks
                    else:
                        update_data[field] = val
            if request.name:
                update_data["name"] = request.name
            if request.description:
                update_data["description"] = request.description
            # A site detail the admin left blank is the operator's to fill in;
            # one the admin supplied stays authoritative.
            if request.owner_name_en and not (record.owner_name_en or "").strip():
                update_data["owner_name_en"] = request.owner_name_en.strip()
            if not was_completed or is_revisit:
                # Attach visit location artifacts.
                if location_name:
                    update_data["location_name"] = location_name
                if formatted_address:
                    update_data["formatted_address"] = formatted_address
                if place_id:
                    update_data["place_id"] = place_id
            # Auto reassign when field verification sets follow-up / revisit date
            if request.follow_up_date and str(request.follow_up_date).strip():
                clean_fdate = str(request.follow_up_date).strip()
                update_data["follow_up_date"] = clean_fdate
                update_data["revisit_status"] = "PENDING_REVISIT"
                update_data["reassigned_at"] = datetime.now(timezone.utc)
                update_data["reassigned_to_id"] = user.id

            update_data["updated_by_id"] = user.id
            update_data["updated_by_name"] = user.full_name or user.username
            update_data["updated_by_role"] = user.role.value if hasattr(user.role, 'value') else str(user.role)
            update_data["updated_at"] = datetime.now(timezone.utc)
            record = record_service.record_repo.update(record, **update_data)
        else:
            raise HTTPException(status_code=404, detail="Assigned task is unavailable. Refresh your records before retrying.")
    else:
        # Manually added records get a platform unique ID from the capture
        # position, matching the Excel-dispatched CBE-110291-770091 scheme.
        manual_unique_id = None
        if first_gps is not None:
            manual_unique_id = record_service.next_unique_id(first_gps.latitude, first_gps.longitude)
        manual_remarks = (request.remarks.strip() or None) if (request.remarks and isinstance(request.remarks, str)) else None
        if manual_remarks and request.description and manual_remarks == request.description.strip():
            manual_remarks = None
        f_date = str(request.follow_up_date).strip() if (request.follow_up_date and str(request.follow_up_date).strip()) else None
        record = record_service.create_record(
            user_id=user.id,
            name=request.name,
            description=request.description,
            location_name=location_name,
            formatted_address=formatted_address,
            place_id=place_id,
            owner_name_en=request.owner_name_en,
            status=request.status or "COMPLETED",
            unique_id=manual_unique_id,
            source="manual",
            date_of_visit=request.date_of_visit,
            construction_happening=request.construction_happening,
            remarks=manual_remarks,
            type_of_construction=request.type_of_construction,
            relationship_with_building=request.relationship_with_building,
            building_user_name=request.building_user_name,
            contact_number=request.contact_number,
            stage_of_construction=request.stage_of_construction,
            no_of_floors=request.no_of_floors,
            expected_completion=request.expected_completion,
            built_up_area=request.built_up_area,
            site_contractor_architect_name=request.site_contractor_architect_name,
            site_contractor_architect_number=request.site_contractor_architect_number,
            spoken_with=request.spoken_with,
            follow_up_date=f_date,
            revisit_status="PENDING_REVISIT" if f_date else None,
            reassigned_to_id=user.id if f_date else None,
            reassigned_at=datetime.now(timezone.utc) if f_date else None,
            updated_by_id=user.id,
            updated_by_name=user.full_name or user.username,
            updated_by_role="FIELD_VERIFIER" if (hasattr(user.role, 'value') and user.role.value == "FIELD_VERIFIER") else str(user.role),
            field_captured_at=capture_dt,
            field_latitude=cur_lat,
            field_longitude=cur_lon,
            field_location_accuracy=cur_acc,
            coordinates=cur_coords,
        )

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
            log_activity(
                db=db,
                action_type="telecaller_lead_routed",
                type="record",
                title=f"Contact lead routed to {active_telecallers[0].full_name}",
                detail=f"Field verifier {user.full_name} added contact details (Contact: {record.contact_number or '-'}, Contractor: {record.site_contractor_architect_number or '-'}). Auto-routed to telecaller {active_telecallers[0].full_name}.",
                user_id=user.id,
                user_name=user.full_name,
                record_id=record.id,
                record_name=record.name,
                status="success",
            )

    # Register metadata for each photo (actual bytes arrive via /upload)
    next_order = max((img.photo_order for img in record.images), default=0)
    for idx, photo in enumerate(request.photos):
        order = next_order + idx + 1
        file_name = canonical_photo_name(record.id, order)
        image_repo.create(
            record_id=record.id,
            google_drive_file_id=f"pending:{record.user_id}/{record.id}/{file_name}",
            file_name=file_name,
            photo_order=order,
            latitude=photo.latitude,
            longitude=photo.longitude,
            location_accuracy=photo.location_accuracy,
            captured_at=photo.captured_at,
        )

    record = record_service.get_record(record.id)
    place = record.location_name or ""
    log_activity(
        db=db,
        action_type="record_create" if not request.task_id else "inspection_complete",
        type="record",
        title="Field record captured" if not request.task_id else "Field inspection completed",
        detail=f"{record.name}" + (f" · {place}" if place else ""),
        user_id=user.id,
        user_name=user.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )
    return _record_to_detail(record)


@router.post("/{record_id}/upload", response_model=RecordDetail)
async def upload_record_images(
    record_id: int,
    files: List[UploadFile],
    background_tasks: BackgroundTasks,
    latitudes: str = Form(""),
    longitudes: str = Form(""),
    accuracies: str = Form(""),
    captured_ats: str = Form(""),
    sources: str = Form(""),
    user: User = Depends(require_record_writer),
    db: Session = Depends(get_db),
):
    """
    Upload image bytes for a record.

    Each photo's authoritative GPS/time was already registered at record
    creation (create_record). This endpoint only delivers the bytes and
    updates the pending rows with the real storage key — it never replaces
    the capture-time GPS with zeros.

    GPS arrays are optional comma-separated form fields matching file order;
    they only apply to rows created without prior metadata.
    """
    record_service = RecordService(db)
    record = record_service.get_record(record_id)

    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    image_service = ImageService()
    image_repo = ImageRepository(db)

    # Existing pending rows carry the authoritative per-photo GPS/time
    pending_images = image_repo.get_pending_by_record_id(record_id)
    pending_by_order = {img.photo_order: img for img in pending_images}

    lats = [float(x) for x in latitudes.split(",") if x] if latitudes else []
    lngs = [float(x) for x in longitudes.split(",") if x] if longitudes else []
    accs = [float(x) for x in accuracies.split(",") if x] if accuracies else []
    times = captured_ats.split(",") if captured_ats else []

    photo_sources = sources.split(",") if sources else []
    if any(source not in ("camera", "uploaded") for source in photo_sources):
        raise HTTPException(status_code=422, detail="Invalid photo source")
    next_order = max((img.photo_order for img in record.images if not img.google_drive_file_id.startswith("pending:")), default=0)
    errors: list[str] = []

    for idx, file in enumerate(files):
        try:
            content = await file.read()

            if len(content) > settings.max_upload_size_bytes:
                errors.append(f"{file.filename} exceeds max size ({settings.MAX_UPLOAD_SIZE_MB}MB)")
                continue
            if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
                errors.append(f"{file.filename} invalid type: {file.content_type}")
                continue

            order = next_order + idx + 1
            pending_img = pending_by_order.get(order)

            # Authoritative metadata comes from the pending row (capture time).
            # Form fields only apply when there is no pending row.
            if pending_img is not None:
                lat = pending_img.latitude
                lng = pending_img.longitude
                acc = pending_img.location_accuracy
                captured_at = pending_img.captured_at
            else:
                lat = lats[idx] if idx < len(lats) else 0.0
                lng = lngs[idx] if idx < len(lngs) else 0.0
                acc = accs[idx] if idx < len(accs) else 0.0
                captured_at = record.created_at
                if idx < len(times) and times[idx]:
                    try:
                        captured_at = dt.fromisoformat(times[idx])
                    except ValueError:
                        pass

            source = photo_sources[idx] if idx < len(photo_sources) else (pending_img.source if pending_img is not None else "camera")
            if source == "uploaded":
                lat = lng = acc = 0.0
            # Watermark must use THIS photo's capture GPS/time
            processed = image_service.process_image(
                image_bytes=content,
                latitude=lat,
                longitude=lng,
                captured_at=captured_at,
                location_name=record.location_name,
                formatted_address=record.formatted_address,
                accuracy=acc,
                uploaded=user.email if source == "uploaded" else None,
            )

            file_name = canonical_photo_name(record_id, order)
            folder = f"{record.user_id}/{record_id}"

            storage_key, storage_type = _save_image(processed, file_name, folder)
            logger.info(f"Saved {file_name} via {storage_type}: {storage_key}")

            # Enqueue asynchronous sync to Google Drive
            background_tasks.add_task(
                sync_to_drive_background,
                file_bytes=processed,
                file_name=file_name,
                folder=folder,
            )

            if pending_img is not None:
                # Update the existing pending row — no duplicate rows
                image_repo.update_storage_key(pending_img, storage_key)
                pending_img.file_name = file_name
                pending_img.source = source
                pending_img.latitude, pending_img.longitude, pending_img.location_accuracy = lat, lng, acc
                db.commit()
            else:
                image_repo.create(
                    record_id=record_id,
                    google_drive_file_id=storage_key,
                    file_name=file_name,
                    photo_order=order,
                    latitude=lat,
                    longitude=lng,
                    location_accuracy=acc,
                    captured_at=captured_at,
                    source=source,
                )

        except Exception as e:
            logger.error(f"Failed to process {file.filename}: {e}", exc_info=True)
            errors.append(f"Error processing {file.filename}")

    # Clean up any remaining pending rows (e.g., fewer files uploaded than photos registered)
    cleaned = image_repo.delete_pending_by_record_id(record_id)
    if cleaned > 0:
        logger.info(f"Cleaned up {cleaned} orphaned pending image rows for record {record_id}")

    record = record_service.get_record(record_id)
    if record and files:
        if record.status == "NOT_COMPLETED":
            record.status = "COMPLETED"
            db.commit()
            db.refresh(record)
        log_activity(
            db=db,
            action_type="photo_upload",
            type="photo",
            title=f"{len(files)} photo{'s' if len(files) != 1 else ''} uploaded",
            detail=f"Uploaded to Record #{record.id} ('{record.name}') by {user.full_name}",
            user_id=user.id,
            user_name=user.full_name,
            record_id=record.id,
            record_name=record.name,
            status="success",
        )
    return _record_to_detail(record, errors=errors or None)


@router.get("", response_model=RecordListResponse)
async def list_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    search: str | None = Query(None, max_length=200),
    user_id: int | None = Query(None),
    date_from: dt | None = Query(None),
    date_to: dt | None = Query(None),
    sort_by: str = Query("assigned_at", pattern=SORT_PATTERN),
    district: str | None = Query(None, max_length=100),
    taluk: str | None = Query(None, max_length=100),
    village: str | None = Query(None, max_length=2000),
    date_field: str = Query("created_at", pattern="^(created_at|assigned_at|captured_at|completed_at)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="From date must be before the To date")
    record_service = RecordService(db)
    filter_user_id = user.id if user.role != UserRole.ADMIN else user_id
    # Audit gateway / anti data-leakage: field operators only see APPROVED
    # records (staged, disapproved, and commercial-property tasks are
    # invisible to them). Privileged roles are not filtered.
    # Field workers (legacy USER operators and dedicated FIELD_VERIFIERs) only
    # ever see auditor-approved records; office roles see the full queue.
    operator_audit_filter = "NOT_DISAPPROVED" if user.role in (UserRole.USER, UserRole.FIELD_VERIFIER) else None
    records, total = record_service.get_user_records(
        user_id=filter_user_id,
        page=page,
        page_size=page_size,
        status=status,
        search=search,
        date_from=date_from,
        date_to=date_to,
        district=district, taluk=taluk, village=village,
        sort_by=sort_by,
        sort_order=sort_order,
        date_field=date_field,
        audit_status=operator_audit_filter,
    )
    return RecordListResponse(
        records=[_record_to_detail(r) for r in records],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/dashboard", response_model=UserDashboardResponse)
async def user_dashboard(
    date_from: dt | None = Query(None),
    date_to: dt | None = Query(None),
    status: str | None = Query(None, pattern="^(COMPLETED|NOT_COMPLETED|MANUALLY_ADDED|REASSIGNED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|CLOSED|OTHER)$"),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Per-user dashboard metrics: totals + recent records for the current user.

    Defined BEFORE /{record_id} so "dashboard" isn't parsed as an id.
    """
    record_service = RecordService(db)
    filter_user_id = None if user.role == UserRole.ADMIN else user.id
    metrics = record_service.get_user_dashboard_metrics(user_id=filter_user_id, date_from=date_from, date_to=date_to, status=status)
    return UserDashboardResponse(
        daily_activity=metrics["daily_activity"],
        manually_added_records=metrics["manually_added_records"],
        construction_yes_records=metrics["construction_yes_records"],
        mobile_numbers_collected=metrics["mobile_numbers_collected"],
        total_completed_records=metrics["total_completed_records"],
        completion_rate=metrics["completion_rate"],
        total_records=metrics["total_records"],
        today_records=metrics["today_records"],
        month_records=metrics["month_records"],
        total_photos=metrics["total_photos"],
        pending_records=metrics.get("pending_records", 0),
        today_completed_records=metrics.get("today_completed_records", 0),
        recent_records=[_record_to_detail(r) for r in metrics["recent_records"]],
    )


@router.get("/{record_id}", response_model=RecordDetail)
async def get_record(
    record_id: int,
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return _record_to_detail(record)


@router.get("/{record_id}/download")
async def download_record(record_id: int, user: User = Depends(require_active_user), db: Session = Depends(get_db)):
    service = RecordService(db)
    record = service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if not service.can_access(user, record):
        raise HTTPException(status_code=403, detail="Not authorized")
    from app.services.record_download_service import build_record_archive
    content = build_record_archive(record, _record_to_detail(record).model_dump(mode="json"))
    log_activity(db=db, action_type="record_download", type="record", title="Full record downloaded", detail=f"Record #{record.id}", user_id=user.id, user_name=user.full_name, record_id=record.id, record_name=record.name, status="success")
    return Response(content, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="Record_{record.id}_full.zip"'})


@router.post("/{record_id}/resolve-address", response_model=AddressResolveResponse)
async def resolve_record_address(
    record_id: int,
    force: bool = Query(False, description="Re-resolve even if an address is already stored"),
    user: User = Depends(require_record_writer),
    db: Session = Depends(get_db),
):
    """Resolve the Google Geocoding address for a record from its captured GPS."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

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


@router.post("/{record_id}/mark-status", response_model=RecordDetail)
async def mark_record_status(
    record_id: int,
    request: MarkStatusRequest,
    user: User = Depends(require_record_writer),
    db: Session = Depends(get_db),
):
    """Mark a record's verification status (e.g. Not Interested, Duplicate, Construction Finished, or back to Pending)."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=403, detail="Not authorized")

    status_map = {
        "NOT_INTERESTED": "Not Interested",
        "DUPLICATE": "Duplicate",
        "CONSTRUCTION_FINISHED": "Construction Finished",
        "Not Interested": "Not Interested",
        "Duplicate": "Duplicate",
        "Construction Finished": "Construction Finished",
        "PENDING": "NOT_COMPLETED",
        "NOT_COMPLETED": "NOT_COMPLETED",
    }
    canonical_status = status_map.get(request.status, request.status)
    old_status = record.status
    record.status = canonical_status
    record.field_captured_at = dt.now(dt_timezone.utc)

    is_revisit = (
        record.reassigned_to_id is not None
        or record.revisit_status in ("REASSIGNED", "PENDING_REVISIT", "Updated Revisited", "UPDATED_REVISITED")
        or old_status in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")
    )
    if is_revisit:
        record.revisit_status = "Updated Revisited"

    if request.field_latitude is not None and request.field_longitude is not None:
        if request.field_latitude != 0 or request.field_longitude != 0:
            record.field_latitude = request.field_latitude
            record.field_longitude = request.field_longitude
            new_coords = f"{request.field_latitude:.6f}, {request.field_longitude:.6f}"
            if is_revisit:
                record.updated_coordinates = new_coords
            elif not record.coordinates:
                record.coordinates = new_coords

    if request.remarks:
        cleaned_remarks = request.remarks.strip()
        if cleaned_remarks:
            if record.remarks:
                record.remarks = f"{record.remarks}\n[Status: {canonical_status}] {cleaned_remarks}"
            else:
                record.remarks = f"[Status: {canonical_status}] {cleaned_remarks}"

    record.updated_by_id = user.id
    record.updated_by_name = user.full_name or user.username
    record.updated_by_role = user.role.value if hasattr(user.role, 'value') else str(user.role)
    record.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(record)

    log_activity(
        db=db,
        action_type="mark_status",
        type="record",
        title=f"Record marked as {canonical_status}",
        detail=f"Status changed from {old_status} to {canonical_status}" + (f": {request.remarks}" if request.remarks else ""),
        user_id=user.id,
        user_name=user.full_name,
        record_id=record.id,
        record_name=record.name,
        status="success",
    )

    return _record_to_detail(record)


@router.get("/{record_id}/gmap-image")
async def serve_record_gmap_image(
    record_id: int,
    zoom: Optional[int] = Query(None, ge=15, le=21, description="Satellite tile zoom level"),
    thumb: bool = Query(False, description="Serve the small list-view thumbnail"),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Serve the record's Google Maps satellite snapshot to the field app.

    A record that was imported before this feature (or a zoom level never built)
    is generated on the spot and then cached, so the field verifier sees the same
    imagery the importer and auditor reviewed.
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
        raise HTTPException(status_code=404, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=403, detail="Not authorized to access this record")

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
        raise HTTPException(status_code=404, detail="No satellite snapshot available for this record")

    file_path = local.get_thumbnail_path(storage_key) if thumb else None
    if not file_path:
        file_path = local.get_file_path(storage_key)
    if not file_path:
        raise HTTPException(status_code=404, detail="Satellite snapshot file not found")

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


@router.get("/{record_id}/qc-reference-image")
async def serve_record_qc_reference_image(
    record_id: int,
    thumb: bool = Query(False, description="Serve thumbnail"),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Serve the record's QC reference image to the field app."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=403, detail="Not authorized to access this record")
    if not record.qc_reference_image_key:
        raise HTTPException(status_code=404, detail="QC reference image not found")

    import os
    from pathlib import Path
    local = LocalStorageService()
    file_path = local.get_thumbnail_path(record.qc_reference_image_key) if thumb else None
    if not file_path:
        file_path = local.get_file_path(record.qc_reference_image_key)
    if not file_path or not os.path.exists(file_path):
        try:
            drive = GoogleDriveService()
            if drive.service:
                filename = Path(record.qc_reference_image_key).name
                file_bytes = drive.download_file_by_name(filename, folder_path="qc_reference")
                if file_bytes:
                    saved_path = local.save_file(file_bytes, filename, folder="qc_reference")
                    file_path = local.get_file_path(saved_path)
        except Exception as e:
            logger.warning(f"Google Drive fallback failed for QC ref image: {e}")

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Reference image file not found on disk")

    return FileResponse(
        file_path,
        media_type="image/jpeg",
        filename=f"Record_{record_id}_QC_Ref.jpg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"qc-ref-{record_id}-{"thumb" if thumb else "full"}"',
        },
    )


@router.get("/{record_id}/image/{image_id}")
async def serve_record_image(
    record_id: int,
    image_id: int,
    thumb: bool = Query(False, description="Serve lightweight thumbnail if available"),
    user: User = Depends(require_active_user),
    db: Session = Depends(get_db),
):
    """Serve a photo: streams from local storage (or thumbnail) or redirects to signed Drive URL."""
    record_service = RecordService(db)
    record = record_service.get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if not record_service.can_access(user, record):
        raise HTTPException(status_code=403, detail="Not authorized to access this record")

    image_repo = ImageRepository(db)
    image = image_repo.get_by_record_and_image_id(record_id, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

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
        return FileResponse(file_path, media_type="image/jpeg", filename=image.file_name, headers=cache_headers)

    # Check local fallback even if storage_key is Drive ID
    local = LocalStorageService()
    candidate_local_path = f"{record.user_id}/{record_id}/{image.file_name}"
    local_path = None
    if thumb:
        local_path = local.get_thumbnail_path(candidate_local_path)
    if not local_path:
        local_path = local.get_file_path(candidate_local_path)
    if local_path:
        return FileResponse(local_path, media_type="image/jpeg", filename=image.file_name, headers=cache_headers)

    # Google Drive file ID (no separators — just alphanumeric)
    try:
        drive = GoogleDriveService()
        if drive.service:
            content = drive.service.files().get_media(fileId=storage_key).execute()
            headers = {
                "Content-Disposition": f'inline; filename="{image.file_name}"',
                **cache_headers,
            }
            return Response(content=content, media_type="image/jpeg", headers=headers)
    except Exception as e:
        logger.error(f"Failed to fetch image {image_id} from Drive: {e}")
    raise HTTPException(status_code=404, detail="Image not available from Drive")


def _record_to_detail(record, errors=None) -> RecordDetail:
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
        status=getattr(record, "status", "NOT_COMPLETED") or "NOT_COMPLETED",
        source=getattr(record, "source", "captured") or "captured",
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
        qc_by_name=record.qc_by.full_name if getattr(record, "qc_by", None) else None,
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
        telecaller_by_name=(record.telecaller_by.full_name or record.telecaller_by.email) if getattr(record, "telecaller_by", None) else None,
        reassigned_to_id=getattr(record, "reassigned_to_id", None),
        reassigned_to_name=(record.reassigned_to.full_name or record.reassigned_to.email) if getattr(record, "reassigned_to", None) else None,
        reassigned_at=getattr(record, "reassigned_at", None),
        revisit_status=getattr(record, "revisit_status", None),
        updated_coordinates=getattr(record, "updated_coordinates", None),
        updated_information=getattr(record, "updated_information", None),
        updated_by_id=getattr(record, "updated_by_id", None),
        updated_by_name=getattr(record, "updated_by_name", None),
        updated_by_role=getattr(record, "updated_by_role", None),
        gmap_image_url=f"/api/records/{record.id}/gmap-image" if getattr(record, "gmap_image_key", None) else None,
        gmap_zoom=getattr(record, "gmap_zoom", None),
        gmap_captured_at=getattr(record, "gmap_captured_at", None),
        qc_reference_image_key=getattr(record, "qc_reference_image_key", None),
        qc_reference_image_url=f"/api/records/{record.id}/qc-reference-image" if getattr(record, "qc_reference_image_key", None) else None,
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
                image_url=f"/api/records/{record.id}/image/{img.id}",
            )
            for img in (record.images or [])
        ],
        errors=errors,
    )
