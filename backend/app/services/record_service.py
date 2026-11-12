from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from sqlalchemy.orm import Session

from app.models.capture_record import CaptureRecord
from app.models.user import User, UserRole
from app.repositories.record_repository import RecordRepository


def has_valid_contact(record: Any) -> bool:
    """Returns True if record has a contact number, contractor contact, or QC contact with at least one 10-digit phone number."""
    from app.database.connection import has_ten_digit_phone_sql
    for val in [
        getattr(record, "contact_number", None),
        getattr(record, "site_contractor_architect_number", None),
        getattr(record, "qc_builder_contact", None),
    ]:
        if val and has_ten_digit_phone_sql(val):
            return True
    return False


def get_target_telecaller(db: Session) -> Optional[User]:
    """Find the best active telecaller to route leads to.
    Prioritizes real telecallers over system test accounts, then selects the one
    with the lowest assigned count for balanced workload.
    """
    active_telecallers = (
        db.query(User)
        .filter(User.role == UserRole.TELECALLER, User.is_active == True)
        .all()
    )
    if not active_telecallers:
        return None
    real_telecallers = [
        u for u in active_telecallers
        if not (u.email.endswith("@system.local") or "test" in u.email.lower())
    ]
    candidate_telecallers = real_telecallers if real_telecallers else active_telecallers
    if len(candidate_telecallers) == 1:
        return candidate_telecallers[0]

    from sqlalchemy import func
    counts = (
        db.query(CaptureRecord.assigned_telecaller_id, func.count(CaptureRecord.id))
        .filter(CaptureRecord.assigned_telecaller_id.in_([u.id for u in candidate_telecallers]))
        .group_by(CaptureRecord.assigned_telecaller_id)
        .all()
    )
    count_map = {row[0]: row[1] for row in counts}
    candidate_telecallers.sort(key=lambda u: (count_map.get(u.id, 0), u.id))
    return candidate_telecallers[0]


def auto_assign_telecaller_if_contact(db: Session, record: CaptureRecord) -> Optional[int]:
    """Auto-assigns record to an active telecaller if contact exists and not already assigned."""
    if record.assigned_telecaller_id:
        return None
    if not has_valid_contact(record):
        return None
    target = get_target_telecaller(db)
    if target:
        record.assigned_telecaller_id = target.id
        db.commit()
        return target.id
    return None



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

    def next_unique_id(self, latitude: float, longitude: float, prefix: str = DEFAULT_UNIQUE_ID_PREFIX) -> str:
        """Coordinate-derived unique ID, suffixed -2, -3… when the same ≈11 m
        cell already has a record (two inspections on one rooftop, say)."""
        base = generate_unique_id(latitude, longitude, prefix=prefix)
        candidate = base
        suffix = 1
        while self.db.query(CaptureRecord.id).filter(CaptureRecord.unique_id == candidate).first() is not None:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    def next_six_digit_unique_id(self, prefix: str = DEFAULT_UNIQUE_ID_PREFIX) -> str:
        """Generate a clean, collision-free standard 6-digit Unique ID (e.g. CBE-518294)."""
        import random
        clean_prefix = (prefix or DEFAULT_UNIQUE_ID_PREFIX).strip().upper()
        if clean_prefix.startswith("QANEW-"):
            clean_prefix = clean_prefix.replace("QANEW-", "")
        existing_uids = {
            r[0] for r in self.db.query(CaptureRecord.unique_id)
            .filter(CaptureRecord.unique_id.like(f"{clean_prefix}-______"))
            .all()
            if r[0]
        }
        while True:
            candidate = f"{clean_prefix}-{random.randint(100000, 999999)}"
            if candidate not in existing_uids:
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

    def is_duplicate_or_proximity_match(self, user_id: int, target_record: CaptureRecord) -> bool:
        """Check if target_record is within proximity or coordinate match of any active record assigned to user."""
        from sqlalchemy import or_
        uids = [u for u in (target_record.unique_id, target_record.name, getattr(target_record, "old_unique_id", None)) if u]
        if uids:
            assigned_with_same_uid = self.db.query(CaptureRecord.id).filter(
                or_(CaptureRecord.user_id == user_id, CaptureRecord.reassigned_to_id == user_id),
                or_(
                    CaptureRecord.unique_id.in_(uids),
                    CaptureRecord.name.in_(uids),
                    CaptureRecord.old_unique_id.in_(uids),
                ),
            ).first()
            if assigned_with_same_uid:
                return True

        from app.services.duplicate_detection_service import parse_coords_pair, haversine_distance_m
        target_coords = parse_coords_pair(target_record.coordinates) if target_record.coordinates else None
        if not target_coords and target_record.field_latitude is not None and target_record.field_longitude is not None:
            target_coords = (target_record.field_latitude, target_record.field_longitude)
        if not target_coords:
            return False
        t_lat, t_lng = target_coords

        assigned_records = self.db.query(
            CaptureRecord.coordinates, CaptureRecord.field_latitude, CaptureRecord.field_longitude
        ).filter(
            or_(CaptureRecord.user_id == user_id, CaptureRecord.reassigned_to_id == user_id),
            or_(CaptureRecord.coordinates.isnot(None), CaptureRecord.field_latitude.isnot(None)),
            or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != "DISAPPROVAL"),
        ).all()

        for (u_coords, u_flat, u_flng) in assigned_records:
            u_parsed = parse_coords_pair(u_coords) if u_coords else None
            if not u_parsed and u_flat is not None and u_flng is not None:
                u_parsed = (u_flat, u_flng)
            if u_parsed:
                dist = haversine_distance_m(t_lat, t_lng, u_parsed[0], u_parsed[1])
                if dist <= 300:
                    return True
        return False

    def can_access(self, user: User, record: CaptureRecord, for_write: bool = False) -> bool:
        if user.role.value in ("ADMIN", "MANAGER"):
            return True
        if user.role.value == "AUDITOR":
            # Audit workflow: auditors review every record in the queue.
            return True
        if user.role.value == "TELECALLER":
            return record.assigned_telecaller_id == user.id or record.assigned_telecaller_id is None
        # Field workers (USER operators and FIELD_VERIFIERs) see their own records.
        is_assigned = (record.user_id == user.id or record.reassigned_to_id == user.id) and record.audit_status != "DISAPPROVAL"
        if is_assigned:
            return True
        if for_write:
            return False
        # Read-only reference viewing: allow field verifiers to view nearby / duplicate reference records
        return self.is_duplicate_or_proximity_match(user.id, record)

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

        decision_changed = bool(audit_status and audit_status != record.audit_status)
        now = datetime.now(timezone.utc)
        was_already_audited = bool(record.audited_at or record.qc_completed_at or (record.audit_status and record.audit_status != "PENDING"))
        is_edited = was_already_audited and (decision_changed or coords_changed or qc_changed or bool(audit_comment and audit_comment.strip() != (record.audit_comment or "").strip()))
        is_already_done = bool(record.qc_completed_at)

        if auditor.role.value == "AUDITOR" and record.assigned_auditor_id not in (None, auditor.id):
            raise PermissionError("This record is assigned to another auditor")
        # Honor the auditor's explicit decision (APPROVAL, DISAPPROVAL, COMMERCIAL_PROPERTY, etc.)
        if audit_status:
            record.audit_status = audit_status
        elif coords_changed or qc_changed:
            record.audit_status = "RE_AUDITED"
        record.audit_comment = (audit_comment or "").strip() or None

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
            has_qc = any((value or "").strip() for value in (record.qc_vhr_comment, record.qc_street_details, record.qc_builder_contact, record.qc_sqfeet))
            if has_qc:
                record.qc_by_id = auditor.id
                record.qc_status = "QC Done"
                if is_already_done or is_edited:
                    record.qc_edited_at = now
                else:
                    record.qc_completed_at = now
                    record.qc_edited_at = None
            else:
                record.qc_completed_at = None
                record.qc_edited_at = None
                record.qc_by_id = None
                record.qc_status = "QC Pending"
        elif is_edited:
            record.qc_edited_at = now
            if record.audit_status in ("APPROVAL", "COMMERCIAL_PROPERTY") and not record.qc_status:
                record.qc_status = "QC Done"

        if record.status not in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED") and audit_status in ("DISAPPROVAL", "COMMERCIAL_PROPERTY"):
            # Blocked / unassigned outcomes: clear user assignment.
            record.user_id = None

        record_qc_history(
            record,
            user=auditor,
            audit_status=audit_status,
            audit_comment=record.audit_comment,
            qc_vhr_comment=record.qc_vhr_comment,
            qc_street_details=record.qc_street_details,
            qc_builder_contact=record.qc_builder_contact,
            qc_sqfeet=record.qc_sqfeet,
            coordinates=record.coordinates,
        )

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
        if record.audit_status == "DISAPPROVAL":
            raise ValueError("Disapproved records cannot be assigned to a field verifier")

        has_prior_history = bool(
            record.status in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")
            or getattr(record, "field_captured_at", None)
        )
        is_reassignment = has_prior_history

        now_utc = datetime.now(timezone.utc)
        record.user_id = verifier_id
        record.staged_operator_id = verifier_id
        record.assigned_at = now_utc
        record.updated_at = now_utc
        record.status = "NOT_COMPLETED"

        if is_reassignment:
            record.reassigned_to_id = verifier_id
            record.reassigned_at = now_utc
            record.revisit_status = "REASSIGNED"
        else:
            # First time assignment: explicitly Pending, not Reassigned
            record.reassigned_to_id = None
            record.reassigned_at = None
            record.revisit_status = None

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

    def period_metrics(self, date_from=None, date_to=None, status=None, user_id=None, district=None, set_name=None):
        """Counts for one filtered set, using actual photo / field capture time."""
        import re
        from sqlalchemy import func, case, or_, and_, not_
        from app.models.captured_image import CapturedImage
        from app.repositories.record_repository import record_date_column, local_day_bounds, BUSINESS_TZ
        from datetime import datetime, timedelta, timezone
        query = self.db.query(CaptureRecord)
        if district:
            query = query.filter(CaptureRecord.district == district)
        if set_name:
            query = query.filter(CaptureRecord.set_name == set_name)
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
            query = query.filter(
                CaptureRecord.user_id == user_id,
                or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != 'DISAPPROVAL')
            )
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
        total, completed, closed, pending, construction = query.with_entities(
            func.count(CaptureRecord.id),
            func.sum(case((is_completed, 1), else_=0)),
            func.sum(case((is_closed, 1), else_=0)),
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
                'total_records': total, 'total_completed_records': completed or 0, 'closed_records': closed or 0,
                'manually_added_records': query.filter(CaptureRecord.is_manually_added).count(),
                'qa_new_records': query.filter(or_(CaptureRecord.unique_id.like("QANEW-%"), CaptureRecord.source == "qa_portal")).count(),
                'pending_records': pending or 0, 'total_photos': photos,
                'construction_yes_records': construction or 0, 'mobile_numbers_collected': len(numbers),
                'completion_rate': round((completed or 0) / total * 100, 1) if total else 0.0}

    def daily_activity(self, date_from=None, date_to=None, status=None, user_id=None, district=None, set_name=None):
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
        if district:
            query = query.filter(CaptureRecord.district == district)
        if set_name:
            query = query.filter(CaptureRecord.set_name == set_name)
        if user_id is not None:
            query = query.filter(
                CaptureRecord.user_id == user_id,
                or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != 'DISAPPROVAL')
            )
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
        user_id=None,
        set_name=None,
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
            "district": district,
            "user_id": user_id,
            "set_name": set_name,
        }

        # 2. Base query filtered by scope, status, and dates
        q_base = self.db.query(CaptureRecord)
        if district:
            q_base = q_base.filter(CaptureRecord.district == district)
        if set_name:
            q_base = q_base.filter(CaptureRecord.set_name == set_name)
        if user_id:
            q_base = q_base.filter(
                or_(
                    CaptureRecord.user_id == user_id,
                    CaptureRecord.reassigned_to_id == user_id,
                    CaptureRecord.assigned_auditor_id == user_id,
                    CaptureRecord.qc_by_id == user_id,
                    CaptureRecord.audited_by_id == user_id,
                    CaptureRecord.assigned_telecaller_id == user_id,
                    CaptureRecord.telecaller_by_id == user_id,
                    CaptureRecord.uploaded_by_id == user_id,
                )
            )
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

        is_period_filtered = bool(eff_from and eff_to)

        comp_col = record_date_column('completed_at')
        qc_col = func.coalesce(CaptureRecord.qc_completed_at, CaptureRecord.qc_edited_at, CaptureRecord.audited_at)
        has_phone = or_(
            func.coalesce(func.trim(CaptureRecord.contact_number), "") != "",
            func.coalesce(func.trim(CaptureRecord.site_contractor_architect_number), "") != "",
            func.coalesce(func.trim(CaptureRecord.qc_builder_contact), "") != "",
        )

        total_records = q_base.count()
        alltime_commercial = q_base.filter(
            or_(
                CaptureRecord.audit_status == "COMMERCIAL_PROPERTY",
                CaptureRecord.property_type == "Commercial Property",
            )
        ).count()
        commercial_records = alltime_commercial
        eligible_for_field = max(0, total_records - alltime_commercial)

        sent_to_field = q_base.filter(CaptureRecord.user_id.isnot(None)).count()
        unassigned_properties = q_base.filter(CaptureRecord.user_id.is_(None)).count()
        pending_verifications = q_base.filter(
            not_(is_completed),
            not_(is_closed),
            or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != "DISAPPROVAL"),
        ).count()

        if is_period_filtered:
            q_period_comp = q_base.filter(
                func.julianday(comp_col) >= func.julianday(eff_from),
                func.julianday(comp_col) <= func.julianday(eff_to),
            )
            completed_verifications = q_period_comp.filter(is_completed).count()
            closed_verifications = q_period_comp.filter(is_closed).count()
            confirmed_construction = q_period_comp.filter(
                func.lower(func.trim(CaptureRecord.construction_happening)) == "yes"
            ).count()
            phone_numbers_obtained = q_period_comp.filter(has_phone).count()

            q_period_created = q_base.filter(
                func.julianday(CaptureRecord.created_at) >= func.julianday(eff_from),
                func.julianday(CaptureRecord.created_at) <= func.julianday(eff_to),
            )
            manually_added = q_period_created.filter(CaptureRecord.is_manually_added).count()
            qa_new_records = q_period_created.filter(
                or_(
                    CaptureRecord.unique_id.like("QANEW-%"),
                    CaptureRecord.source == "qa_portal",
                )
            ).count()

            q_period_qc = q_base.filter(
                func.julianday(qc_col) >= func.julianday(eff_from),
                func.julianday(qc_col) <= func.julianday(eff_to),
            )
            disapproved_records = q_period_qc.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
            period_commercial = q_period_qc.filter(
                or_(
                    CaptureRecord.audit_status == "COMMERCIAL_PROPERTY",
                    CaptureRecord.property_type == "Commercial Property",
                )
            ).count()
        else:
            completed_verifications = q_base.filter(is_completed).count()
            closed_verifications = q_base.filter(is_closed).count()
            disapproved_records = q_base.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
            confirmed_construction = q_base.filter(
                func.lower(func.trim(CaptureRecord.construction_happening)) == "yes"
            ).count()
            phone_numbers_obtained = q_base.filter(has_phone).count()
            manually_added = q_base.filter(CaptureRecord.is_manually_added).count()
            qa_new_records = q_base.filter(
                or_(
                    CaptureRecord.unique_id.like("QANEW-%"),
                    CaptureRecord.source == "qa_portal",
                )
            ).count()
            period_commercial = alltime_commercial

        completion_rate = round(completed_verifications / eligible_for_field * 100, 1) if eligible_for_field else 0.0

        overview = {
            "total_records": total_records,
            "total_commercial_properties": alltime_commercial,
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
            "qa_new_records": qa_new_records,
            "period_created": total_records,
            "period_assigned": sent_to_field,
            "period_completed": completed_verifications,
        }

        # 3. PPT Funnel & Summary Split (dynamic with active filter)
        funnel = {
            "identified_sites": total_records,
            "sent_for_verification": sent_to_field,
            "false_positives_qc": disapproved_records,
            "commercial_property_qc": period_commercial,
            "field_verification_completed": completed_verifications,
            "pending_for_field_verification": pending_verifications,
            "confirmed_construction": confirmed_construction,
            "phone_numbers_obtained": phone_numbers_obtained,
            "manually_added": manually_added,
            "qa_new_records": qa_new_records,
        }

        # 4. Telecalling breakdown (matching active filter scope)
        q_tele = q_base.filter(
            or_(
                CaptureRecord.assigned_telecaller_id.isnot(None),
                CaptureRecord.telecaller_status.isnot(None),
            )
        )
        total_leads = q_tele.count()
        tele_col = func.coalesce(CaptureRecord.telecaller_called_at, CaptureRecord.updated_at, CaptureRecord.created_at)
        if is_period_filtered:
            q_tele_period = q_tele.filter(
                func.julianday(tele_col) >= func.julianday(eff_from),
                func.julianday(tele_col) <= func.julianday(eff_to),
            )
            calls_completed = q_tele_period.filter(
                CaptureRecord.telecaller_status.isnot(None),
                CaptureRecord.telecaller_status != "PENDING",
            ).count()
            const_confirmed_tele = q_tele_period.filter(CaptureRecord.telecaller_status == "CONSTRUCTION_CONFIRMED").count()
            follow_up_tele = q_tele_period.filter(CaptureRecord.telecaller_status == "CONNECTED_FOLLOW_UP").count()
            not_reachable_tele = q_tele_period.filter(CaptureRecord.telecaller_status == "NOT_REACHABLE").count()
        else:
            calls_completed = q_tele.filter(
                CaptureRecord.telecaller_status.isnot(None),
                CaptureRecord.telecaller_status != "PENDING",
            ).count()
            const_confirmed_tele = q_tele.filter(CaptureRecord.telecaller_status == "CONSTRUCTION_CONFIRMED").count()
            follow_up_tele = q_tele.filter(CaptureRecord.telecaller_status == "CONNECTED_FOLLOW_UP").count()
            not_reachable_tele = q_tele.filter(CaptureRecord.telecaller_status == "NOT_REACHABLE").count()

        calls_pending = q_tele.filter(
            or_(CaptureRecord.telecaller_status.is_(None), CaptureRecord.telecaller_status == "PENDING")
        ).count()
        other_tele = max(0, calls_completed - (const_confirmed_tele + follow_up_tele + not_reachable_tele))

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
            if user_id and u.id != user_id:
                continue

            q_u = self.db.query(CaptureRecord).filter(CaptureRecord.user_id == u.id)
            if district:
                q_u = q_u.filter(CaptureRecord.district == district)
            if set_name:
                q_u = q_u.filter(CaptureRecord.set_name == set_name)

            assigned = q_u.count()
            u_pending = q_u.filter(
                not_(is_completed),
                not_(is_closed),
                or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status != "DISAPPROVAL"),
            ).count()

            if is_period_filtered:
                q_u_period = q_u.filter(
                    func.julianday(comp_col) >= func.julianday(eff_from),
                    func.julianday(comp_col) <= func.julianday(eff_to),
                )
                completed = q_u_period.filter(is_completed).count()
                u_closed = q_u_period.filter(is_closed).count()
                u_const = q_u_period.filter(
                    func.lower(func.trim(CaptureRecord.construction_happening)) == "yes",
                ).count()
                u_phones = q_u_period.filter(has_phone).count()
            else:
                completed = q_u.filter(is_completed).count()
                u_closed = q_u.filter(is_closed).count()
                u_const = q_u.filter(
                    func.lower(func.trim(CaptureRecord.construction_happening)) == "yes",
                ).count()
                u_phones = q_u.filter(has_phone).count()

            u_today_comp = q_u.filter(
                func.julianday(comp_col) >= func.julianday(today_start),
                func.julianday(comp_col) <= func.julianday(today_end),
                is_completed,
            ).count()

            rate = round(completed / assigned * 100, 1) if assigned else 0.0

            inspector_stats.append({
                "user_id": u.id,
                "user_name": u.full_name,
                "email": u.email,
                "role": u.role.value,
                "total_assigned": assigned,
                "completed": completed,
                "closed": u_closed,
                "marked": u_closed,
                "pending": u_pending,
                "today_completed": u_today_comp,
                "completion_rate": rate,
                "confirmed_construction": u_const,
                "phones_obtained": u_phones,
            })

        # 8. QA Users / Auditors Stats
        qa_user_stats = []
        try:
            from app.models.user import UserRole
            auditor_users = (
                self.db.query(User)
                .filter(User.role.in_([UserRole.AUDITOR, UserRole.ADMIN]), User.is_active == True)
                .order_by(User.full_name)
                .all()
            )
            for aud in auditor_users:
                if user_id and aud.id != user_id:
                    continue
                q_assigned = self.db.query(CaptureRecord).filter(CaptureRecord.assigned_auditor_id == aud.id)
                q_qc = self.db.query(CaptureRecord).filter(
                    or_(CaptureRecord.qc_by_id == aud.id, CaptureRecord.audited_by_id == aud.id)
                )
                if district:
                    q_assigned = q_assigned.filter(CaptureRecord.district == district)
                    q_qc = q_qc.filter(CaptureRecord.district == district)
                if set_name:
                    q_assigned = q_assigned.filter(CaptureRecord.set_name == set_name)
                    q_qc = q_qc.filter(CaptureRecord.set_name == set_name)

                assigned = q_assigned.count()
                aud_pending = q_assigned.filter(
                    or_(CaptureRecord.audit_status.is_(None), CaptureRecord.audit_status == "PENDING")
                ).count()

                q_upload = self.db.query(CaptureRecord).filter(
                    CaptureRecord.uploaded_by_id == aud.id,
                    CaptureRecord.source == "qa_portal",
                )
                if district:
                    q_upload = q_upload.filter(CaptureRecord.district == district)
                if set_name:
                    q_upload = q_upload.filter(CaptureRecord.set_name == set_name)

                if is_period_filtered:
                    q_qc_period = q_qc.filter(
                        func.julianday(qc_col) >= func.julianday(eff_from),
                        func.julianday(qc_col) <= func.julianday(eff_to),
                    )
                    qc_done = q_qc_period.count()
                    aud_approved = q_qc_period.filter(CaptureRecord.audit_status == "APPROVAL").count()
                    aud_disapproved = q_qc_period.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
                    aud_commercial = q_qc_period.filter(
                        or_(
                            CaptureRecord.audit_status == "COMMERCIAL_PROPERTY",
                            CaptureRecord.property_type == "Commercial Property",
                        )
                    ).count()
                    aud_created = q_upload.filter(
                        func.julianday(CaptureRecord.created_at) >= func.julianday(eff_from),
                        func.julianday(CaptureRecord.created_at) <= func.julianday(eff_to),
                    ).count()
                else:
                    qc_done = q_qc.count()
                    aud_approved = q_qc.filter(CaptureRecord.audit_status == "APPROVAL").count()
                    aud_disapproved = q_qc.filter(CaptureRecord.audit_status == "DISAPPROVAL").count()
                    aud_commercial = q_qc.filter(
                        or_(
                            CaptureRecord.audit_status == "COMMERCIAL_PROPERTY",
                            CaptureRecord.property_type == "Commercial Property",
                        )
                    ).count()
                    aud_created = q_upload.count()

                if assigned == 0 and qc_done == 0 and aud_created == 0:
                    continue

                aud_today = q_qc.filter(
                    func.julianday(qc_col) >= func.julianday(today_start),
                    func.julianday(qc_col) <= func.julianday(today_end),
                ).count()
                rate = round((qc_done / assigned * 100), 1) if assigned else (100.0 if qc_done else 0.0)

                qa_user_stats.append({
                    "user_id": aud.id,
                    "user_name": aud.full_name,
                    "email": aud.email,
                    "role": aud.role.value if hasattr(aud.role, "value") else str(aud.role),
                    "total_assigned": assigned,
                    "qc_done": qc_done,
                    "approved": aud_approved,
                    "disapproved": aud_disapproved,
                    "commercial": aud_commercial,
                    "pending": aud_pending,
                    "qa_created": aud_created,
                    "today_done": aud_today,
                    "completion_rate": min(100.0, rate),
                })
        except Exception as e:
            pass

        # 9. Recent Activities
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

        legacy_metrics = self.period_metrics(eff_from, eff_to, status, user_id=user_id, district=district, set_name=set_name)

        return {
            "period_info": period_info,
            "overview": overview,
            "funnel": funnel,
            "telecalling": telecalling,
            "trends": trends,
            "distribution": distribution,
            "inspector_stats": inspector_stats,
            "qa_user_stats": qa_user_stats,
            "recent_activities": recent_activities,
            "total_commercial_properties": commercial_records,
            "eligible_for_field": eligible_for_field,
            "unassigned_properties": unassigned_properties,
            "qa_new_records": qa_new_records,
            "daily_activity": self.daily_activity(eff_from, eff_to, status, user_id=user_id, district=district, set_name=set_name),
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


def record_qc_history(record: CaptureRecord, user: Optional[Any] = None, **kwargs) -> list:
    """Prepend a QC modification snapshot to qc_history, capped at the last 5 revisions."""
    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "timestamp": now_iso,
        "user_id": getattr(user, "id", None) or record.qc_by_id or record.audited_by_id,
        "user_name": (getattr(user, "full_name", None) or getattr(user, "username", None)) if user else None,
        "user_role": (user.role.value if hasattr(getattr(user, "role", None), "value") else str(getattr(user, "role", ""))) if user else None,
        "audit_status": kwargs.get("audit_status", record.audit_status),
        "audit_comment": kwargs.get("audit_comment", record.audit_comment),
        "qc_vhr_comment": kwargs.get("qc_vhr_comment", record.qc_vhr_comment),
        "qc_street_details": kwargs.get("qc_street_details", record.qc_street_details),
        "qc_builder_contact": kwargs.get("qc_builder_contact", record.qc_builder_contact),
        "qc_sqfeet": kwargs.get("qc_sqfeet", record.qc_sqfeet),
        "coordinates": kwargs.get("coordinates", record.coordinates),
        "qc_reference_image_key": kwargs.get("qc_reference_image_key", record.qc_reference_image_key),
    }

    existing = list(record.qc_history) if record.qc_history else []
    if not existing and (record.qc_completed_at or record.audited_at or (record.qc_vhr_comment and str(record.qc_vhr_comment).strip())):
        baseline_time = record.qc_edited_at or record.qc_completed_at or record.audited_at or record.created_at
        baseline_entry = {
            "timestamp": baseline_time.isoformat() if hasattr(baseline_time, "isoformat") else str(baseline_time),
            "user_id": record.qc_by_id or record.audited_by_id,
            "user_name": (record.qc_by.full_name if getattr(record, "qc_by", None) else (record.audited_by.full_name if getattr(record, "audited_by", None) else None)),
            "user_role": "AUDITOR" if record.audited_by_id else None,
            "audit_status": record.audit_status,
            "audit_comment": record.audit_comment,
            "qc_vhr_comment": record.qc_vhr_comment,
            "qc_street_details": record.qc_street_details,
            "qc_builder_contact": record.qc_builder_contact,
            "qc_sqfeet": record.qc_sqfeet,
            "coordinates": record.coordinates,
            "qc_reference_image_key": record.qc_reference_image_key,
        }
        if (
            baseline_entry.get("qc_vhr_comment") != entry.get("qc_vhr_comment")
            or baseline_entry.get("audit_status") != entry.get("audit_status")
            or baseline_entry.get("coordinates") != entry.get("coordinates")
        ):
            existing.append(baseline_entry)

    updated = [entry, *existing][:5]
    record.qc_history = updated
    return updated


def record_field_history(record: CaptureRecord, user: Optional[Any] = None, **kwargs) -> list:
    """Prepend a Field Verification modification snapshot to field_history, capped at the last 5 revisions."""
    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "timestamp": now_iso,
        "user_id": getattr(user, "id", None) or record.updated_by_id or record.user_id,
        "user_name": (getattr(user, "full_name", None) or getattr(user, "username", None)) if user else record.updated_by_name,
        "user_role": (user.role.value if hasattr(getattr(user, "role", None), "value") else str(getattr(user, "role", ""))) if user else record.updated_by_role,
        "status": kwargs.get("status", record.status),
        "revisit_status": kwargs.get("revisit_status", record.revisit_status),
        "date_of_visit": kwargs.get("date_of_visit", record.date_of_visit),
        "construction_happening": kwargs.get("construction_happening", record.construction_happening),
        "stage_of_construction": kwargs.get("stage_of_construction", record.stage_of_construction),
        "type_of_construction": kwargs.get("type_of_construction", record.type_of_construction),
        "no_of_floors": kwargs.get("no_of_floors", record.no_of_floors),
        "built_up_area": kwargs.get("built_up_area", record.built_up_area),
        "expected_completion": kwargs.get("expected_completion", record.expected_completion),
        "building_user_name": kwargs.get("building_user_name", record.building_user_name),
        "relationship_with_building": kwargs.get("relationship_with_building", record.relationship_with_building),
        "spoken_with": kwargs.get("spoken_with", record.spoken_with),
        "contact_number": kwargs.get("contact_number", record.contact_number),
        "site_contractor_architect_name": kwargs.get("site_contractor_architect_name", record.site_contractor_architect_name),
        "site_contractor_architect_number": kwargs.get("site_contractor_architect_number", record.site_contractor_architect_number),
        "remarks": kwargs.get("remarks", record.remarks),
        "updated_coordinates": kwargs.get("updated_coordinates", record.updated_coordinates),
        "updated_information": kwargs.get("updated_information", record.updated_information),
        "follow_up_date": kwargs.get("follow_up_date", record.follow_up_date),
    }

    existing = list(record.field_history) if record.field_history else []
    if not existing and (record.field_captured_at or record.date_of_visit or record.status in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED")):
        baseline_time = record.field_captured_at or record.updated_at or record.created_at
        baseline_entry = {
            "timestamp": baseline_time.isoformat() if hasattr(baseline_time, "isoformat") else str(baseline_time),
            "user_id": record.user_id,
            "user_name": record.user.full_name if getattr(record, "user", None) else record.updated_by_name,
            "user_role": "FIELD_VERIFIER" if record.user_id else None,
            "status": record.status,
            "revisit_status": record.revisit_status,
            "date_of_visit": record.date_of_visit,
            "construction_happening": record.construction_happening,
            "stage_of_construction": record.stage_of_construction,
            "type_of_construction": record.type_of_construction,
            "no_of_floors": record.no_of_floors,
            "built_up_area": record.built_up_area,
            "expected_completion": record.expected_completion,
            "building_user_name": record.building_user_name,
            "relationship_with_building": record.relationship_with_building,
            "spoken_with": record.spoken_with,
            "contact_number": record.contact_number,
            "site_contractor_architect_name": record.site_contractor_architect_name,
            "site_contractor_architect_number": record.site_contractor_architect_number,
            "remarks": record.remarks,
            "updated_coordinates": record.updated_coordinates,
            "updated_information": record.updated_information,
            "follow_up_date": record.follow_up_date,
        }
        if (
            baseline_entry.get("status") != entry.get("status")
            or baseline_entry.get("stage_of_construction") != entry.get("stage_of_construction")
            or baseline_entry.get("remarks") != entry.get("remarks")
        ):
            existing.append(baseline_entry)

    updated = [entry, *existing][:5]
    record.field_history = updated
    return updated


def record_telecaller_history(record: CaptureRecord, user: Optional[Any] = None, **kwargs) -> list:
    """Prepend a Telecaller modification snapshot to telecaller_history, capped at the last 5 revisions."""
    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "timestamp": now_iso,
        "user_id": getattr(user, "id", None) or record.telecaller_by_id or record.updated_by_id,
        "user_name": (getattr(user, "full_name", None) or getattr(user, "username", None)) if user else record.updated_by_name,
        "user_role": (user.role.value if hasattr(getattr(user, "role", None), "value") else str(getattr(user, "role", ""))) if user else record.updated_by_role,
        "telecaller_status": kwargs.get("telecaller_status", record.telecaller_status),
        "telecaller_comment": kwargs.get("telecaller_comment", record.telecaller_comment),
        "telecaller_no_of_floors": kwargs.get("telecaller_no_of_floors", record.telecaller_no_of_floors),
        "telecaller_expected_completion": kwargs.get("telecaller_expected_completion", record.telecaller_expected_completion),
        "telecaller_built_up_area": kwargs.get("telecaller_built_up_area", record.telecaller_built_up_area),
        "telecaller_stage_of_construction": kwargs.get("telecaller_stage_of_construction", record.telecaller_stage_of_construction),
        "follow_up_date": kwargs.get("follow_up_date", record.follow_up_date),
    }

    existing = list(record.telecaller_history) if record.telecaller_history else []
    if not existing and (record.telecaller_called_at or record.telecaller_status):
        baseline_time = record.telecaller_called_at or record.updated_at or record.created_at
        baseline_entry = {
            "timestamp": baseline_time.isoformat() if hasattr(baseline_time, "isoformat") else str(baseline_time),
            "user_id": record.telecaller_by_id,
            "user_name": record.telecaller_by.full_name if getattr(record, "telecaller_by", None) else None,
            "user_role": "TELECALLER",
            "telecaller_status": record.telecaller_status,
            "telecaller_comment": record.telecaller_comment,
            "telecaller_no_of_floors": record.telecaller_no_of_floors,
            "telecaller_expected_completion": record.telecaller_expected_completion,
            "telecaller_built_up_area": record.telecaller_built_up_area,
            "telecaller_stage_of_construction": record.telecaller_stage_of_construction,
            "follow_up_date": record.follow_up_date,
        }
        if (
            baseline_entry.get("telecaller_status") != entry.get("telecaller_status")
            or baseline_entry.get("telecaller_comment") != entry.get("telecaller_comment")
        ):
            existing.append(baseline_entry)

    updated = [entry, *existing][:5]
    record.telecaller_history = updated
    return updated
