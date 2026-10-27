from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.capture_record import CaptureRecord
from app.models.user import User
from app.repositories.record_repository import RecordRepository


def _has_gps(image) -> bool:
    """True only for a real fix — photo metadata uses 0/0 when GPS is unavailable."""
    if image.latitude is None or image.longitude is None:
        return False
    return not (image.latitude == 0 and image.longitude == 0)


# Records dispatched via Excel carry a unique_id from the sheet (CBE-110291-770091,
# i.e. city prefix + latitude/longitude scaled by 10^4). Manually added records get
# the same scheme generated from where the operator stood.
DEFAULT_UNIQUE_ID_PREFIX = "CBE"


def generate_unique_id(latitude: float, longitude: float, prefix: str = DEFAULT_UNIQUE_ID_PREFIX) -> str:
    """Build the coordinate-derived unique ID used across the platform.

    ``11.029122, 77.009085`` → ``CBE-110291-770091`` — the same
    prefix + latitude/longitude scaled by 10^4 (≈11 m cells) as the shipped
    Excel-dispatched IDs, zero-padded to six digits per part. Sign-safe:
    southern/western hemispheres fold the sign into the number, never a dash.
    """
    lat = max(-89.9999999, min(89.9999999, float(latitude)))
    lng = max(-179.9999999, min(179.9999999, float(longitude)))
    lat_part = f"{abs(round(lat * 10_000)):06d}"
    lng_part = f"{abs(round(lng * 10_000)):06d}"
    return f"{prefix.upper()}-{lat_part}-{lng_part}"


def _parse_coordinates(value: Optional[str]) -> Optional[tuple[float, float]]:
    """Parse the admin-given coordinates string into (lat, lon). Returns None when unparseable or 0/0."""
    import re
    if not value or not str(value).strip():
        return None
    cleaned = str(value).strip().replace(";", ",").replace("/", ",")
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    if len(parts) == 1:
        parts = cleaned.split()
    if len(parts) < 2:
        return None

    def clean_num(part: str) -> float:
        m = re.search(r"[-+]?\d*\.?\d+", part)
        if not m:
            raise ValueError(f"No numeric coordinate found in {part}")
        val = float(m.group(0))
        upper = part.upper()
        if ("S" in upper or "W" in upper) and not "-" in part:
            val = -abs(val)
        return val

    try:
        latitude = clean_num(parts[0])
        longitude = clean_num(parts[1])
    except (ValueError, TypeError):
        return None
    if latitude == 0 and longitude == 0:
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def compute_record_deviation(record: CaptureRecord) -> Optional[dict]:
    """Calculate distance/deviation between admin coordinates and field GPS fix using Google Maps API."""
    from app.services.location_service import LocationService

    admin_coords = _parse_coordinates(record.coordinates)
    if not admin_coords:
        return None

    images = getattr(record, "images", None) or []
    # Only genuine GPS fix (excluding 0,0)
    gps_img = next((img for img in images if _has_gps(img)), None)
    if gps_img:
        return LocationService().calculate_deviation(
            admin_coords[0], admin_coords[1], gps_img.latitude, gps_img.longitude
        )

    # No-photo inspections: fall back to the standalone device fix stored on
    # the record itself, so deviation verification still works.
    field_lat = getattr(record, "field_latitude", None)
    field_lon = getattr(record, "field_longitude", None)
    if field_lat is None or field_lon is None or (field_lat == 0 and field_lon == 0):
        return None
    return LocationService().calculate_deviation(admin_coords[0], admin_coords[1], field_lat, field_lon)


# A pending image row older than this is abandoned (client died between
# record creation and the /upload call). The upload flow cleans its own
# pendings; this threshold only decides when OTHER paths may sweep them.
PENDING_IMAGE_STALE_MINUTES = 30


class RecordService:
    # Roles allowed to see every record in the portal (record details included).
    # Managers oversee the queues; auditors review the audit queue.
    RECORD_MANAGER_ROLES = ("ADMIN", "MANAGER", "AUDITOR")

    def __init__(self, db: Session):
        self.db = db
        self.record_repo = RecordRepository(db)

    def cleanup_stale_pending_images(self, max_age_minutes: int = PENDING_IMAGE_STALE_MINUTES) -> int:
        """Delete orphaned 'pending:' image placeholder rows.

        Record creation registers one 'pending:' CapturedImage row per photo;
        the /upload call fills them with a real storage key (or deletes them on
        failure). If the client dies between those two steps the rows are never
        cleaned and render as permanently broken image tiles in both portals.
        Sweep rows that are still pending after a grace period — no upload can
        still be in flight for them.
        Returns the number of rows deleted.
        """
        from app.models.captured_image import CapturedImage

        # SQLite stores naive datetimes; compare against a naive UTC cutoff
        # so the lexicographic datetime comparison stays consistent.
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)
        stale = (
            self.db.query(CapturedImage)
            .filter(
                CapturedImage.google_drive_file_id.like("pending:%"),
                CapturedImage.created_at < cutoff,
            )
            .all()
        )
        if not stale:
            return 0
        for image in stale:
            self.db.delete(image)
        self.db.commit()
        return len(stale)

    def next_unique_id(self, latitude: float, longitude: float) -> str:
        """Coordinate-derived unique ID, suffixed -2, -3… when the same ≈11 m
        cell already has a record (two inspections on one rooftop, say)."""
        base = generate_unique_id(latitude, longitude)
        candidate = base
        suffix = 1
        while self.db.query(CaptureRecord.id).filter(CaptureRecord.unique_id == candidate).first() is not None:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    def create_record(
        self,
        user_id: int,
        name: str,
        description: str = "",
        location_name: Optional[str] = None,
        formatted_address: Optional[str] = None,
        place_id: Optional[str] = None,
        status: str = "NOT_COMPLETED",
        **extra_fields,
    ) -> CaptureRecord:
        return self.record_repo.create(
            user_id=user_id,
            name=name,
            description=description,
            location_name=location_name,
            formatted_address=formatted_address,
            place_id=place_id,
            status=status,
            **extra_fields,
        )

    def get_record(self, record_id: int) -> Optional[CaptureRecord]:
        self._sweep_stale_pending_images_for_record(record_id)
        return self.record_repo.get_by_id(record_id)

    def _sweep_stale_pending_images_for_record(self, record_id: int) -> None:
        """Janitor for orphaned pending image rows on the record being read.

        The /upload call fills pending rows (or deletes them on failure). If
        the client dies between record creation and upload, the rows are never
        cleaned and render as permanently broken image tiles in both portals.
        Only rows older than the grace period are swept — a fresh pending row
        may legitimately belong to an upload in flight.
        """
        from datetime import timedelta as _td

        from app.models.captured_image import CapturedImage
        from app.repositories.image_repository import ImageRepository

        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - _td(
            minutes=PENDING_IMAGE_STALE_MINUTES
        )
        stale_ids = [
            row.id
            for row in self.db.query(CapturedImage.id)
            .filter(
                CapturedImage.record_id == record_id,
                CapturedImage.google_drive_file_id.like("pending:%"),
                CapturedImage.created_at < cutoff,
            )
            .all()
        ]
        if not stale_ids:
            return
        for image_id in stale_ids:
            image = ImageRepository(self.db).get_by_id(image_id)
            if image is not None:
                self.db.delete(image)
        self.db.commit()
        import logging

        logging.getLogger(__name__).info(
            "Swept %d orphaned pending image row(s) for record %s", len(stale_ids), record_id
        )

    def get_user_records(
        self,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
        status: Optional[str] = None,
        search: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        date_field: str = "created_at",
        audit_status: Optional[str] = None,
        qc_status: Optional[str] = None,
        **filters,
    ) -> tuple[List[CaptureRecord], int]:
        self.cleanup_stale_pending_images()
        return self.record_repo.list_records(
            page=page,
            page_size=page_size,
            user_id=user_id,
            status=status,
            search=search,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_order=sort_order,
            date_field=date_field,
            audit_status=audit_status,
            qc_status=qc_status,
            **filters,
        )

    def get_all_records(
        self,
        page: int = 1,
        page_size: int = 20,
        status: Optional[str] = None,
        search: Optional[str] = None,
        user_id: Optional[int] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        date_field: str = "created_at",
        audit_status: Optional[str] = None,
        qc_status: Optional[str] = None,
        **filters,
    ) -> tuple[List[CaptureRecord], int]:
        self.cleanup_stale_pending_images()
        return self.record_repo.list_records(
            page=page,
            page_size=page_size,
            user_id=user_id,
            status=status,
            search=search,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_order=sort_order,
            date_field=date_field,
            audit_status=audit_status,
            qc_status=qc_status,
            **filters,
        )

    def update_record(
        self,
        record: CaptureRecord,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> CaptureRecord:
        kwargs = {}
        if name is not None:
            kwargs["name"] = name
        if description is not None:
            kwargs["description"] = description
        if kwargs:
            return self.record_repo.update(record, **kwargs)
        return record

    def resolve_address(
        self, record: CaptureRecord, force: bool = False
    ) -> tuple[CaptureRecord, Optional[str]]:
        """
        Backfill both Google Geocoding addresses for a record.

        Two sources are resolved so the operator's location and the admin's
        planned location can be compared in words, not just in coordinates:

        * ``formatted_address`` — from the first captured photo that has a GPS fix
        * ``admin_formatted_address`` — from the admin-given ``coordinates``

        Records captured while the geocoding key was missing keep these empty and
        would render blank forever, hence the on-demand backfill. The shared
        location cache means repeat calls do not re-bill Google.

        Returns ``(record, error)``. The captured-GPS address is the primary one,
        so ``error`` describes that address only — and only when it is missing
        afterwards. A reused address from an earlier resolution always counts as
        resolved. The admin address is best-effort: records without admin-given
        coordinates simply keep it empty.
        """
        from app.repositories.image_repository import ImageRepository
        from app.services.location_cache_service import get_location_cache_service
        from app.services.location_service import LocationService

        def geocode(latitude: float, longitude: float):
            return get_location_cache_service().resolve(
                latitude,
                longitude,
                geocode_func=LocationService().reverse_geocode,
            )

        updates: dict = {}
        reason = None

        # 1. Address of the location the operator actually stood at.
        if force or not record.formatted_address:
            gps = next(
                (img for img in ImageRepository(self.db).get_by_record_id(record.id) if _has_gps(img)),
                None,
            )
            if gps is None and record.field_latitude is not None and record.field_longitude is not None and (record.field_latitude != 0 or record.field_longitude != 0):
                from types import SimpleNamespace
                gps = SimpleNamespace(latitude=record.field_latitude, longitude=record.field_longitude)
            if gps is None:
                reason = "No GPS coordinates captured for this record"
            else:
                entry = geocode(gps.latitude, gps.longitude)
                if entry is None or not entry.formatted_address:
                    reason = "Google Geocoding did not return an address"
                else:
                    updates["formatted_address"] = entry.formatted_address
                    if entry.location_name and not record.location_name:
                        updates["location_name"] = entry.location_name
                    if entry.place_id and not record.place_id:
                        updates["place_id"] = entry.place_id

        # 2. Address of the position the admin planned for. Failures here are not
        #    reported as an error — plenty of records carry no admin coordinates.
        if force or not record.admin_formatted_address:
            parsed = _parse_coordinates(record.coordinates)
            if parsed is not None:
                entry = geocode(*parsed)
                if entry is not None and entry.formatted_address:
                    updates["admin_formatted_address"] = entry.formatted_address

        if updates:
            record = self.record_repo.update(record, **updates)

        return record, (None if record.formatted_address else reason)

    def delete_record(self, record: CaptureRecord) -> None:
        self.record_repo.delete(record)

    def can_access(self, user: User, record: CaptureRecord) -> bool:
        if user.role.value in ("ADMIN", "MANAGER"):
            return True
        if user.role.value == "AUDITOR":
            # Audit workflow: auditors review every record in the queue.
            return True
        if user.role.value == "TELECALLER":
            return record.assigned_telecaller_id == user.id or record.assigned_telecaller_id is None
        # Field workers (USER operators and FIELD_VERIFIERs) see their own records.
        return (record.user_id == user.id or record.reassigned_to_id == user.id) and record.audit_status not in ("DISAPPROVAL", "COMMERCIAL_PROPERTY")

    def audit_record(
        self,
        record: CaptureRecord,
        audit_status: str,
        audit_comment: Optional[str],
        auditor: User,
        qc_vhr_comment: Optional[str] = None,
        qc_street_details: Optional[str] = None,
        qc_builder_contact: Optional[str] = None,
        qc_sqfeet: Optional[str] = None,
        qc_completed_at: Optional[datetime] = None,
        coordinates: Optional[str] = None,
    ) -> CaptureRecord:
        """Apply an auditor decision to a routed record.

        The decision is recorded (status, comment, auditor, timestamp) but the
        record is NOT assigned to anyone here — assignment to a field verifier
        is a separate, explicit step done by the Record Assigner on APPROVAL
        rows (assign_verifier). DISAPPROVAL / COMMERCIAL_PROPERTY clear any
        verifier so the task never reaches a field operator.
        """
        coords_changed = False
        if coordinates and coordinates.strip():
            clean_coords = coordinates.strip()
            if clean_coords != (record.coordinates or "").strip():
                record.coordinates = clean_coords
                coords_changed = True

        qc_changed = False
        if qc_vhr_comment is not None and (qc_vhr_comment.strip() or None) != record.qc_vhr_comment:
            qc_changed = True
        if qc_street_details is not None and (qc_street_details.strip() or None) != record.qc_street_details:
            qc_changed = True
        if qc_builder_contact is not None and (qc_builder_contact.strip() or None) != record.qc_builder_contact:
            qc_changed = True
        if qc_sqfeet is not None and (qc_sqfeet.strip() or None) != record.qc_sqfeet:
            qc_changed = True

        if (coords_changed or qc_changed) and audit_status in ("APPROVAL", "PENDING", "", None):
            audit_status = "RE_AUDITED"
        if auditor.role.value == "AUDITOR" and record.assigned_auditor_id not in (None, auditor.id):
            raise PermissionError("This record is assigned to another auditor")
        record.audit_status = audit_status
        record.audit_comment = (audit_comment or "").strip() or None
        now = datetime.now(timezone.utc)
        is_already_done = bool(record.qc_completed_at)

        record.audited_by_id = auditor.id
        record.audited_at = now
        if auditor.role.value == "AUDITOR":
            record.assigned_auditor_id = auditor.id

        # QC assessment from VHR imagery / street view — updated only when the
        # auditor supplied a value, so re-deciding never blanks stored QC data.
        if qc_vhr_comment is not None:
            record.qc_vhr_comment = qc_vhr_comment.strip() or None
        if qc_street_details is not None:
            record.qc_street_details = qc_street_details.strip() or None
        if qc_builder_contact is not None:
            record.qc_builder_contact = qc_builder_contact.strip() or None
        if qc_sqfeet is not None:
            record.qc_sqfeet = qc_sqfeet.strip() or None

        if any(value is not None for value in (qc_vhr_comment, qc_street_details, qc_builder_contact, qc_sqfeet)):
            has_qc = any((value or '').strip() for value in (record.qc_vhr_comment, record.qc_street_details, record.qc_builder_contact, record.qc_sqfeet))
            if has_qc:
                record.qc_by_id = auditor.id
                if is_already_done:
                    record.qc_edited_at = now
                else:
                    record.qc_completed_at = now
                    record.qc_edited_at = None
            else:
                record.qc_completed_at = None
                record.qc_edited_at = None
                record.qc_by_id = None

        if record.status not in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED") and audit_status not in ("APPROVAL", "RE_AUDITED"):
            # Blocked outcomes: never assigned to a field operator.
            record.user_id = None

        self.db.commit()
        self.db.refresh(record)
        return record

    def assign_auditor(
        self,
        record: CaptureRecord,
        auditor_id: int,
        assigner: User,
    ) -> CaptureRecord:
        """Route/reassign a record to a QC user (auditor) for review."""
        record.assigned_auditor_id = auditor_id
        record.audit_status = "PENDING"
        record.status = "NOT_COMPLETED"
        record.updated_at = datetime.now(timezone.utc)
        # Preserve all QC details, comments, and inspection data intact.
        self.db.commit()
        self.db.refresh(record)
        return record

    def unassign_auditor(
        self,
        record: CaptureRecord,
        assigner: User,
    ) -> CaptureRecord:
        """Clear the assigned auditor from a record."""
        record.assigned_auditor_id = None
        record.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(record)
        return record

    def assign_verifier(
        self,
        record: CaptureRecord,
        verifier_id: int,
        assigner: User,
    ) -> CaptureRecord:
        """Assign or reassign a record to a field verifier."""
        if record.audit_status in ("DISAPPROVAL", "COMMERCIAL_PROPERTY") or getattr(record, "property_type", None) in ("Commercial Property", "COMMERCIAL_PROPERTY"):
            raise ValueError("Disapproved or commercial records cannot be assigned to a field verifier")

        now_utc = datetime.now(timezone.utc)
        record.user_id = verifier_id
        record.staged_operator_id = verifier_id
        record.reassigned_to_id = verifier_id
        record.reassigned_at = now_utc
        record.assigned_at = now_utc
        record.updated_at = now_utc

        # Verification Status is marked NOT_COMPLETED and REASSIGNED
        record.status = "NOT_COMPLETED"
        record.revisit_status = "REASSIGNED"

        # DO NOT wipe any QC details, comments, or audit decisions!
        self.db.commit()
        self.db.refresh(record)
        return record

    def unassign_verifier(
        self,
        record: CaptureRecord,
        assigner: User,
    ) -> CaptureRecord:
        """Clear the field verifier assignment from an uncompleted record."""
        if record.status == "COMPLETED":
            raise ValueError("Completed records cannot be unassigned")
        record.user_id = None
        record.assigned_at = None
        record.staged_operator_id = None
        record.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(record)
        return record

    def period_metrics(self, date_from=None, date_to=None, status=None, user_id=None):
        """Counts for one filtered set, using actual photo / field capture time."""
        import re
        from sqlalchemy import func, case, or_, and_, not_
        from app.models.captured_image import CapturedImage
        from app.repositories.record_repository import record_date_column, local_day_bounds, BUSINESS_TZ
        from datetime import datetime, timedelta, timezone
        query = self.db.query(CaptureRecord)
        is_completed = or_(CaptureRecord.status.in_(('COMPLETED', 'Updated Revisited', 'UPDATED_REVISITED')), func.coalesce(CaptureRecord.revisit_status, '') == 'COMPLETED')
        is_closed = or_(
            CaptureRecord.status.in_(["NOT_INTERESTED", "Not Interested", "DUPLICATE", "Duplicate", "CONSTRUCTION_FINISHED", "Construction Finished"]),
            CaptureRecord.status.ilike("%not_interested%"),
            CaptureRecord.status.ilike("%not interested%"),
            CaptureRecord.status.ilike("%duplicate%"),
            CaptureRecord.status.ilike("%construction_finished%"),
            CaptureRecord.status.ilike("%construction finished%"),
        )
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id, CaptureRecord.audit_status == 'APPROVAL')
        if status == 'COMPLETED':
            query = query.filter(is_completed)
        elif status == 'NOT_COMPLETED':
            query = query.filter(not_(is_completed), not_(is_closed))
        elif status in ('CLOSED', 'OTHER'):
            query = query.filter(is_closed)
        elif status:
            query = query.filter(CaptureRecord.status == status)
        captured = func.julianday(record_date_column('assigned_at' if status == 'NOT_COMPLETED' else 'captured_at'))
        if date_from:
            query = query.filter(captured >= func.julianday(date_from))
        if date_to:
            query = query.filter(captured <= func.julianday(date_to))
        total, completed, pending, construction = query.with_entities(
            func.count(CaptureRecord.id),
            func.sum(case((is_completed, 1), else_=0)),
            func.sum(case((and_(not_(is_completed), not_(is_closed), or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != 'DISAPPROVAL')), 1), else_=0)),
            func.sum(case((func.lower(func.trim(CaptureRecord.construction_happening)) == 'yes', 1), else_=0)),
        ).one()
        numbers = set()
        for contact, contractor in query.with_entities(CaptureRecord.contact_number, CaptureRecord.site_contractor_architect_number):
            for value in (contact, contractor):
                # Count distinct collected mobile numbers, including contractor contacts.
                for part in re.split(r'[,;/\n]', value or ''):
                    digits = re.sub(r'\D', '', part)
                    if len(digits) == 12 and digits.startswith('91'):
                        digits = digits[2:]
                    if len(digits) == 11 and digits.startswith('0'):
                        digits = digits[1:]
                    if len(digits) == 10 and digits[0] in '6789':
                        numbers.add(digits)
        ids = query.with_entities(CaptureRecord.id)
        photos = self.db.query(CapturedImage).filter(CapturedImage.record_id.in_(ids),
            CapturedImage.google_drive_file_id.notlike('pending:%')).count()
        day_start, day_end = local_day_bounds()
        def between(column, start, end):
            return query.filter(func.julianday(column) >= func.julianday(start), func.julianday(column) < func.julianday(end)).count()
        month_start = datetime.now(BUSINESS_TZ).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_end = (month_start + timedelta(days=32)).replace(day=1)
        return {'today_records': between(CaptureRecord.created_at, day_start, day_end),
                'today_completed_records': between(record_date_column('completed_at'), day_start, day_end),
                'month_records': between(CaptureRecord.created_at, month_start.astimezone(timezone.utc), month_end.astimezone(timezone.utc)),
                'total_records': total, 'total_completed_records': completed or 0,
                'manually_added_records': query.filter(CaptureRecord.is_manually_added).count(),
                'pending_records': pending or 0, 'total_photos': photos,
                'construction_yes_records': construction or 0, 'mobile_numbers_collected': len(numbers),
                'completion_rate': round((completed or 0) / total * 100, 1) if total else 0.0}

    def daily_activity(self, date_from=None, date_to=None, status=None, user_id=None):
        from datetime import datetime, timedelta, timezone
        from sqlalchemy import func, case, or_, and_, not_
        from app.repositories.record_repository import record_date_column, BUSINESS_TZ
        def local_date(value):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.astimezone(BUSINESS_TZ).date()
        last = local_date(date_to) if date_to else datetime.now(BUSINESS_TZ).date()
        first = local_date(date_from) if date_from else last - timedelta(days=6)
        first = max(first, last - timedelta(days=30))
        if first > last:
            return []
        stamp = record_date_column('assigned_at' if status == 'NOT_COMPLETED' else 'captured_at')
        day = func.date(stamp, '+330 minutes')
        is_completed = or_(CaptureRecord.status.in_(('COMPLETED', 'Updated Revisited', 'UPDATED_REVISITED')), func.coalesce(CaptureRecord.revisit_status, '') == 'COMPLETED')
        is_closed = or_(
            CaptureRecord.status.in_(["NOT_INTERESTED", "Not Interested", "DUPLICATE", "Duplicate", "CONSTRUCTION_FINISHED", "Construction Finished"]),
            CaptureRecord.status.ilike("%not_interested%"),
            CaptureRecord.status.ilike("%not interested%"),
            CaptureRecord.status.ilike("%duplicate%"),
            CaptureRecord.status.ilike("%construction_finished%"),
            CaptureRecord.status.ilike("%construction finished%"),
        )
        query = self.db.query(day,
            func.sum(case((is_completed, 1), else_=0)),
            func.sum(case((and_(not_(is_completed), not_(is_closed)), 1), else_=0)),
            func.sum(case((func.lower(func.trim(CaptureRecord.construction_happening)) == 'yes', 1), else_=0)),
        ).filter(day >= first.isoformat(), day <= last.isoformat())
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id, CaptureRecord.audit_status == 'APPROVAL')
        if status:
            query = query.filter(CaptureRecord.status == status)
        if date_from:
            query = query.filter(func.julianday(stamp) >= func.julianday(date_from))
        if date_to:
            query = query.filter(func.julianday(stamp) <= func.julianday(date_to))
        grouped = {row[0]: row[1:] for row in query.group_by(day).all()}
        result = []
        for offset in range((last-first).days + 1):
            date = (first + timedelta(days=offset)).isoformat()
            completed, pending, construction = grouped.get(date, (0, 0, 0))
            result.append({'date': date, 'completed': completed or 0, 'pending': pending or 0, 'construction_yes': construction or 0})
        return result

    def get_dashboard_metrics(
        self,
        date_from=None,
        date_to=None,
        status=None,
        preset="allTime",
        custom_from=None,
        custom_to=None,
        district=None,
    ) -> dict:
        from app.models.activity_log import ActivityLog
        from app.repositories.record_repository import record_date_column, BUSINESS_TZ
        from sqlalchemy import func, case, or_, and_, desc, cast, String, not_
        from datetime import datetime, timedelta, timezone

        # 1. Resolve date boundaries and reporting label
        now = datetime.now(BUSINESS_TZ)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)

        eff_from, eff_to = None, None
        period_label = "All Time"

        preset_key = (preset or "allTime").lower()

        if preset_key == "today":
            eff_from, eff_to = today_start, today_end
            period_label = f"Today ({today_start.strftime('%d %b %Y')})"
        elif preset_key == "yesterday":
            yest_start = today_start - timedelta(days=1)
            yest_end = today_end - timedelta(days=1)
            eff_from, eff_to = yest_start, yest_end
            period_label = f"Yesterday ({yest_start.strftime('%d %b %Y')})"
        elif preset_key in ("last7days", "last7"):
            eff_from = (today_start - timedelta(days=6)).replace(hour=0, minute=0, second=0)
            eff_to = today_end
            period_label = f"Last 7 Days ({eff_from.strftime('%d %b')} – {eff_to.strftime('%d %b %Y')})"
        elif preset_key in ("last30days", "last30"):
            eff_from = (today_start - timedelta(days=29)).replace(hour=0, minute=0, second=0)
            eff_to = today_end
            period_label = f"Last 30 Days ({eff_from.strftime('%d %b')} – {eff_to.strftime('%d %b %Y')})"
        elif preset_key in ("thismonth", "month"):
            eff_from = today_start.replace(day=1)
            eff_to = today_end
            period_label = f"This Month ({eff_from.strftime('%b %Y')})"
        elif preset_key in ("lastmonth",):
            first_this_month = today_start.replace(day=1)
            last_prev_month = first_this_month - timedelta(days=1)
            eff_from = last_prev_month.replace(day=1)
            eff_to = last_prev_month.replace(hour=23, minute=59, second=59, microsecond=999999)
            period_label = f"Last Month ({eff_from.strftime('%b %Y')})"
        elif preset_key in ("thisyear", "year"):
            eff_from = today_start.replace(month=1, day=1)
            eff_to = today_end
            period_label = f"This Year ({eff_from.year})"
        elif preset_key == "custom" and custom_from and custom_to:
            try:
                eff_from = datetime.fromisoformat(custom_from).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=BUSINESS_TZ)
                eff_to = datetime.fromisoformat(custom_to).replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=BUSINESS_TZ)
                period_label = f"Custom ({eff_from.strftime('%d %b %Y')} – {eff_to.strftime('%d %b %Y')})"
            except Exception:
                pass
        elif date_from or date_to:
            eff_from = date_from
            eff_to = date_to
            period_label = "Filtered Range"

        period_info = {
            "preset": preset or "allTime",
            "date_from": eff_from.isoformat() if eff_from else None,
            "date_to": eff_to.isoformat() if eff_to else None,
            "label": period_label,
        }

        # 2. Base query filtered by scope, status, and dates
        q_base = self.db.query(CaptureRecord)
        if district:
            q_base = q_base.filter(CaptureRecord.district == district)
        is_completed = or_(
            CaptureRecord.status.in_(("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")),
            func.coalesce(CaptureRecord.revisit_status, "") == "COMPLETED",
        )
        is_closed = or_(
            CaptureRecord.status.in_(["NOT_INTERESTED", "Not Interested", "DUPLICATE", "Duplicate", "CONSTRUCTION_FINISHED", "Construction Finished"]),
            CaptureRecord.status.ilike("%not_interested%"),
            CaptureRecord.status.ilike("%not interested%"),
            CaptureRecord.status.ilike("%duplicate%"),
            CaptureRecord.status.ilike("%construction_finished%"),
            CaptureRecord.status.ilike("%construction finished%"),
        )
        if status == "COMPLETED":
            q_base = q_base.filter(is_completed)
        elif status == "NOT_COMPLETED":
            q_base = q_base.filter(not_(is_completed), not_(is_closed))
        elif status in ("CLOSED", "OTHER"):
            q_base = q_base.filter(is_closed)
        elif status:
            q_base = q_base.filter(CaptureRecord.status == status)

        if eff_from or eff_to:
            date_col = func.julianday(record_date_column('assigned_at' if status == 'NOT_COMPLETED' else 'captured_at'))
            if eff_from:
                q_base = q_base.filter(date_col >= func.julianday(eff_from))
            if eff_to:
                q_base = q_base.filter(date_col <= func.julianday(eff_to))

        total_records = q_base.count()
        commercial_records = q_base.filter(
            or_(
                CaptureRecord.audit_status == "COMMERCIAL_PROPERTY",
                CaptureRecord.property_type == "Commercial Property",
            )
        ).count()
        eligible_for_field = max(0, total_records - commercial_records)

        sent_to_field = q_base.filter(CaptureRecord.user_id.isnot(None)).count()
        unassigned_properties = q_base.filter(CaptureRecord.user_id.is_(None)).count()
        completed_verifications = q_base.filter(
            or_(
                CaptureRecord.status.in_(("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")),
                func.coalesce(CaptureRecord.revisit_status, "") == "COMPLETED",
            )
        ).count()
        closed_verifications = q_base.filter(is_closed).count()
        disapproved_records = q_base.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
        pending_verifications = q_base.filter(
            not_(is_completed),
            not_(is_closed),
            or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != "DISAPPROVAL"),
        ).count()
        completion_rate = round(completed_verifications / total_records * 100, 1) if total_records else 0.0

        confirmed_construction = q_base.filter(
            func.lower(func.trim(CaptureRecord.construction_happening)) == "yes"
        ).count()

        phone_numbers_obtained = q_base.filter(
            or_(
                func.coalesce(func.trim(CaptureRecord.contact_number), "") != "",
                func.coalesce(func.trim(CaptureRecord.site_contractor_architect_number), "") != "",
                func.coalesce(func.trim(CaptureRecord.qc_builder_contact), "") != "",
            )
        ).count()

        manually_added = q_base.filter(CaptureRecord.is_manually_added).count()

        overview = {
            "total_records": total_records,
            "total_commercial_properties": commercial_records,
            "eligible_for_field": eligible_for_field,
            "sent_to_field": sent_to_field,
            "unassigned_properties": unassigned_properties,
            "completed_verifications": completed_verifications,
            "closed_verifications": closed_verifications,
            "disapproved_verifications": disapproved_records,
            "pending_verifications": pending_verifications,
            "completion_rate": completion_rate,
            "confirmed_construction": confirmed_construction,
            "phone_numbers_obtained": phone_numbers_obtained,
            "manually_added": manually_added,
            "period_created": total_records,
            "period_assigned": sent_to_field,
            "period_completed": completed_verifications,
        }

        # 3. PPT Funnel & Summary Split (dynamic with active filter)
        false_positives_qc = q_base.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
        funnel = {
            "identified_sites": total_records,
            "sent_for_verification": sent_to_field,
            "false_positives_qc": false_positives_qc,
            "commercial_property_qc": commercial_records,
            "field_verification_completed": completed_verifications,
            "pending_for_field_verification": pending_verifications,
            "confirmed_construction": confirmed_construction,
            "phone_numbers_obtained": phone_numbers_obtained,
            "manually_added": manually_added,
        }

        # 4. Telecalling breakdown (matching active filter scope)
        q_tele = q_base.filter(
            or_(
                CaptureRecord.assigned_telecaller_id.isnot(None),
                CaptureRecord.telecaller_status.isnot(None),
            )
        )
        total_leads = q_tele.count()
        calls_completed = q_tele.filter(
            CaptureRecord.telecaller_status.isnot(None),
            CaptureRecord.telecaller_status != "PENDING",
        ).count()
        calls_pending = total_leads - calls_completed
        const_confirmed_tele = q_tele.filter(CaptureRecord.telecaller_status == "CONSTRUCTION_CONFIRMED").count()
        follow_up_tele = q_tele.filter(CaptureRecord.telecaller_status == "CONNECTED_FOLLOW_UP").count()
        not_reachable_tele = q_tele.filter(CaptureRecord.telecaller_status == "NOT_REACHABLE").count()
        other_tele = calls_completed - (const_confirmed_tele + follow_up_tele + not_reachable_tele)

        telecalling = {
            "total_leads": total_leads,
            "calls_completed": calls_completed,
            "calls_pending": max(0, calls_pending),
            "construction_confirmed": const_confirmed_tele,
            "follow_up_needed": follow_up_tele,
            "not_reachable": not_reachable_tele,
            "other_outcomes": max(0, other_tele),
        }

        # 5. Multi-series Trend Chart (Completed, Assigned, Total Sends)
        if eff_from and eff_to and (eff_to - eff_from).days <= 31:
            trend_days_count = max(7, (eff_to - eff_from).days + 1)
            trend_start = eff_from
        else:
            trend_days_count = 7
            trend_start = (today_start - timedelta(days=6))

        trend_day_strings = [
            (trend_start + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(trend_days_count)
        ]

        comp_col = func.substr(cast(record_date_column("completed_at"), String), 1, 10)
        comp_map = dict(self.db.query(comp_col, func.count()).filter(comp_col.in_(trend_day_strings)).group_by(comp_col).all())

        assign_col = func.substr(cast(record_date_column("assigned_at"), String), 1, 10)
        assign_map = dict(self.db.query(assign_col, func.count()).filter(assign_col.in_(trend_day_strings)).group_by(assign_col).all())

        conf_map = dict(
            self.db.query(comp_col, func.count())
            .filter(
                comp_col.in_(trend_day_strings),
                func.lower(func.trim(CaptureRecord.construction_happening)) == "yes",
            )
            .group_by(comp_col)
            .all()
        )

        create_col = func.substr(cast(CaptureRecord.created_at, String), 1, 10)
        create_map = dict(self.db.query(create_col, func.count()).filter(create_col.in_(trend_day_strings)).group_by(create_col).all())

        trends = []
        for d in trend_day_strings:
            dt = datetime.fromisoformat(d)
            trends.append({
                "date": d,
                "label": dt.strftime("%b %d").replace(" 0", " "),
                "completed": comp_map.get(d, 0),
                "assigned": assign_map.get(d, 0),
                "confirmed": conf_map.get(d, 0),
                "total_sends": create_map.get(d, 0),
            })

        # 6. Distribution (matching active filter scope)
        by_district = [
            {"label": row[0] or "Unspecified", "count": row[1], "completed": row[2] or 0, "pending": row[3] or 0}
            for row in q_base.with_entities(
                func.coalesce(CaptureRecord.district, "Unspecified"),
                func.count(),
                func.sum(case((CaptureRecord.status == "COMPLETED", 1), else_=0)),
                func.sum(case((CaptureRecord.status == "NOT_COMPLETED", 1), else_=0)),
            ).group_by(CaptureRecord.district).order_by(desc(func.count())).limit(6).all()
        ]

        by_taluk = [
            {"label": row[0] or "Unspecified", "count": row[1], "completed": row[2] or 0, "pending": row[3] or 0}
            for row in q_base.with_entities(
                func.coalesce(CaptureRecord.taluk, "Unspecified"),
                func.count(),
                func.sum(case((CaptureRecord.status == "COMPLETED", 1), else_=0)),
                func.sum(case((CaptureRecord.status == "NOT_COMPLETED", 1), else_=0)),
            ).group_by(CaptureRecord.taluk).order_by(desc(func.count())).limit(6).all()
        ]

        by_type = [
            {"label": row[0], "count": row[1], "completed": 0, "pending": 0}
            for row in self.db.query(
                case(
                    (or_(CaptureRecord.audit_status == "COMMERCIAL_PROPERTY", CaptureRecord.property_type == "Commercial Property"), "Commercial Property"),
                    (CaptureRecord.land_use.ilike("%residen%"), "Residential"),
                    (CaptureRecord.land_use.ilike("%agri%"), "Agricultural"),
                    (CaptureRecord.land_use.ilike("%indust%"), "Industrial"),
                    else_="Other / General",
                ).label("ptype"),
                func.count(),
            ).group_by("ptype").order_by(desc(func.count())).all()
        ]

        by_stage = [
            {"label": row[0] or "Unspecified", "count": row[1], "completed": 0, "pending": 0}
            for row in self.db.query(
                func.coalesce(CaptureRecord.stage_of_construction, "Unspecified"),
                func.count(),
            ).filter(func.coalesce(CaptureRecord.stage_of_construction, "") != "").group_by(CaptureRecord.stage_of_construction).order_by(desc(func.count())).limit(6).all()
        ]

        distribution = {
            "by_district": by_district,
            "by_taluk": by_taluk,
            "by_type": by_type,
            "by_stage": by_stage,
        }

        # 7. Field Verifiers Stats
        inspector_stats = []
        users = self.db.query(User).filter(User.is_active == True).order_by(User.full_name).all()
        for u in users:
            if u.role.value not in ("USER", "FIELD_VERIFIER"):
                continue
            scoped = self.period_metrics(eff_from, eff_to, status, u.id)
            assigned, completed, u_pending, rate = scoped['total_records'], scoped['total_completed_records'], scoped['pending_records'], scoped['completion_rate']
            u_today_comp = scoped['today_completed_records']
            u_const = self.db.query(CaptureRecord).filter(
                CaptureRecord.user_id == u.id,
                func.lower(func.trim(CaptureRecord.construction_happening)) == "yes",
            ).count()
            u_phones = self.db.query(CaptureRecord).filter(
                CaptureRecord.user_id == u.id,
                or_(
                    func.coalesce(func.trim(CaptureRecord.contact_number), "") != "",
                    func.coalesce(func.trim(CaptureRecord.site_contractor_architect_number), "") != "",
                ),
            ).count()

            inspector_stats.append({
                "user_id": u.id,
                "user_name": u.full_name,
                "email": u.email,
                "role": u.role.value,
                "total_assigned": assigned,
                "completed": completed,
                "pending": u_pending,
                "today_completed": u_today_comp,
                "completion_rate": rate,
                "confirmed_construction": u_const,
                "phones_obtained": u_phones,
            })

        # 8. Recent Activities
        recent_activities = []
        try:
            logs = self.db.query(ActivityLog).order_by(desc(ActivityLog.created_at)).limit(10).all()
            for l in logs:
                recent_activities.append({
                    "id": l.id,
                    "type": l.action_type or "system",
                    "title": l.title or "System Activity",
                    "detail": l.detail or "",
                    "timestamp": l.created_at.isoformat() if l.created_at else "",
                    "user_name": l.user_name or "System",
                    "status": l.status or "success",
                })
        except Exception:
            pass

        legacy_metrics = self.period_metrics(eff_from, eff_to, status)

        return {
            "period_info": period_info,
            "overview": overview,
            "funnel": funnel,
            "telecalling": telecalling,
            "trends": trends,
            "distribution": distribution,
            "inspector_stats": inspector_stats,
            "recent_activities": recent_activities,
            "total_commercial_properties": commercial_records,
            "eligible_for_field": eligible_for_field,
            "unassigned_properties": unassigned_properties,
            "daily_activity": self.daily_activity(eff_from, eff_to, status),
            **legacy_metrics,
            "recent_records": self.record_repo.get_recent(limit=10),
        }

    def get_user_dashboard_metrics(self, user_id: int, date_from=None, date_to=None, status=None) -> dict:
        """Per-user dashboard metrics — only the given user's records/photos."""
        return {
            **self.period_metrics(date_from, date_to, status, user_id),
            "daily_activity": self.daily_activity(date_from, date_to, status, user_id),
            "recent_records": self.record_repo.list_records(
                page=1, page_size=5, user_id=user_id, date_from=date_from, date_to=date_to, status=status, date_field="assigned_at" if status == "NOT_COMPLETED" else "captured_at",
                audit_status="APPROVAL" if user_id is not None else None,
            )[0],
        }

    def get_all_locations(
        self,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        record_search: Optional[str] = None,
        location_search: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> List[dict]:
        return self.record_repo.get_all_locations(
            date_from=date_from,
            date_to=date_to,
            record_search=record_search,
            location_search=location_search,
            user_id=user_id,
        )
