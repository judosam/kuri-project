"""
Service to safely and idempotently merge Commercial Property records
from 'Big builders contact details (1).xlsx' into the database.

Guarantees:
1. Every record is classified as 'Commercial Property' (property_type and audit_status).
2. Commercial Property records are NEVER assigned to Field Verifiers (user_id = None).
3. Contact numbers are normalized and formatted.
4. Idempotent: repeated runs produce 0 duplicate records.
5. Emits an audited summary.
"""
import os
import re
import sys
from datetime import datetime, timezone
import openpyxl
from sqlalchemy import text

# Ensure backend path is available
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.database.connection import SessionLocal, engine, create_tables
from app.models.capture_record import CaptureRecord
from app.models.user import User


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    raw_str = str(raw).strip()
    if not raw_str or raw_str.lower() in ("none", "nil", "nan", "-"):
        return None

    # Split multiple phone numbers if joined by comma, semicolon, slash, newline
    parts = re.split(r'[,;/\n]+', raw_str)
    normalized_parts = []
    for p in parts:
        clean = re.sub(r'[^\d+]', '', p)
        if clean.startswith('+91') and len(clean) == 13:
            clean = clean[3:]
        elif clean.startswith('91') and len(clean) == 12:
            clean = clean[2:]
        elif clean.startswith('0') and len(clean) == 11:
            clean = clean[1:]
        if clean:
            normalized_parts.append(clean)
    return ", ".join(normalized_parts) if normalized_parts else raw_str


def merge_excel_to_db(excel_path: str, target_db_session=None) -> dict:
    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"Excel file not found at: {excel_path}")

    # Ensure schema has property_type column
    create_tables()

    db = target_db_session or SessionLocal()
    should_close = target_db_session is None

    summary = {
        "total_excel_records": 0,
        "new_records_added": 0,
        "existing_records_updated": 0,
        "duplicates_skipped": 0,
        "failed_records": 0,
        "commercial_property_identified": 0,
        "unassigned_from_field_verifiers": 0,
        "details": [],
    }

    try:
        wb = openpyxl.load_workbook(excel_path, data_only=True)
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            return summary

        # Row 0 is headers
        data_rows = rows[1:]
        summary["total_excel_records"] = len(data_rows)

        # Preload users for auditor matching
        all_users = db.query(User).all()
        user_by_name = {u.full_name.strip().lower(): u for u in all_users if u.full_name}
        user_by_email = {u.email.strip().lower(): u for u in all_users if u.email}

        seen_uids_in_sheet = set()

        for idx, row in enumerate(data_rows, start=2):
            try:
                # Row mapping
                # 0: Record Name (unique_id)
                uid_raw = row[0]
                unique_id = str(uid_raw).strip() if uid_raw is not None else ""
                if not unique_id:
                    summary["failed_records"] += 1
                    summary["details"].append(f"Row {idx}: Missing unique_id, skipped.")
                    continue

                if unique_id in seen_uids_in_sheet:
                    summary["duplicates_skipped"] += 1
                    continue
                seen_uids_in_sheet.add(unique_id)

                coords_raw = str(row[1]).strip() if row[1] is not None else None
                street_addr_raw = str(row[2]).strip() if row[2] is not None else None
                land_use_raw = str(row[3]).strip() if row[3] is not None else None
                owner_raw = str(row[4]).strip() if row[4] is not None else None
                survey_raw = str(row[5]).strip() if row[5] is not None else None
                subdiv_raw = str(row[6]).strip() if row[6] is not None else None
                village_raw = str(row[7]).strip() if row[7] is not None else None
                taluk_raw = str(row[8]).strip() if row[8] is not None else None
                district_raw = str(row[9]).strip() if row[9] is not None else None
                qc_vhr_raw = str(row[10]).strip() if row[10] is not None else None
                qc_street_raw = str(row[11]).strip() if row[11] is not None else None
                qc_builder_raw = str(row[12]).strip() if row[12] is not None else None
                auditor_name_raw = str(row[13]).strip() if row[13] is not None else None
                audited_at_raw = row[14]
                audit_decision_raw = str(row[15]).strip() if row[15] is not None else "Commercial Property"
                const_happening_raw = str(row[16]).strip() if row[16] is not None else "Yes"
                bldg_user_raw = str(row[17]).strip() if row[17] is not None else None
                rel_bldg_raw = str(row[18]).strip() if row[18] is not None else None
                contact_raw = normalize_phone(row[19])
                stage_raw = str(row[20]).strip() if row[20] is not None else None
                contractor_name_raw = str(row[21]).strip() if row[21] is not None else None
                contractor_num_raw = normalize_phone(row[22])

                # Parse audited_at date
                audited_dt = None
                if isinstance(audited_at_raw, datetime):
                    audited_dt = audited_at_raw.replace(tzinfo=timezone.utc)
                elif audited_at_raw:
                    try:
                        audited_dt = datetime.fromisoformat(str(audited_at_raw)).replace(tzinfo=timezone.utc)
                    except Exception:
                        pass

                # Resolve auditor user
                auditor_user = None
                if auditor_name_raw:
                    a_key = auditor_name_raw.lower()
                    auditor_user = user_by_name.get(a_key) or next((u for k, u in user_by_name.items() if a_key in k), None)

                # Look up existing record
                existing = db.query(CaptureRecord).filter(CaptureRecord.unique_id == unique_id).first()

                summary["commercial_property_identified"] += 1

                if existing:
                    # Update existing record safely
                    if existing.user_id is not None:
                        # Commercial property must NOT be assigned to Field Verifiers
                        existing.user_id = None
                        existing.assigned_at = None
                        existing.staged_operator_id = None
                        summary["unassigned_from_field_verifiers"] += 1

                    existing.property_type = "Commercial Property"
                    existing.audit_status = "COMMERCIAL_PROPERTY"

                    if coords_raw and not existing.coordinates:
                        existing.coordinates = coords_raw
                    if street_addr_raw and not existing.street_address:
                        existing.street_address = street_addr_raw
                    if land_use_raw:
                        existing.land_use = land_use_raw
                    if owner_raw and not existing.owner_name_en:
                        existing.owner_name_en = owner_raw
                    if survey_raw and not existing.survey_no:
                        existing.survey_no = survey_raw
                        existing.survey_number = survey_raw
                    if subdiv_raw and not existing.subdivision_no:
                        existing.subdivision_no = subdiv_raw
                        existing.sub_division = subdiv_raw
                    if village_raw:
                        existing.village = village_raw
                    if taluk_raw:
                        existing.taluk = taluk_raw
                    if district_raw:
                        existing.district = district_raw
                    if qc_vhr_raw:
                        existing.qc_vhr_comment = qc_vhr_raw
                    if qc_street_raw:
                        existing.qc_street_details = qc_street_raw
                    if qc_builder_raw:
                        existing.qc_builder_contact = qc_builder_raw
                    if auditor_user:
                        existing.audited_by_id = auditor_user.id
                        existing.qc_by_id = auditor_user.id
                        existing.assigned_auditor_id = auditor_user.id
                    if audited_dt:
                        existing.audited_at = audited_dt
                        existing.qc_completed_at = audited_dt
                    if const_happening_raw:
                        existing.construction_happening = const_happening_raw
                    if bldg_user_raw:
                        existing.building_user_name = bldg_user_raw
                    if rel_bldg_raw:
                        existing.relationship_with_building = rel_bldg_raw
                    if contact_raw:
                        existing.contact_number = contact_raw
                    if stage_raw:
                        existing.stage_of_construction = stage_raw
                    if contractor_name_raw:
                        existing.site_contractor_architect_name = contractor_name_raw
                    if contractor_num_raw:
                        existing.site_contractor_architect_number = contractor_num_raw

                    summary["existing_records_updated"] += 1
                else:
                    # Create new Commercial Property record
                    name = f"Commercial Property: {unique_id}"
                    desc = f"Commercial Property construction identified at {street_addr_raw or village_raw or 'site'}"

                    new_rec = CaptureRecord(
                        name=name,
                        description=desc,
                        unique_id=unique_id,
                        coordinates=coords_raw,
                        street_address=street_addr_raw,
                        site_address=street_addr_raw,
                        land_use=land_use_raw,
                        owner_name_en=owner_raw,
                        survey_no=survey_raw,
                        survey_number=survey_raw,
                        subdivision_no=subdiv_raw,
                        sub_division=subdiv_raw,
                        village=village_raw,
                        taluk=taluk_raw,
                        district=district_raw or "Coimbatore",
                        qc_vhr_comment=qc_vhr_raw,
                        qc_street_details=qc_street_raw,
                        qc_builder_contact=qc_builder_raw,
                        audited_by_id=auditor_user.id if auditor_user else None,
                        qc_by_id=auditor_user.id if auditor_user else None,
                        assigned_auditor_id=auditor_user.id if auditor_user else None,
                        audited_at=audited_dt or datetime.now(timezone.utc),
                        qc_completed_at=audited_dt or datetime.now(timezone.utc),
                        audit_status="COMMERCIAL_PROPERTY",
                        property_type="Commercial Property",
                        construction_happening=const_happening_raw,
                        building_user_name=bldg_user_raw,
                        relationship_with_building=rel_bldg_raw,
                        contact_number=contact_raw,
                        stage_of_construction=stage_raw,
                        site_contractor_architect_name=contractor_name_raw,
                        site_contractor_architect_number=contractor_num_raw,
                        source="imported",
                        status="NOT_COMPLETED",
                        user_id=None,  # Strictly NEVER assigned to Field Verifiers!
                        staged_operator_id=None,
                        assigned_at=None,
                        created_at=audited_dt or datetime.now(timezone.utc),
                    )
                    db.add(new_rec)
                    summary["new_records_added"] += 1

            except Exception as e:
                summary["failed_records"] += 1
                summary["details"].append(f"Row {idx} error: {str(e)}")

        db.commit()

        # Sync telecaller leads for Commercial Property records with phone numbers
        try:
            from app.routers.telecaller import sync_unassigned_telecaller_leads
            sync_unassigned_telecaller_leads(db)
        except Exception:
            pass

    finally:
        if should_close:
            db.close()

    return summary


if __name__ == "__main__":
    path = r"C:\Users\Samuel P\Downloads\Big builders contact details (1).xlsx"
    print(f"Starting Commercial Property merge from: {path}")
    res = merge_excel_to_db(path)
    print("\n--- COMMERCIAL PROPERTY MERGE SUMMARY ---")
    print(f"Total Excel Records:               {res['total_excel_records']}")
    print(f"Commercial Properties Identified:  {res['commercial_property_identified']}")
    print(f"New Records Added:                 {res['new_records_added']}")
    print(f"Existing Records Updated:          {res['existing_records_updated']}")
    print(f"Unassigned from Field Verifiers:   {res['unassigned_from_field_verifiers']}")
    print(f"Duplicates Skipped:                {res['duplicates_skipped']}")
    print(f"Failed Records:                    {res['failed_records']}")
    if res['details']:
        print("\nDetails / Notes:")
        for d in res['details'][:10]:
            print("  *", d)
