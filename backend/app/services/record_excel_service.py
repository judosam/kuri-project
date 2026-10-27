"""Admin full-record Excel export, including inspection answers and photos."""
import io
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.styles import Alignment, Font, PatternFill

from app.services.google_drive_service import GoogleDriveService
from app.services.local_storage_service import LocalStorageService

REPORT_BATCH_SIZE = 500


def iter_report_records(service, **filters):
    """Read every matching record, rather than silently stopping at 10,000."""
    page = 1
    while True:
        records, total = service.get_all_records(
            page=page, page_size=REPORT_BATCH_SIZE, sort_by='id', sort_order='asc', **filters
        )
        yield from records
        if not records or page * REPORT_BATCH_SIZE >= total:
            return
        page += 1


def _photo_bytes(record, photo):
    key = photo.google_drive_file_id
    if key.startswith(('pending:', 'simulated-')):
        return None
    storage = LocalStorageService()
    path = storage.get_file_path(key) or storage.get_file_path(
        f'{record.user_id}/{record.id}/{photo.file_name}'
    )
    if path:
        return Path(path).read_bytes()
    if not any(separator in key for separator in ('/', '\\', ':')):
        drive = GoogleDriveService()
        if drive.service:
            return drive.service.files().get_media(fileId=key).execute()
    return None


def _append(sheet, values):
    sheet.append(values)
    # Imported/free-text answers must remain literal text, even starting with '='.
    for cell in sheet[sheet.max_row]:
        if isinstance(cell.value, str):
            cell.data_type = 's'
        cell.alignment = Alignment(vertical='top', wrap_text=True)


def build_record_excel(record, detail: dict) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Record Details'
    _append(sheet, ['Field', 'Value'])
    labels = {'id': 'Record ID', 'unique_id': 'Unique ID', 'user_id': 'User ID',
              'owner_name_en': 'Owner Name', 'user_name': 'Operator Name',
              'assigned_auditor_name': 'QA User',
              'created_at': 'Created At (UTC)', 'source': 'Record Source'}
    for field, value in detail.items():
        if field in ('images', 'errors'):
            continue
        _append(sheet, [labels.get(field, field.replace('_', ' ').title()), value])
        sheet.row_dimensions[sheet.max_row].height = max(30, min(180, 16 * (1 + len(str(value or '')) // 75)))
    _append(sheet, ['Operator Email', record.user.email if record.user else None])
    _append(sheet, ['Photo Count', len(record.images)])
    sheet.column_dimensions['A'].width = 36
    sheet.column_dimensions['B'].width = 100
    sheet.auto_filter.ref = sheet.dimensions

    photos = workbook.create_sheet('Photos')
    _append(photos, ['Photo', 'File Name', 'Source', 'Captured At (UTC)',
                     'Latitude', 'Longitude', 'Accuracy (m)', 'Image / Availability'])
    for photo in record.images:
        _append(photos, [photo.photo_order, photo.file_name, photo.source,
                         photo.captured_at.isoformat(), photo.latitude,
                         photo.longitude, photo.location_accuracy, 'Image unavailable'])
        row = photos.max_row
        try:
            content = _photo_bytes(record, photo)
            if content:
                image = ExcelImage(io.BytesIO(content))
                scale = min(1, 480 / image.width, 300 / image.height)
                image.width *= scale
                image.height *= scale
                photos.add_image(image, f'H{row}')
                photos.cell(row, 8).value = None
                photos.row_dimensions[row].height = max(40, image.height * 0.75 + 12)
        except Exception:
            # Keep the record downloadable and explicitly flag missing/bad photos.
            photos.cell(row, 8).value = 'Image unavailable'
    for column in ('A', 'E', 'F', 'G'):
        photos.column_dimensions[column].width = 18
    for column in ('B', 'C', 'D'):
        photos.column_dimensions[column].width = 28
    photos.column_dimensions['H'].width = 70
    if not record.images:
        _append(photos, ['No photos attached to this record.'])
    for page in workbook:
        page.freeze_panes = 'A2'
        page.sheet_view.showGridLines = False
        page.row_dimensions[1].height = 30
        for cell in page[1]:
            cell.font = Font(name='Calibri', bold=True, color='FFFFFF', size=11)
            cell.fill = PatternFill('solid', fgColor='18344B')
            cell.alignment = Alignment(vertical='center', wrap_text=True)
        page.sheet_properties.pageSetUpPr.fitToPage = True
        page.page_setup.orientation = 'landscape'
        page.page_setup.paperSize = page.PAPERSIZE_A4
        page.page_setup.fitToWidth = 1
        page.page_setup.fitToHeight = 0
        page.print_title_rows = '1:1'
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


SECTION_FIELD_MAP = {
    # 1. Imported Data
    "planning": [
        "id", "unique_id", "name", "source", "created_at", "coordinates",
        "site_address", "street_address", "admin_formatted_address",
        "village", "taluk", "district", "survey_no", "subdivision_no",
        "land_use", "owner_name_en", "stage_of_construction", "no_of_floors", "built_up_area", "expected_completion", "cumulative_road_distance_km",
        "staged_operator_name", "uploaded_by_name",
    ],
    # 2. DC Data
    "audit": [
        "assigned_auditor_name", "qc_status", "audited_by_name", "audited_at",
        "audit_comment", "qc_vhr_comment", "qc_street_details",
        "qc_builder_contact", "qc_sqfeet", "qc_completed_at", "qc_edited_at", "qc_by_name",
    ],
    # 3. Field Verifier Data
    "field": [
        "user_name", "operator_email", "status", "assigned_at", "assigned_date",
        "field_captured_at", "date_of_visit", "formatted_address",
        "field_latitude", "field_longitude", "field_location_accuracy",
        "deviation_meters", "deviation_formatted", "deviation_status",
        "construction_happening", "type_of_construction", "stage_of_construction",
        "building_user_name", "relationship_with_building", "spoken_with", "contact_number",
        "site_contractor_architect_name", "site_contractor_architect_number",
        "remarks", "photo_count", "captured_at",
    ],
    # 4. Telecaller Data
    "telecaller": [
        "assigned_telecaller_name", "telecaller_status", "telecaller_comment",
        "telecaller_called_at", "telecaller_by_name",
    ],
    # 5. Reassign Columns
    "reassign": [
        "reassigned_to_name", "reassigned_at", "revisit_status",
        "updated_coordinates", "updated_information", "follow_up_date",
    ],
}

REPORT_LABELS = {
    "id": "Record ID",
    "unique_id": "Unique ID",
    "last_modified_at": "Last Modified Date",
    "name": "Record Name",
    "source": "Record Source",
    "created_at": "Created At (UTC)",
    "coordinates": "Imported Coordinates",
    "site_address": "Site Address",
    "street_address": "Street Address",
    "admin_formatted_address": "Admin Resolved Address",
    "village": "Village",
    "taluk": "Taluk",
    "district": "District",
    "survey_no": "Survey No",
    "subdivision_no": "Subdivision No",
    "land_use": "Land Use",
    "owner_name_en": "Owner Name",
    "cumulative_road_distance_km": "Road Distance (km)",
    "staged_operator_name": "Suggested Field Verifier",
    "uploaded_by_name": "Imported By",
    "assigned_auditor_name": "QA User",
    "audit_status": "QC Status",
    "audited_by_name": "Audited By",
    "audited_at": "Audited At",
    "audit_comment": "Audit Comment",
    "qc_status": "QC Status",
    "qc_vhr_comment": "QC Comments (VHR Imagery)",
    "qc_street_details": "QC Additional Details (Street View)",
    "qc_builder_contact": "QC Builder Contact",
    "qc_sqfeet": "Sq.ft",
    "qc_completed_at": "QC Completed At",
    "qc_edited_at": "QC Edited At",
    "qc_by_name": "QC Done By",
    "user_name": "Field Verifier",
    "operator_email": "Operator Email",
    "status": "Verification Status",
    "assigned_at": "Assigned Date",
    "assigned_date": "Assigned Date (YYYY-MM-DD)",
    "field_captured_at": "Captured / Inspection Completed",
    "date_of_visit": "Date of Visit",
    "formatted_address": "Field Inspection Address",
    "field_latitude": "Field Latitude",
    "field_longitude": "Field Longitude",
    "field_location_accuracy": "Accuracy (m)",
    "deviation_meters": "Deviation (m)",
    "deviation_formatted": "Deviation",
    "deviation_status": "Deviation Status",
    "construction_happening": "Construction Happening",
    "type_of_construction": "Type of Construction",
    "stage_of_construction": "Stage of Construction",
    "building_user_name": "Building User",
    "relationship_with_building": "Relationship with Building",
    "spoken_with": "Spoken With",
    "contact_number": "Contact Number",
    "site_contractor_architect_name": "Contractor / Architect",
    "site_contractor_architect_number": "Contractor Contact",
    "remarks": "Inspection Remarks",
    "photo_count": "Photo Count",
    "captured_at": "Captured At (UTC)",
    "assigned_telecaller_name": "Assigned Telecaller",
    "telecaller_status": "Telecaller Status",
    "telecaller_comment": "Telecaller Comment",
    "telecaller_called_at": "Telecaller Called At",
    "telecaller_by_name": "Telecaller Done By",
    "reassigned_to_name": "Reassigned Field Verifier",
    "reassigned_at": "Reassign Date",
    "revisit_status": "Revisit Status",
    "updated_coordinates": "Updated Coordinates",
    "updated_information": "Updated Information",
    "follow_up_date": "Follow-up Date",
}


def build_records_report(
    records,
    serialize,
    include_images: bool = True,
    sections: list[str] | None = None,
) -> bytes:
    """One row per record with configurable sections, plus optional linked photos sheet."""
    from openpyxl.utils import get_column_letter

    # Resolve fields according to selected sections:
    # 1. Imported Data -> 2. DC Data -> 3. Field Verifier Data -> 4. Telecaller Data -> 5. Reassign Columns
    selected_fields: list[str] = ["id", "unique_id", "last_modified_at"]
    active_sections = (
        sections
        if sections and any(s in SECTION_FIELD_MAP for s in sections)
        else ["planning", "audit", "field", "telecaller", "reassign"]
    )

    for sec in active_sections:
        if sec in SECTION_FIELD_MAP:
            for f in SECTION_FIELD_MAP[sec]:
                if f not in selected_fields:
                    selected_fields.append(f)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Inspections Report"

    header_labels = [REPORT_LABELS.get(f, f.replace("_", " ").title()) for f in selected_fields]
    _append(sheet, header_labels)

    photos_sheet = None
    if include_images:
        photos_sheet = workbook.create_sheet("Photos")
        _append(photos_sheet, [
            "Record ID", "Unique ID", "Photo ID", "Photo Order", "File Name", "Source",
            "Captured At (UTC)", "Added At (UTC)", "Latitude", "Longitude",
            "Accuracy (m)", "Image / Availability",
        ])

    for record in records:
        detail = serialize(record).model_dump(mode="json")
        images = detail.get("images", [])
        detail["operator_email"] = record.user.email if record.user else None
        detail["photo_count"] = len(images)
        detail["captured_at"] = images[0]["captured_at"] if images else None
        if "reassigned_to_name" not in detail or not detail["reassigned_to_name"]:
            detail["reassigned_to_name"] = record.reassigned_to.full_name if getattr(record, "reassigned_to", None) else None
        if "reassigned_at" not in detail or not detail["reassigned_at"]:
            detail["reassigned_at"] = record.reassigned_at.isoformat() if getattr(record, "reassigned_at", None) else None
        if "revisit_status" not in detail or not detail["revisit_status"]:
            detail["revisit_status"] = getattr(record, "revisit_status", None)
        if "updated_coordinates" not in detail or not detail["updated_coordinates"]:
            detail["updated_coordinates"] = getattr(record, "updated_coordinates", None)
        if "updated_information" not in detail or not detail["updated_information"]:
            detail["updated_information"] = getattr(record, "updated_information", None)

        # Telecaller data fallbacks
        if "assigned_telecaller_name" not in detail or not detail["assigned_telecaller_name"]:
            detail["assigned_telecaller_name"] = (
                (record.assigned_telecaller.full_name or record.assigned_telecaller.email)
                if getattr(record, "assigned_telecaller", None)
                else None
            )
        if "telecaller_status" not in detail or not detail["telecaller_status"]:
            detail["telecaller_status"] = getattr(record, "telecaller_status", None)
        if "telecaller_comment" not in detail or not detail["telecaller_comment"]:
            detail["telecaller_comment"] = getattr(record, "telecaller_comment", None)
        if "telecaller_called_at" not in detail or not detail["telecaller_called_at"]:
            called = getattr(record, "telecaller_called_at", None)
            detail["telecaller_called_at"] = called.isoformat() if hasattr(called, "isoformat") else (str(called) if called else None)
        if "telecaller_by_name" not in detail or not detail["telecaller_by_name"]:
            detail["telecaller_by_name"] = (
                (record.telecaller_by.full_name or record.telecaller_by.email)
                if getattr(record, "telecaller_by", None)
                else None
            )

        # Unified QC Status (Merged Audit Decision & QA Status)
        audit_val = detail.get("audit_status")
        if audit_val:
            audit_label_map = {
                "APPROVAL": "Approval",
                "DISAPPROVAL": "Disapproval",
                "COMMERCIAL_PROPERTY": "Commercial Property",
                "RE_AUDITED": "Reaudited",
                "PENDING": "Pending",
            }
            unified_qc = audit_label_map.get(str(audit_val).upper(), str(audit_val).replace("_", " ").title())
            if getattr(record, "qc_edited_at", None):
                unified_qc += " (QC Edited)"
            detail["qc_status"] = unified_qc
            detail["audit_status"] = unified_qc
        elif getattr(record, "qc_edited_at", None):
            detail["qc_status"] = "QC Edited"
            detail["audit_status"] = "QC Edited"
        elif getattr(record, "qc_completed_at", None) or any(
            getattr(record, attr, None) and str(getattr(record, attr, None)).strip()
            for attr in ("qc_vhr_comment", "qc_street_details", "qc_builder_contact", "qc_sqfeet")
        ):
            detail["qc_status"] = "QC Done"
            detail["audit_status"] = "QC Done"
        else:
            detail["qc_status"] = "QC Pending"
            detail["audit_status"] = "QC Pending"

        # Verification Status label
        if detail.get("status") in ("COMPLETED", "Updated Revisited", "UPDATED_REVISITED") or detail.get("revisit_status") == "COMPLETED":
            detail["status"] = "Completed"
        elif detail.get("status") == "NOT_COMPLETED":
            if (
                detail.get("reassigned_to_id") is not None
                or detail.get("reassigned_to_name") is not None
                or detail.get("revisit_status") in ("REASSIGNED", "PENDING_REVISIT")
            ):
                detail["status"] = "Reassigned"
            else:
                detail["status"] = "Pending"
        elif detail.get("status"):
            detail["status"] = str(detail.get("status")).replace("_", " ").title()

        _append(sheet, [detail.get(f) for f in selected_fields])
        sheet.row_dimensions[sheet.max_row].height = 40

        if include_images and photos_sheet is not None:
            for photo, metadata in zip(record.images, images):
                _append(photos_sheet, [
                    record.id, record.unique_id, photo.id, photo.photo_order, photo.file_name,
                    photo.source, metadata.get("captured_at"), metadata.get("created_at"),
                    photo.latitude, photo.longitude, photo.location_accuracy, "Image unavailable",
                ])
                row = photos_sheet.max_row
                try:
                    content = _photo_bytes(record, photo)
                    if content:
                        from PIL import Image
                        with Image.open(io.BytesIO(content)) as original:
                            original.thumbnail((480, 300))
                            preview = io.BytesIO()
                            original.convert("RGB").save(preview, format="JPEG", quality=90)
                        preview.seek(0)
                        image = ExcelImage(preview)
                        photos_sheet.add_image(image, f"L{row}")
                        photos_sheet.cell(row, 12).value = None
                        photos_sheet.row_dimensions[row].height = max(40, image.height * 0.75 + 12)
                except Exception:
                    photos_sheet.cell(row, 12).value = "Image unavailable"

    for page in workbook:
        page.freeze_panes = "C2"
        page.auto_filter.ref = page.dimensions
        page.sheet_view.showGridLines = True
        page.row_dimensions[1].height = 42
        for cell in page[1]:
            cell.font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
            cell.fill = PatternFill("solid", fgColor="18344B")
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            col_letter = get_column_letter(cell.column)
            page.column_dimensions[col_letter].width = 24

    if include_images and photos_sheet is not None:
        photos_sheet.column_dimensions["L"].width = 70

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
