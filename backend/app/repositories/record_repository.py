from datetime import datetime, timezone, timedelta
from typing import List, Optional

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User


BUSINESS_TZ = timezone(timedelta(hours=5, minutes=30))


def record_date_column(field):
    captured = select(func.max(CapturedImage.captured_at)).where(
        CapturedImage.record_id == CaptureRecord.id,
        or_(
            CapturedImage.google_drive_file_id.is_(None),
            CapturedImage.google_drive_file_id.notlike('pending:%'),
        )
    ).correlate(CaptureRecord).scalar_subquery()
    cap_and_field = func.coalesce(
        func.max(
            func.coalesce(captured, CaptureRecord.field_captured_at),
            func.coalesce(CaptureRecord.field_captured_at, captured),
        ),
        captured,
        CaptureRecord.field_captured_at,
    )
    visit_dt = func.datetime(CaptureRecord.date_of_visit)
    latest_capture = func.coalesce(
        func.max(
            func.coalesce(cap_and_field, visit_dt),
            func.coalesce(visit_dt, cap_and_field),
        ),
        cap_and_field,
        visit_dt,
        CaptureRecord.created_at,
    )
    completed = case((CaptureRecord.status.in_(['COMPLETED', 'Updated Revisited']), latest_capture), else_=None)
    return {'created_at': CaptureRecord.created_at,
            'assigned_at': func.coalesce(CaptureRecord.assigned_at, CaptureRecord.created_at),
            'qc_completed_at': CaptureRecord.qc_completed_at,
            'captured_at': latest_capture,
            'completed_at': completed}.get(field, CaptureRecord.created_at)


def local_day_bounds():
    now = datetime.now(BUSINESS_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


class RecordRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
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
        record_data = {
            "user_id": user_id,
            "name": name,
            "description": description,
            "location_name": location_name,
            "formatted_address": formatted_address,
            "place_id": place_id,
            "status": status,
            "assigned_at": extra_fields.get("assigned_at") or datetime.now(timezone.utc),
        }
        for k, v in extra_fields.items():
            if hasattr(CaptureRecord, k):
                record_data[k] = v
        # Audit workflow default: any record created directly for a user
        # (legacy dispatch, history import, ad-hoc capture) is immediately
        # visible to that operator. Only staged task-sheet imports start as
        # PENDING (they are created with user_id=None via extra_fields).
        record_data.setdefault("audit_status", "APPROVAL" if user_id is not None else "PENDING")
        record = CaptureRecord(**record_data)
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)
        return record

    def get_by_id(self, record_id: int) -> Optional[CaptureRecord]:
        return (
            self.db.query(CaptureRecord)
            .options(joinedload(CaptureRecord.images), joinedload(CaptureRecord.user))
            .filter(CaptureRecord.id == record_id)
            .first()
        )

    def list_records(
        self,
        page: int = 1,
        page_size: int = 20,
        user_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        date_field: str = "created_at",
        audit_status: Optional[str] = None,
        qc_status: Optional[str] = None,
        column_filters: Optional[dict] = None,
        district: Optional[str] = None,
        taluk: Optional[str] = None,
        village: Optional[str] = None,
        assigned_auditor_id: Optional[int] = None,
        unassigned_user: bool = False,
        unassigned_auditor: bool = False,
    ) -> tuple[List[CaptureRecord], int]:
        query = self.db.query(CaptureRecord).options(
            joinedload(CaptureRecord.images), joinedload(CaptureRecord.user)
        )

        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)

        # Audit gateway: field operators only ever see non-disapproved records.
        if audit_status == "NOT_DISAPPROVED":
            query = query.filter(CaptureRecord.audit_status.not_in(["DISAPPROVAL", "COMMERCIAL_PROPERTY"]))
        elif audit_status:
            query = query.filter(CaptureRecord.audit_status == audit_status)

        if status:
            st = status.upper()
            from sqlalchemy import and_, not_, or_
            is_completed = or_(
                CaptureRecord.status.in_(["COMPLETED", "Updated Revisited", "UPDATED_REVISITED"]),
                CaptureRecord.revisit_status == "COMPLETED",
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
            is_reassigned = and_(
                not_(is_completed),
                not_(is_closed),
                or_(
                    CaptureRecord.reassigned_to_id.isnot(None),
                    CaptureRecord.revisit_status.in_(["REASSIGNED", "PENDING_REVISIT"]),
                ),
            )
            is_manual = or_(CaptureRecord.is_manually_added, CaptureRecord.source == "manual")
            if st == "MANUALLY_ADDED":
                query = query.filter(is_manual)
            elif st in ("COMPLETED_REVISITED", "UPDATED_REVISITED", "UPDATED REVISITED"):
                is_revisited = and_(
                    is_completed,
                    or_(
                        CaptureRecord.status.in_(["Updated Revisited", "UPDATED_REVISITED"]),
                        CaptureRecord.revisit_status.in_(["Updated Revisited", "COMPLETED"]),
                        and_(
                            CaptureRecord.reassigned_to_id.isnot(None),
                            or_(
                                CaptureRecord.updated_coordinates.isnot(None),
                                CaptureRecord.updated_information.isnot(None),
                            ),
                        ),
                    ),
                )
                query = query.filter(is_revisited)
            elif st == "COMPLETED":
                query = query.filter(is_completed)
            elif st == "REASSIGNED":
                query = query.filter(is_reassigned)
            elif st in ("NOT_INTERESTED", "NOT INTERESTED"):
                query = query.filter(is_not_interested)
            elif st == "DUPLICATE":
                query = query.filter(is_duplicate)
            elif st in ("CONSTRUCTION_FINISHED", "CONSTRUCTION FINISHED"):
                query = query.filter(is_construction_finished)
            elif st in ("CLOSED", "OTHER"):
                query = query.filter(is_closed)
            elif st == "PENDING":
                query = query.filter(and_(not_(is_completed), not_(is_closed), not_(is_reassigned), not_(is_manual)))
            elif st == "NOT_COMPLETED":
                query = query.filter(and_(not_(is_completed), not_(is_closed)))
            else:
                query = query.filter(CaptureRecord.status == status)

        from app.services.record_filter_service import apply_record_filters, filter_column, has_qc_expression
        query = apply_record_filters(query, column_filters=column_filters, district=district, taluk=taluk, village=village,
                                     assigned_auditor_id=assigned_auditor_id, unassigned_user=unassigned_user,
                                     unassigned_auditor=unassigned_auditor)
        # QC desk-review state: explicit completion or a meaningful legacy assessment.
        has_qc = has_qc_expression()
        if qc_status == "DONE":
            query = query.filter(has_qc)
        elif qc_status == "PENDING":
            query = query.filter(~has_qc)

        relevance = None
        if search and search.strip():
            term = search.strip()
            search_filter = f"%{term}%"
            exact_id = None
            if term.lstrip('#').isdigit():
                exact_id = int(term.lstrip('#'))

            # Search across every user-visible record field.
            search_condition = (
                CaptureRecord.name.ilike(search_filter)
                | CaptureRecord.description.ilike(search_filter)
                | CaptureRecord.location_name.ilike(search_filter)
                | CaptureRecord.formatted_address.ilike(search_filter)
                | CaptureRecord.unique_id.ilike(search_filter)
                | CaptureRecord.site_address.ilike(search_filter)
                | CaptureRecord.survey_no.ilike(search_filter)
                | CaptureRecord.owner_name_en.ilike(search_filter)
                | CaptureRecord.village.ilike(search_filter)
                | CaptureRecord.taluk.ilike(search_filter)
                | CaptureRecord.district.ilike(search_filter)
                | CaptureRecord.qc_vhr_comment.ilike(search_filter)
                | CaptureRecord.qc_street_details.ilike(search_filter)
                | User.full_name.ilike(search_filter)
                | User.email.ilike(search_filter)
            )
            if exact_id is not None:
                search_condition = search_condition | (CaptureRecord.id == exact_id)

            query = query.outerjoin(User, User.id == CaptureRecord.user_id).filter(search_condition)

            # Break equal sort values using search relevance.
            relevance = case(
                (CaptureRecord.id == exact_id, 0) if exact_id is not None else (CaptureRecord.id == -1, 99),
                (CaptureRecord.unique_id.ilike(term), 1),
                (CaptureRecord.name.ilike(term), 2),
                (CaptureRecord.name.ilike(f"{term}%"), 3),
                (CaptureRecord.description.ilike(f"{term}%"), 4),
                else_=5,
            )

        if date_from:
            query = query.filter(func.julianday(record_date_column(date_field)) >= func.julianday(date_from))

        if date_to:
            query = query.filter(func.julianday(record_date_column(date_field)) <= func.julianday(date_to))

        total = query.count()
        sort_column_map = {
            "created_at": CaptureRecord.created_at,
            "assigned_at": record_date_column('assigned_at'),
            "name": CaptureRecord.name,
            "id": CaptureRecord.id,
            "status": filter_column("status"),
            "visit_order": CaptureRecord.visit_order,
            "unique_id": CaptureRecord.unique_id,
            "owner_name_en": CaptureRecord.owner_name_en,
            "land_use": CaptureRecord.land_use,
            "district": CaptureRecord.district,
            "taluk": CaptureRecord.taluk,
            "village": CaptureRecord.village,
            "user_id": CaptureRecord.user_id,
            "user_name": select(User.full_name).where(User.id == CaptureRecord.user_id).correlate(CaptureRecord).scalar_subquery(),
              "coordinates": CaptureRecord.coordinates,
            "street_address": func.coalesce(CaptureRecord.street_address, CaptureRecord.site_address, CaptureRecord.formatted_address),
            "type_of_construction": CaptureRecord.type_of_construction,
            "stage_of_construction": CaptureRecord.stage_of_construction,
            # Field Verification table columns (Records list) — sortable so the
            # admin can order the queue by any cell they can see.
            "date_of_visit": CaptureRecord.date_of_visit,
            "relationship_with_building": CaptureRecord.relationship_with_building,
            "building_user_name": CaptureRecord.building_user_name,
            "spoken_with": CaptureRecord.spoken_with,
            "contact_number": CaptureRecord.contact_number,
            "site_contractor_architect_name": CaptureRecord.site_contractor_architect_name,
            "site_contractor_architect_number": CaptureRecord.site_contractor_architect_number,
            "remarks": CaptureRecord.remarks,
            "captured_at": record_date_column('captured_at'),
            "photo_count": select(func.count(CapturedImage.id)).where(CapturedImage.record_id == CaptureRecord.id).correlate(CaptureRecord).scalar_subquery(),
            "audit_status": CaptureRecord.audit_status,
            "audited_at": CaptureRecord.audited_at,
            "audited_by": select(User.full_name).where(User.id == CaptureRecord.audited_by_id).correlate(CaptureRecord).scalar_subquery(),
            "uploaded_by": select(User.full_name).where(User.id == CaptureRecord.uploaded_by_id).correlate(CaptureRecord).scalar_subquery(),
            "qc_completed_at": CaptureRecord.qc_completed_at,
            "qc_edited_at": CaptureRecord.qc_edited_at,
            "updated_at": CaptureRecord.updated_at,
            "last_modified_at": CaptureRecord.updated_at,
            "revisit_status": CaptureRecord.revisit_status,
        }
        from app.services.record_filter_service import SORT_KEYS, filter_column
        sort_column = sort_column_map.get(sort_by, CaptureRecord.created_at)
        if sort_by == 'qc_completed_at':
            sort_column = func.coalesce(CaptureRecord.qc_completed_at, CaptureRecord.assigned_at, CaptureRecord.created_at)
        elif sort_by in ('updated_at', 'last_modified_at'):
            sort_column = func.coalesce(
                CaptureRecord.reassigned_at,
                CaptureRecord.assigned_at,
                CaptureRecord.created_at,
            )
        elif sort_by in SORT_KEYS and sort_by not in sort_column_map:
            sort_column = filter_column(sort_by)
        order_clause = (sort_column.asc() if sort_order.lower() == "asc" else sort_column.desc()).nulls_last()
        if relevance is not None:
            records = (
                query.order_by(order_clause, relevance.asc(), CaptureRecord.id.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
                .all()
            )
        else:
            records = (
                query.order_by(order_clause, CaptureRecord.id.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
                .all()
            )
        return records, total

    def reassign_pending_records(
        self, record_ids: List[int], target_user_id: int
    ) -> tuple[int, int]:
        """Reassign records to target_user_id (even same user).
        Both Verification Status and QA Status will be Pending.
        """
        if not record_ids:
            return 0, 0

        ids = set(record_ids)
        records = self.db.query(CaptureRecord).filter(CaptureRecord.id.in_(ids)).all()
        if len(records) != len(ids):
            raise ValueError('Some selected records no longer exist. Refresh and select again.')

        reassigned = 0
        skipped = 0
        now_utc = datetime.now(timezone.utc)
        for rec in records:
            if getattr(rec, 'property_type', None) in ('Commercial Property', 'COMMERCIAL_PROPERTY') or rec.audit_status == 'COMMERCIAL_PROPERTY':
                skipped += 1
                continue
            rec.user_id = target_user_id
            rec.staged_operator_id = target_user_id
            rec.reassigned_to_id = target_user_id
            rec.reassigned_at = now_utc
            rec.assigned_at = now_utc

            # Field Verification Status is marked NOT_COMPLETED and REASSIGNED
            rec.status = 'NOT_COMPLETED'
            rec.revisit_status = 'REASSIGNED'
            rec.updated_at = now_utc

            # Preserve all QC details, comments, and audit decisions intact!
            reassigned += 1
        self.db.commit()
        return reassigned, skipped

    def user_has_record(self, user_id: int, record_id: int) -> bool:
        return (
            self.db.query(CaptureRecord)
            .filter(
                and_(
                    CaptureRecord.id == record_id,
                    CaptureRecord.user_id == user_id,
                )
            )
            .first()
            is not None
        )

    def update(self, record: CaptureRecord, touch_updated_at: bool = False, **kwargs) -> CaptureRecord:
        for key, value in kwargs.items():
            if value is not None and hasattr(record, key):
                setattr(record, key, value)
        if touch_updated_at and hasattr(record, "updated_at") and "updated_at" not in kwargs:
            record.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(record)
        return record

    def delete(self, record: CaptureRecord) -> None:
        self.db.delete(record)
        self.db.commit()

    def count(self, user_id: Optional[int] = None) -> int:
        query = self.db.query(CaptureRecord)
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def count_today(self, user_id: Optional[int] = None) -> int:
        start, end = local_day_bounds()
        query = self.db.query(CaptureRecord).filter(
            func.julianday(CaptureRecord.created_at) >= func.julianday(start),
            func.julianday(CaptureRecord.created_at) < func.julianday(end),
        )
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def count_this_month(self, user_id: Optional[int] = None) -> int:
        now = datetime.now(BUSINESS_TZ)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start + timedelta(days=32)).replace(day=1)
        query = self.db.query(CaptureRecord).filter(
            func.julianday(CaptureRecord.created_at) >= func.julianday(start.astimezone(timezone.utc)),
            func.julianday(CaptureRecord.created_at) < func.julianday(end.astimezone(timezone.utc)),
        )
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def count_pending(self, user_id: Optional[int] = None) -> int:
        from sqlalchemy import and_, not_, or_
        is_completed = or_(
            CaptureRecord.status.in_(["COMPLETED", "Updated Revisited", "UPDATED_REVISITED"]),
            CaptureRecord.revisit_status == "COMPLETED",
        )
        is_closed = or_(
            CaptureRecord.status.in_(["NOT_INTERESTED", "Not Interested", "DUPLICATE", "Duplicate", "CONSTRUCTION_FINISHED", "Construction Finished"]),
            CaptureRecord.status.ilike("%not_interested%"),
            CaptureRecord.status.ilike("%not interested%"),
            CaptureRecord.status.ilike("%duplicate%"),
            CaptureRecord.status.ilike("%construction_finished%"),
            CaptureRecord.status.ilike("%construction finished%"),
        )
        query = self.db.query(CaptureRecord).filter(not_(is_completed), not_(is_closed))
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def count_completed_today(self, user_id: Optional[int] = None) -> int:
        start, end = local_day_bounds()
        completed = func.julianday(record_date_column('completed_at'))
        query = self.db.query(CaptureRecord).filter(
            CaptureRecord.status == "COMPLETED",
            completed >= func.julianday(start), completed < func.julianday(end),
        )
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def count_photos(self, user_id: Optional[int] = None) -> int:
        """Count uploaded photos (excludes pending metadata-only rows)."""
        query = (
            self.db.query(CapturedImage)
            .join(CaptureRecord, CaptureRecord.id == CapturedImage.record_id)
            .filter(CapturedImage.google_drive_file_id.notlike("pending:%"))
        )
        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        return query.count()

    def get_recent(self, limit: int = 10) -> List[CaptureRecord]:
        return (
            self.db.query(CaptureRecord)
            .options(joinedload(CaptureRecord.images), joinedload(CaptureRecord.user))
            .order_by(CaptureRecord.id.desc())
            .limit(limit)
            .all()
        )

    def get_all_locations(
        self,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        record_search: Optional[str] = None,
        location_search: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> List[dict]:
        """Get image and assigned record locations for the admin map.

        Skips (0, 0) coordinates. Includes both photo-captured coordinates
        and dispatched task coordinates (e.g. from Google Sheets).
        """
        from app.models.user import User

        def _parse_coords(coord_str: Optional[str]):
            if not coord_str:
                return None
            try:
                parts = [p.strip() for p in coord_str.split(",")]
                if len(parts) == 2:
                    lat, lng = float(parts[0]), float(parts[1])
                    if lat != 0 and lng != 0:
                        return lat, lng
            except Exception:
                pass
            return None

        query = (
            self.db.query(CaptureRecord)
            .options(joinedload(CaptureRecord.images), joinedload(CaptureRecord.user))
        )

        if user_id is not None:
            query = query.filter(CaptureRecord.user_id == user_id)
        if date_from:
            query = query.filter(CaptureRecord.created_at >= date_from)
        if date_to:
            query = query.filter(CaptureRecord.created_at <= date_to)

        if record_search and record_search.strip():
            term = record_search.strip()
            needle = f"%{term}%"
            record_cond = (
                CaptureRecord.name.ilike(needle)
                | CaptureRecord.description.ilike(needle)
                | CaptureRecord.location_name.ilike(needle)
                | CaptureRecord.formatted_address.ilike(needle)
                | CaptureRecord.site_address.ilike(needle)
                | CaptureRecord.village.ilike(needle)
                | CaptureRecord.taluk.ilike(needle)
                | CaptureRecord.district.ilike(needle)
                | CaptureRecord.unique_id.ilike(needle)
                | User.full_name.ilike(needle)
                | User.email.ilike(needle)
            )
            exact_id = int(term.lstrip("#")) if term.lstrip("#").isdigit() else None
            if exact_id is not None:
                record_cond = record_cond | (CaptureRecord.id == exact_id)
            query = query.filter(record_cond)

        if location_search and location_search.strip():
            needle = f"%{location_search.strip()}%"
            query = query.filter(
                (CaptureRecord.location_name.ilike(needle))
                | (CaptureRecord.formatted_address.ilike(needle))
                | (CaptureRecord.site_address.ilike(needle))
                | (CaptureRecord.village.ilike(needle))
                | (CaptureRecord.taluk.ilike(needle))
                | (CaptureRecord.district.ilike(needle))
            )

        records = query.order_by(CaptureRecord.id.desc()).all()

        results = []
        for r in records:
            user_name = r.user.full_name if r.user else None
            parsed = _parse_coords(getattr(r, "coordinates", None))
            has_image_loc = False

            if r.images:
                for img in r.images:
                    if img.latitude and img.longitude and img.latitude != 0 and img.longitude != 0:
                        has_image_loc = True
                        results.append({
                            "record_id": r.id,
                            "record_name": r.name,
                            "image_id": img.id,
                            "latitude": img.latitude,
                            "longitude": img.longitude,
                            "location_name": r.site_address or r.location_name,
                            "formatted_address": r.site_address or r.formatted_address,
                            "captured_at": img.captured_at or r.created_at,
                            "user_id": r.user_id,
                            "user_name": user_name,
                            "status": getattr(r, "status", "NOT_COMPLETED") or "NOT_COMPLETED",
                            "unique_id": getattr(r, "unique_id", None),
                            "visit_order": getattr(r, "visit_order", None),
                            "site_address": getattr(r, "site_address", None),
                            "survey_no": getattr(r, "survey_no", None),
                            "district": getattr(r, "district", None),
                            "taluk": getattr(r, "taluk", None),
                            "village": getattr(r, "village", None),
                        })

            if parsed and not has_image_loc:
                lat, lng = parsed
                results.append({
                    "record_id": r.id,
                    "record_name": r.name,
                    "image_id": None,
                    "latitude": lat,
                    "longitude": lng,
                    "location_name": r.site_address or r.location_name,
                    "formatted_address": r.site_address or r.formatted_address,
                    "captured_at": r.created_at,
                    "user_id": r.user_id,
                    "user_name": user_name,
                    "status": getattr(r, "status", "NOT_COMPLETED") or "NOT_COMPLETED",
                    "unique_id": getattr(r, "unique_id", None),
                    "visit_order": getattr(r, "visit_order", None),
                    "site_address": getattr(r, "site_address", None),
                    "survey_no": getattr(r, "survey_no", None),
                    "district": getattr(r, "district", None),
                    "taluk": getattr(r, "taluk", None),
                    "village": getattr(r, "village", None),
                })

        return results
