"""Validated column filters shared by lists, facets, summaries and exports."""
import json

from fastapi import HTTPException
from sqlalchemy import String, and_, case, cast, func, not_, or_, select

from app.models.capture_record import CaptureRecord
from app.models.captured_image import CapturedImage
from app.models.user import User

BLANK = "__BLANK__"
FILTER_FIELDS = {
    "name", "status", "source", "user_name", "owner_name_en", "district", "taluk", "village",
    "street_address", "land_use", "survey_no", "subdivision_no", "site_address", "survey_number",
    "sub_division", "construction_happening", "type_of_construction", "stage_of_construction",
    "relationship_with_building", "building_user_name", "spoken_with", "contact_number", "remarks",
    "site_contractor_architect_name", "site_contractor_architect_number", "audit_status", "audit_comment",
    "qc_status", "qc_vhr_comment", "qc_street_details", "qc_builder_contact", "qc_sqfeet", "audited_by",
    "assigned_auditor_name", "qa_user", "uploaded_by", "photo_count",
    "telecaller_status", "telecaller_comment",
    "date_of_visit", "captured_at",
    "unique_id", "coordinates", "assigned_at", "qc_completed_at", "last_modified_at", "follow_up_date", "revisit_status",
}
SORT_KEYS = FILTER_FIELDS | {
    "id", "user_id", "visit_order", "created_at",
    "qc_edited_at", "audited_at", "telecaller_called_at",
    "updated_at",
}
SORT_PATTERN = "^(" + "|".join(sorted(SORT_KEYS)) + ")$"


def parse_column_filters(raw: str | None) -> dict[str, list[str]]:
    if not raw or not isinstance(raw, str):
        return {}
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or len(value) > len(FILTER_FIELDS):
            raise ValueError()
        for field, choices in value.items():
            if field not in FILTER_FIELDS or not isinstance(choices, list) or not 1 <= len(choices) <= 500:
                raise ValueError()
            if any(not isinstance(choice, str) or len(choice) > 2000 for choice in choices):
                raise ValueError()
        return value
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Invalid column filters")


def has_qc_expression():
    return (CaptureRecord.qc_completed_at.is_not(None) |
            (func.coalesce(func.trim(CaptureRecord.qc_vhr_comment), '') != '') |
            (func.coalesce(func.trim(CaptureRecord.qc_street_details), '') != '') |
            (func.coalesce(func.trim(CaptureRecord.qc_builder_contact), '') != '') |
            (func.coalesce(func.trim(CaptureRecord.qc_sqfeet), '') != ''))


def filter_column(field: str):
    if field == "status":
        is_completed = or_(
            CaptureRecord.status.in_(["COMPLETED", "Updated Revisited", "UPDATED_REVISITED"]),
            CaptureRecord.revisit_status == "COMPLETED",
        )
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
        return case(
            (or_(CaptureRecord.is_manually_added, CaptureRecord.source == "manual"), "MANUALLY_ADDED"),
            (is_not_interested, "NOT_INTERESTED"),
            (is_duplicate, "DUPLICATE"),
            (is_construction_finished, "CONSTRUCTION_FINISHED"),
            (is_revisited, "COMPLETED_REVISITED"),
            (is_completed, "COMPLETED"),
            (is_reassigned, "REASSIGNED"),
            else_="NOT_COMPLETED",
        )
    if field == "qc_status":
        return case((has_qc_expression(), "DONE"), else_="PENDING")
    if field == "qa_user":
        foreign_key = func.coalesce(CaptureRecord.qc_by_id, CaptureRecord.assigned_auditor_id)
        return select(User.full_name).where(User.id == foreign_key).correlate(CaptureRecord).scalar_subquery()
    if field in ("user_name", "audited_by", "assigned_auditor_name", "uploaded_by"):
        foreign_key = {
            "user_name": CaptureRecord.user_id, "audited_by": CaptureRecord.audited_by_id,
            "assigned_auditor_name": CaptureRecord.assigned_auditor_id, "uploaded_by": CaptureRecord.uploaded_by_id,
        }[field]
        return select(User.full_name).where(User.id == foreign_key).correlate(CaptureRecord).scalar_subquery()
    if field == "photo_count":
        return select(func.count(CapturedImage.id)).where(
            CapturedImage.record_id == CaptureRecord.id,
            CapturedImage.google_drive_file_id.notlike("pending:%"),
        ).correlate(CaptureRecord).scalar_subquery()
    if field == "street_address":
        return func.coalesce(CaptureRecord.street_address, CaptureRecord.site_address, CaptureRecord.formatted_address)
    if field in ("captured_at", "date_of_visit"):
        from app.repositories.record_repository import record_date_column
        return func.substr(func.coalesce(cast(record_date_column("captured_at"), String), ""), 1, 10)
    if field == "assigned_at":
        from app.repositories.record_repository import record_date_column
        return func.substr(func.coalesce(cast(record_date_column("assigned_at"), String), ""), 1, 10)
    if field == "qc_completed_at":
        return func.substr(func.coalesce(cast(func.coalesce(CaptureRecord.qc_completed_at, CaptureRecord.assigned_at, CaptureRecord.created_at), String), ""), 1, 10)
    if field in ("last_modified_at", "updated_at"):
        t = func.coalesce(
            CaptureRecord.reassigned_at,
            CaptureRecord.assigned_at,
            CaptureRecord.created_at,
        )
        return func.substr(func.coalesce(cast(t, String), ""), 1, 10)
    return getattr(CaptureRecord, field)


def apply_record_filters(query, column_filters=None, qc_status=None, audit_status=None,
                         assigned_auditor_id=None, district=None, taluk=None, village=None,
                         unassigned_user=False, unassigned_auditor=False):
    if unassigned_user:
        query = query.filter(CaptureRecord.user_id.is_(None))
    if unassigned_auditor:
        query = query.filter(CaptureRecord.assigned_auditor_id.is_(None))
    if assigned_auditor_id is not None:
        query = query.filter(CaptureRecord.assigned_auditor_id == assigned_auditor_id)
    for field, value in (("qc_status", qc_status), ("audit_status", audit_status),
                         ("district", district), ("taluk", taluk)):
        if value is not None:
            query = query.filter(filter_column(field) == value)
    if village is not None:
        v_list = [v.strip() for v in village.split(",") if v.strip()]
        if len(v_list) > 1:
            query = query.filter(CaptureRecord.village.in_(v_list))
        elif len(v_list) == 1:
            query = query.filter(CaptureRecord.village == v_list[0])
    for field, choices in (column_filters or {}).items():
        if field == "status":
            expanded = []
            for c in choices:
                expanded.append(c)
                if c == "PENDING" and "NOT_COMPLETED" not in expanded:
                    expanded.append("NOT_COMPLETED")
                elif c == "NOT_COMPLETED" and "PENDING" not in expanded:
                    expanded.append("PENDING")
                elif c in ("COMPLETED_REVISITED", "Updated Revisited", "UPDATED_REVISITED"):
                    for alt in ("COMPLETED_REVISITED", "Updated Revisited", "UPDATED_REVISITED"):
                        if alt not in expanded:
                            expanded.append(alt)
                elif c in ("NOT_INTERESTED", "Not Interested"):
                    for alt in ("NOT_INTERESTED", "Not Interested"):
                        if alt not in expanded:
                            expanded.append(alt)
                elif c in ("DUPLICATE", "Duplicate"):
                    for alt in ("DUPLICATE", "Duplicate"):
                        if alt not in expanded:
                            expanded.append(alt)
                elif c in ("CONSTRUCTION_FINISHED", "Construction Finished"):
                    for alt in ("CONSTRUCTION_FINISHED", "Construction Finished"):
                        if alt not in expanded:
                            expanded.append(alt)
            column = func.coalesce(cast(filter_column(field), String), "")
            query = query.filter(column.in_(expanded))
            continue
        column = func.coalesce(cast(filter_column(field), String), "")
        query = query.filter(column.in_(["" if value == BLANK else value for value in choices]))
    return query


def filtered_query(db, **filters):
    """Unpaged query for facets and QC totals with the same record semantics."""
    from app.repositories.record_repository import record_date_column
    query = db.query(CaptureRecord)
    query = apply_record_filters(query, **{key: filters.get(key) for key in (
        "column_filters", "qc_status", "audit_status", "assigned_auditor_id", "district", "taluk", "village",
        "unassigned_user", "unassigned_auditor")})
    if filters.get("user_id") is not None:
        query = query.filter(CaptureRecord.user_id == filters["user_id"])
    if filters.get("status"):
        st = filters["status"].upper()
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
            query = query.filter(CaptureRecord.status == filters["status"])
    search_val = filters.get("search")
    if search_val and isinstance(search_val, str) and search_val.strip():
        term = search_val.strip()
        pattern = f"%{term}%"
        columns = [CaptureRecord.name, CaptureRecord.description, CaptureRecord.location_name,
                   CaptureRecord.formatted_address, CaptureRecord.unique_id, CaptureRecord.site_address,
                   CaptureRecord.survey_no, CaptureRecord.owner_name_en, CaptureRecord.district,
                   CaptureRecord.taluk, CaptureRecord.village, CaptureRecord.qc_vhr_comment, CaptureRecord.qc_street_details,
                   CaptureRecord.qc_sqfeet,
                   User.full_name, User.email]
        conditions = [col.ilike(pattern) for col in columns]
        if term.lstrip("#").isdigit():
            conditions.append(CaptureRecord.id == int(term.lstrip("#")))
        query = query.outerjoin(User, User.id == CaptureRecord.user_id).filter(or_(*conditions))
    for key, operator in (("date_from", "ge"), ("date_to", "le")):
        if filters.get(key):
            left = func.julianday(record_date_column(filters.get("date_field", "assigned_at")))
            right = func.julianday(filters[key])
            query = query.filter(left >= right if operator == "ge" else left <= right)
    return query
