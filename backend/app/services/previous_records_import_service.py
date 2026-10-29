"""Admin "Import Previous Records" — backfill old field work from Excel.

This service is intentionally separate from the task-dispatch sheet import:

* it only ever *creates* completed records flagged ``source="imported"`` in the
  existing ``capture_records`` table (never a second table), and
* it validates the whole sheet before writing anything, so the admin sees a
  preview with per-row errors and imports only the valid rows.

Old records collected by field operators before the application was deployed
have no capture-time GPS, so the admin-given ``coordinates`` column (when
present — required for the map, optional otherwise) is used to build the same
watermarked photos the mobile app produces.
"""

import io
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.capture_record import CaptureRecord
from app.models.user import User
from app.repositories.record_repository import RecordRepository
from app.repositories.user_repository import UserRepository

logger = logging.getLogger(__name__)

# Header cells are matched case-insensitively after spaces become underscores.
EMAIL_HEADERS = ("operator_email", "email", "assigned_email", "user_email", "operator")
COORDINATE_HEADERS = ("coordinates", "coordinate")
VISIT_DATE_HEADERS = ("date_of_visit", "visit_date", "date")
CONSTRUCTION_HEADERS = ("construction_happening", "construction")

# Columns that identify a real "previous field records" sheet.
KEY_COLUMNS = {
    *EMAIL_HEADERS,
    *COORDINATE_HEADERS,
    "site_address",
    "street_address",
    "survey_no",
    "owner_name_en",
}

# 15 task/site planning columns — accepted as written.
PLANNING_COLUMNS = (
        "street_address",
    "land_use",
    "survey_no",
    "subdivision_no",
    "owner_name_en",
    "site_address",
    "survey_number",
    "sub_division",
    "taluk",
    "village",
    "district",
)

# 9 field-inspection result columns.
INSPECTION_COLUMNS = (
    "date_of_visit",
    "construction_happening",
    "remarks",
    "type_of_construction",
    "relationship_with_building",
    "building_user_name",
    "contact_number",
    "stage_of_construction",
    "site_contractor_architect_name",
    "site_contractor_architect_number",
)

# Rows echoed back to the browser for the preview table. A malformed sheet can
# hold tens of thousands of rows; the counters stay exact either way.
MAX_PREVIEW_ROWS = 500

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y")


class SheetImportError(Exception):
    """A whole-file problem (unreadable workbook, wrong format, bad headers)."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def normalize_headers(header_row: Tuple[Any, ...]) -> List[str]:
    return [str(h).strip().lower().replace(" ", "_") for h in header_row]


def parse_visit_datetime(value: Optional[str], fallback: Optional[datetime] = None) -> Optional[datetime]:
    """Parse a ``date_of_visit`` cell. Returns None when it cannot be read.

    Old registers are hand-kept, so the common Indian formats are accepted
    alongside the ISO form used by the generated template.
    """
    text = (value or "").strip()
    if not text:
        return fallback
    text = text.replace("T", " ").strip()
    try:
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text[:10], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def is_parseable_date(value: Optional[str]) -> bool:
    return bool((value or "").strip()) and parse_visit_datetime(value) is not None


def parse_coordinates(value: Optional[str]) -> Optional[Tuple[float, float]]:
    """``"11.0168, 76.9558"`` -> ``(11.0168, 76.9558)``; None when invalid."""
    if not value:
        return None
    parts = [p.strip() for p in value.split(",") if p.strip()]
    if len(parts) != 2:
        return None
    try:
        latitude, longitude = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def normalize_yes_no(value: str) -> Optional[str]:
    """``"yes"/"Y"/"true"`` -> ``"Yes"``. Empty -> None. Anything else -> ''."""
    text = (value or "").strip().lower()
    if not text:
        return None
    if text in ("yes", "y", "true", "1"):
        return "Yes"
    if text in ("no", "n", "false", "0"):
        return "No"
    return ""


@dataclass
class ImportRow:
    """One spreadsheet row, validated but not yet written."""

    row_number: int
    values: Dict[str, Any] = field(default_factory=dict)
    errors: List[Dict[str, str]] = field(default_factory=list)
    # Resolved operator (set during validation) — never echoed to the client.
    user_id: Optional[int] = None
    operator_name: str = ""
    operator_email: str = ""

    @property
    def is_valid(self) -> bool:
        return not self.errors

    def preview(self) -> Dict[str, Any]:
        """JSON-ready snapshot for the preview table."""
        return {
            "row": self.row_number,
            "valid": self.is_valid,
            "operator_email": self.operator_email,
            "operator_name": self.operator_name,
            "unique_id": self.values.get("unique_id", ""),
            "site_address": self.values.get("site_address") or self.values.get("street_address", ""),
            "street_address": self.values.get("street_address", ""),
            "survey_no": self.values.get("survey_no", ""),
            "subdivision_no": self.values.get("subdivision_no", ""),
            "owner_name_en": self.values.get("owner_name_en", ""),
            "taluk": self.values.get("taluk", ""),
            "village": self.values.get("village", ""),
            "district": self.values.get("district", ""),
            "land_use": self.values.get("land_use", ""),
            "coordinates": self.values.get("coordinates", ""),
            "date_of_visit": self.values.get("date_of_visit", ""),
            "construction_happening": self.values.get("construction_happening", ""),
            "remarks": self.values.get("remarks", ""),
            "errors": self.errors,
        }


@dataclass
class ParsedSheet:
    sheet_name: str
    total_rows: int
    rows: List[ImportRow]

    @property
    def valid_rows(self) -> List[ImportRow]:
        return [r for r in self.rows if r.is_valid]

    @property
    def invalid_rows(self) -> List[ImportRow]:
        return [r for r in self.rows if not r.is_valid]

    def summary(self) -> Dict[str, Any]:
        preview = self.rows[:MAX_PREVIEW_ROWS]
        return {
            "success": bool(self.valid_rows),
            "sheet_name": self.sheet_name,
            "total_rows": self.total_rows,
            "valid_count": len(self.valid_rows),
            "invalid_count": len(self.invalid_rows),
            "preview_truncated": len(self.rows) > MAX_PREVIEW_ROWS,
            "rows": [r.preview() for r in preview],
            "errors": [
                {"row": r.row_number, "column": e["column"], "message": e["message"]}
                for r in self.rows
                for e in r.errors
            ],
        }


class PreviousRecordsImportService:
    """Parses, validates and imports admin-uploaded legacy field records."""

    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)
        self.record_repo = RecordRepository(db)

    # ── Parsing ───────────────────────────────────────────────────────
    def parse(self, filename: str, content_type: Optional[str], content: bytes) -> ParsedSheet:
        """Read the workbook and validate every row. Raises SheetImportError."""
        if not content:
            raise SheetImportError("Uploaded file is empty.")

        lower_name = (filename or "").lower()
        if lower_name.endswith(".csv") or (content_type or "") == "text/csv":
            raise SheetImportError(
                "CSV format is not supported. Please upload an Excel sheet (.xlsx). "
                "If you are using Google Sheets, export it via: File → Download → Microsoft Excel (.xlsx)"
            )
        if not (
            lower_name.endswith(".xlsx")
            or lower_name.endswith(".xls")
            or "spreadsheet" in (content_type or "").lower()
        ):
            raise SheetImportError("Invalid file format. Please upload a Microsoft Excel (.xlsx) file.")

        import openpyxl

        try:
            workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the admin
            raise SheetImportError(
                f"Unable to read Excel file. The file may be corrupt or invalid: {exc}"
            )

        sheet = workbook['Previous Records'] if 'Previous Records' in workbook.sheetnames else workbook.active
        if sheet is None:
            raise SheetImportError("No active worksheet found in Excel file.")

        raw_rows: List[List[str]] = []
        for row in sheet.iter_rows(values_only=True):
            if any(cell is not None and str(cell).strip() != "" for cell in row):
                raw_rows.append(["" if cell is None else str(cell).strip() for cell in row])

        if not raw_rows:
            raise SheetImportError("The Excel sheet contains no rows of data.")

        headers = normalize_headers(raw_rows[0])
        if not any(h in KEY_COLUMNS for h in headers):
            raise SheetImportError(
                "Unrecognized sheet format: none of the expected columns (such as "
                "'operator_email', 'coordinates', 'site_address' or 'unique_id') were found. "
                "Please download and use the official template."
            )

        data_rows = raw_rows[1:]
        rows: List[ImportRow] = []
        seen_unique_ids: Dict[str, int] = {}
        seen_coordinates: Dict[str, int] = {}

        for index, raw in enumerate(data_rows, start=2):
            record = {headers[i]: raw[i] if i < len(raw) else "" for i in range(len(headers))}
            if not any(str(v).strip() for v in record.values()):
                continue
            rows.append(self._validate_row(index, record, seen_unique_ids, seen_coordinates))

        return ParsedSheet(sheet_name=sheet.title, total_rows=len(rows), rows=rows)

    def _validate_row(
        self,
        row_number: int,
        record: Dict[str, str],
        seen_unique_ids: Dict[str, int],
        seen_coordinates: Optional[Dict[str, int]] = None,
    ) -> ImportRow:
        if seen_coordinates is None:
            seen_coordinates = {}
        row = ImportRow(row_number=row_number)
        row.values = {
            "unique_id": (record.get("unique_id") or "").strip(),
                        "coordinates": "",
            "street_address": (record.get("street_address") or "").strip(),
            "land_use": (record.get("land_use") or "").strip(),
            "survey_no": (record.get("survey_no") or "").strip(),
            "subdivision_no": (record.get("subdivision_no") or "").strip(),
            "owner_name_en": (record.get("owner_name_en") or "").strip(),
            "site_address": (record.get("site_address") or "").strip(),
            "survey_number": (record.get("survey_number") or record.get("survey_no") or "").strip(),
            "sub_division": (record.get("sub_division") or record.get("subdivision_no") or "").strip(),
            "taluk": (record.get("taluk") or "").strip(),
            "village": (record.get("village") or "").strip(),
            "district": (record.get("district") or "").strip(),
            "date_of_visit": "",
            "construction_happening": "",
            "remarks": (record.get("remarks") or "").strip(),
            "type_of_construction": (record.get("type_of_construction") or "").strip(),
            "building_user_name": (record.get("building_user_name") or "").strip(),
            "relationship_with_building": (record.get("relationship_with_building") or "").strip(),
            "contact_number": (record.get("contact_number") or "").strip(),
            "stage_of_construction": (record.get("stage_of_construction") or "").strip(),
            "site_contractor_architect_name": (record.get("site_contractor_architect_name") or "").strip(),
            "site_contractor_architect_number": (record.get("site_contractor_architect_number") or "").strip(),
        }

        # ── Operator (required) ──
        email = next((record.get(h, "").strip().lower() for h in EMAIL_HEADERS if record.get(h, "").strip()), "")
        if not email:
            user_id_value = (record.get("user_id") or record.get("userid") or "").strip()
            if user_id_value.isdigit():
                user = self.user_repo.get_by_id(int(user_id_value))
                if not user:
                    row.errors.append(
                        {"column": "user_id", "message": f"User ID {user_id_value} does not exist in the system."}
                    )
                else:
                    row.user_id, row.operator_email, row.operator_name = user.id, user.email, user.full_name
            else:
                row.errors.append(
                    {
                        "column": "operator_email",
                        "message": "Missing operator email. Column 'operator_email' is required.",
                    }
                )
        else:
            row.operator_email = email
            user = self.user_repo.get_by_email(email)
            if not user:
                row.errors.append(
                    {
                        "column": "operator_email",
                        "message": f"Operator with email '{email}' does not exist in the system.",
                    }
                )
            else:
                row.user_id, row.operator_name = user.id, user.full_name

        # ── Coordinates (optional, validated when present) ──
        coords = next(
            (record.get(h, "").strip() for h in COORDINATE_HEADERS if record.get(h, "").strip()), ""
        )
        lat_cell = record.get("latitude") or record.get("lat") or ""
        lng_cell = record.get("longitude") or record.get("lng") or ""
        if lat_cell and lng_cell:
            coords = f"{lat_cell}, {lng_cell}"
        if coords:
            if len([p for p in coords.split(",") if p.strip()]) != 2:
                row.errors.append(
                    {
                        "column": "coordinates",
                        "message": f"Invalid coordinate format '{coords}'. Expected 'latitude, longitude'.",
                    }
                )
            elif parse_coordinates(coords) is None:
                row.errors.append(
                    {
                        "column": "coordinates",
                        "message": (
                            f"Invalid coordinates '{coords}'. Latitude must be -90..90 and "
                            "longitude -180..180 decimal values."
                        ),
                    }
                )
            else:
                row.values["coordinates"] = coords
                if not row.values.get("unique_id"):
                    parsed_c = parse_coordinates(coords)
                    if parsed_c:
                        from app.services.record_service import generate_unique_id
                        try:
                            row.values["unique_id"] = generate_unique_id(parsed_c[0], parsed_c[1], prefix="CBE")
                        except Exception:
                            pass

        # ── Date of visit (optional, validated when present) ──
        raw_date = next(
            (record.get(h, "").strip() for h in VISIT_DATE_HEADERS if record.get(h, "").strip()), ""
        )
        if raw_date:
            if is_parseable_date(raw_date):
                row.values["date_of_visit"] = raw_date
            else:
                row.errors.append(
                    {
                        "column": "date_of_visit",
                        "message": (
                            f"Unreadable date '{raw_date}'. Use YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY."
                        ),
                    }
                )

        # ── Construction flag (optional, normalized to Yes/No) ──
        raw_construction = next(
            (record.get(h, "").strip() for h in CONSTRUCTION_HEADERS if record.get(h, "").strip()), ""
        )
        if raw_construction:
            normalized = normalize_yes_no(raw_construction)
            if normalized == "":
                row.errors.append(
                    {
                        "column": "construction_happening",
                        "message": f"Unrecognized value '{raw_construction}'. Use 'Yes' or 'No'.",
                    }
                )
            elif normalized is not None:
                row.values["construction_happening"] = normalized

        # ── Duplicate defence ──
        unique_id = row.values.get("unique_id") or ""
        coords_val = row.values.get("coordinates") or ""

        is_dup = False
        if unique_id and unique_id in seen_unique_ids:
            row.errors.append({
                "column": "coordinates",
                "message": f"Duplicate of row {seen_unique_ids[unique_id]} in this sheet (unique_id '{unique_id}'). Skipped duplicate row.",
            })
            is_dup = True
        elif coords_val and coords_val in seen_coordinates:
            row.errors.append({
                "column": "coordinates",
                "message": f"Duplicate coordinates of row {seen_coordinates[coords_val]} in this sheet ('{coords_val}'). Skipped duplicate row.",
            })
            is_dup = True

        if not is_dup:
            if unique_id:
                seen_unique_ids[unique_id] = row_number
            if coords_val:
                seen_coordinates[coords_val] = row_number

            # Check database for existing duplicates (across all records, imported or inspected)
            filter_clauses = []
            if unique_id:
                filter_clauses.append(CaptureRecord.unique_id == unique_id)
            if coords_val:
                filter_clauses.extend([
                    CaptureRecord.coordinates == coords_val,
                    CaptureRecord.updated_coordinates == coords_val,
                ])
                lat_lng = parse_coordinates(coords_val)
                if lat_lng:
                    filter_clauses.extend([
                        CaptureRecord.coordinates == f"{lat_lng[0]}, {lat_lng[1]}",
                        CaptureRecord.coordinates == f"{lat_lng[0]},{lat_lng[1]}",
                        CaptureRecord.updated_coordinates == f"{lat_lng[0]}, {lat_lng[1]}",
                        CaptureRecord.updated_coordinates == f"{lat_lng[0]},{lat_lng[1]}",
                    ])
            if filter_clauses:
                from sqlalchemy import or_
                existing = self.db.query(CaptureRecord).filter(or_(*filter_clauses)).first()
                if existing:
                    dup_ref = existing.unique_id or existing.coordinates or existing.updated_coordinates or f"record #{existing.id}"
                    row.errors.append({
                        "column": "coordinates",
                        "message": f"Duplicate: Coordinates/Unique ID matches existing record #{existing.id} ({dup_ref}) in database. Skipped duplicate row.",
                    })

        return row

    @staticmethod
    def _parse_int(value: Optional[str]) -> Optional[int]:
        """Read a visit order written as ``3``, ``#3`` or ``No. 3``.

        Only the first integer is taken, so a stray ``3.0`` becomes 3 rather
        than 30, and free text without digits is dropped.
        """
        match = re.search(r"\d+", (value or "").strip())
        return int(match.group()) if match else None

    # ── Commit ────────────────────────────────────────────────────────
    def import_rows(self, sheet: ParsedSheet, admin: User) -> Dict[str, Any]:
        """Write the valid rows as imported records. Returns the import report."""
        created: List[Dict[str, Any]] = []

        for row in sheet.valid_rows:
            values = row.values
            record_name = values["unique_id"] or (
                f"Site Visit - {values['site_address'][:30]}"
                if values["site_address"]
                else f"Previous Record #{row.row_number}"
            )
            description = (
                f"Imported previous field work for {values['owner_name_en'] or 'owner'} "
                f"at {values['site_address'] or values['street_address'] or 'site'}"
            )

            # Auto-resolve village, taluk, district if missing
            if not (values.get("taluk") and values.get("village") and values.get("district")):
                from app.services.village_master_service import get_village_master_service
                res = get_village_master_service().resolve_record_location(
                    village=values.get("village"),
                    taluk=values.get("taluk"),
                    district=values.get("district"),
                    coordinates=values.get("coordinates"),
                    site_address=values.get("site_address"),
                    street_address=values.get("street_address"),
                )
                values["taluk"] = res["taluk"]
                values["village"] = res["village"]
                values["district"] = res["district"]
                if res.get("formatted_address") and not values.get("street_address"):
                    values["street_address"] = res["formatted_address"]

            record = self.record_repo.create(
                user_id=row.user_id,
                name=record_name,
                description=description,
                status="COMPLETED",
                source="imported",
                unique_id=values["unique_id"] or None,
                                coordinates=values["coordinates"] or None,
                street_address=values["street_address"] or None,
                land_use=values["land_use"] or None,
                survey_no=values["survey_no"] or None,
                subdivision_no=values["subdivision_no"] or None,
                owner_name_en=values["owner_name_en"] or None,
                site_address=values["site_address"] or None,
                survey_number=values["survey_number"] or None,
                sub_division=values["sub_division"] or None,
                taluk=values["taluk"] or None,
                village=values["village"] or None,
                district=values["district"] or None,
                date_of_visit=values["date_of_visit"] or None,
                construction_happening=values["construction_happening"] or None,
                remarks=values["remarks"] or None,
                type_of_construction=values["type_of_construction"] or None,
                building_user_name=values["building_user_name"] or None,
                relationship_with_building=values["relationship_with_building"] or None,
                contact_number=values["contact_number"] or None,
                stage_of_construction=values["stage_of_construction"] or None,
                site_contractor_architect_name=values["site_contractor_architect_name"] or None,
                site_contractor_architect_number=values["site_contractor_architect_number"] or None,
            )

            created.append(
                {
                    "record_id": record.id,
                    "row": row.row_number,
                    "unique_id": record.unique_id or "",
                    "operator_email": row.operator_email,
                    "operator_name": row.operator_name,
                    "site_address": values["site_address"] or values["street_address"],
                    "coordinates": values["coordinates"],
                }
            )

        return {
            "success": len(created) > 0,
            "imported_count": len(created),
            "skipped_count": len(sheet.invalid_rows),
            "total_rows": sheet.total_rows,
            "sheet_name": sheet.sheet_name,
            "records": created,
            "errors": [
                {"row": r.row_number, "column": e["column"], "message": e["message"]}
                for r in sheet.invalid_rows
                for e in r.errors
            ],
        }
