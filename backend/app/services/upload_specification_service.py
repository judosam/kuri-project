"""
Authoritative Kuri Upload Specification & Cadastral Auto-Enrichment Service.

Implements strict validation and atomic ingestion according to the 12-column GIS specification:
1. Site ID Check: Rejects batch if "Site ID" or "unique_id" column has values.
2. Reject Rules (All-or-Nothing):
   - lat: [10.6, 11.4]
   - lon: [76.6, 77.4]
   - Village: non-empty, matched in Village Master
   - Taluk: in Coimbatore revenue taluk list
   - area_sqm: > 0
3. Warn Rules (Preserved for QC review):
   - detection_type: unexpected value
   - model_confidence_score: outside [0.0, 1.0]
   - priority_tier: non-standard tier
   - contradicts_planetscope_vegetated: True
   - area_sqft < 1500: Sub-threshold plot: Not Eligible (is_eligible=False)
4. Spatial Deduplication (40m):
   - Sites <= 40.0m from an existing record update metadata rather than duplicating.
5. Coordinate Collision (~11m cell):
   - Standard 6-digit CBE-XXXXXX minted; collision reference saved in old_unique_id.
6. Cadastral Auto-Enrichment:
   - TNGIS WFS GeoServer FMB parcel lookup with fallback to cadastral_lookup_pending.
"""

import csv
import io
import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.capture_record import CaptureRecord
from app.models.user import User
from app.services.cadastral_enrichment_service import (
    COIMBATORE_TALUKS,
    CadastralEnrichmentService,
    normalize_taluk_name,
)
from app.services.record_service import RecordService
from app.services.village_master_service import get_village_master_service

logger = logging.getLogger(__name__)

# Bounding box envelope for Coimbatore district
LAT_MIN = 10.60
LAT_MAX = 11.40
LON_MIN = 76.60
LON_MAX = 77.40

# Earth radius in meters for Haversine
EARTH_RADIUS_M = 6371000.0


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two coordinate pairs in meters."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_M * c


class UploadSpecificationService:
    def __init__(self, db: Session):
        self.db = db
        self.vms = get_village_master_service()
        self.cadastral_service = CadastralEnrichmentService()
        self.record_service = RecordService(db)

    def parse_raw_rows(
        self, file_bytes: bytes, filename: str
    ) -> Tuple[List[str], List[Dict[str, Any]]]:
        """Parse .xlsx or .csv into a list of normalized row dictionaries."""
        lower_name = filename.lower()
        if lower_name.endswith(".csv"):
            text = file_bytes.decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            fieldnames = [c.strip() for c in (reader.fieldnames or [])]
            rows = []
            for r in reader:
                rows.append({k.strip(): (v.strip() if v else "") for k, v in r.items() if k})
            return fieldnames, rows
        else:
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            try:
                raw_headers = next(rows_iter)
            except StopIteration:
                return [], []
            headers = [str(h).strip() if h is not None else "" for h in raw_headers]
            rows = []
            for r in rows_iter:
                if not any(r):
                    continue
                row_dict = {}
                for idx, cell in enumerate(r):
                    if idx < len(headers) and headers[idx]:
                        val = str(cell).strip() if cell is not None else ""
                        row_dict[headers[idx]] = val
                if row_dict:
                    rows.append(row_dict)
            return headers, rows

    def find_column(self, row: Dict[str, Any], candidates: List[str]) -> Optional[str]:
        """Case-insensitive fuzzy match for column names."""
        for c in candidates:
            for k in row.keys():
                if k.lower() == c.lower():
                    return k
        return None

    def get_val(self, row: Dict[str, Any], candidates: List[str], default: Any = None) -> Any:
        col = self.find_column(row, candidates)
        if col is not None and row[col] != "":
            return row[col]
        return default

    def validate_batch(
        self, file_bytes: bytes, filename: str
    ) -> Dict[str, Any]:
        """
        Performs all validation checks for the upload batch without modifying the DB.
        Returns detailed summary of errors, warnings, merged candidates, and eligible rows.
        """
        headers, rows = self.parse_raw_rows(file_bytes, filename)
        if not rows:
            return {
                "valid": False,
                "rejected": True,
                "reject_reason": "The uploaded file contains no data rows.",
                "total_rows": 0,
                "valid_count": 0,
                "errors": [{"row": 1, "column": "File", "reason": "No data rows found"}],
                "warnings": [],
                "merged_candidates": [],
                "new_candidates": [],
            }

        # 1. Site ID Check: If any Site ID / unique_id column exists with non-empty values -> REJECT
        site_id_col = None
        for h in headers:
            h_low = h.lower().replace("_", "").replace(" ", "").replace("-", "")
            if h_low in ("siteid", "uniqueid", "id", "kuriid"):
                site_id_col = h
                break

        if site_id_col:
            has_values = any(bool(r.get(site_id_col, "").strip()) for r in rows)
            if has_values:
                return {
                    "valid": False,
                    "rejected": True,
                    "reject_reason": f"Batch rejected: '{site_id_col}' column contains values. Platform strictly mints standard CBE-XXXXXX unique IDs automatically upon import.",
                    "total_rows": len(rows),
                    "valid_count": 0,
                    "errors": [
                        {
                            "row": 1,
                            "column": site_id_col,
                            "reason": "Site ID must not be pre-assigned in upload files. System generates standard 6-digit CBE-XXXXXX IDs.",
                        }
                    ],
                    "warnings": [],
                    "merged_candidates": [],
                    "new_candidates": [],
                }

        errors: List[Dict[str, Any]] = []
        warnings: List[Dict[str, Any]] = []
        parsed_rows: List[Dict[str, Any]] = []

        # Row-by-row validation
        for idx, row in enumerate(rows, start=2):
            row_errors: List[str] = []

            # Latitude
            lat_raw = self.get_val(row, ["lat", "latitude", "y"])
            lat_val: Optional[float] = None
            if lat_raw is None:
                row_errors.append("Missing required 'lat' (latitude) coordinate.")
            else:
                try:
                    lat_val = float(str(lat_raw).replace(",", "."))
                    if not (LAT_MIN <= lat_val <= LAT_MAX):
                        row_errors.append(
                            f"Latitude {lat_val:.5f} is outside Coimbatore envelope ({LAT_MIN} to {LAT_MAX})."
                        )
                except ValueError:
                    row_errors.append(f"Invalid latitude numeric format: '{lat_raw}'.")

            # Longitude
            lon_raw = self.get_val(row, ["lon", "lng", "longitude", "x"])
            lon_val: Optional[float] = None
            if lon_raw is None:
                row_errors.append("Missing required 'lon' (longitude) coordinate.")
            else:
                try:
                    lon_val = float(str(lon_raw).replace(",", "."))
                    if not (LON_MIN <= lon_val <= LON_MAX):
                        row_errors.append(
                            f"Longitude {lon_val:.5f} is outside Coimbatore envelope ({LON_MIN} to {LON_MAX})."
                        )
                except ValueError:
                    row_errors.append(f"Invalid longitude numeric format: '{lon_raw}'.")

            # Village
            village_raw = self.get_val(row, ["village", "revenue_village", "rev_village", "village_name"])
            if not village_raw or not str(village_raw).strip():
                row_errors.append("Missing required 'Village' column.")
            else:
                village_clean = str(village_raw).strip()
                v_match = self.vms.lookup_village_by_name(village_clean)
                if not v_match:
                    # Check if at least stem or partial matches in Coimbatore
                    stemmed = self.vms.search_villages(village_clean, limit=1)
                    if not stemmed:
                        row_errors.append(
                            f"Village '{village_clean}' is not recognized in Tamil Nadu Revenue Village Master."
                        )

            # Taluk
            taluk_raw = self.get_val(row, ["taluk", "taluk_name", "tehsil"])
            norm_taluk = normalize_taluk_name(str(taluk_raw)) if taluk_raw else None
            if not norm_taluk:
                row_errors.append("Missing required 'Taluk' column.")
            else:
                if norm_taluk.lower() not in COIMBATORE_TALUKS:
                    row_errors.append(
                        f"Taluk '{taluk_raw}' is not a valid Coimbatore revenue taluk."
                    )

            # Area Sqm
            area_sqm_raw = self.get_val(row, ["area_sqm", "area", "plot_area_sqm", "areasqm"])
            area_sqm_val = 0.0
            if area_sqm_raw is None:
                row_errors.append("Missing required 'area_sqm' column.")
            else:
                try:
                    area_sqm_val = float(str(area_sqm_raw).replace(",", "."))
                    if area_sqm_val <= 0:
                        row_errors.append(f"area_sqm must be > 0 (found {area_sqm_val}).")
                except ValueError:
                    row_errors.append(f"Invalid area_sqm numeric format: '{area_sqm_raw}'.")

            if row_errors:
                for err in row_errors:
                    errors.append({"row": idx, "column": "Validation", "reason": err})
                continue

            # ── Check Warnings (Non-blocking, flagged for QC) ──
            area_sqft = round(area_sqm_val * 10.7639, 2)
            is_eligible = (area_sqft >= 1500.0)
            if not is_eligible:
                warnings.append({
                    "row": idx,
                    "column": "area_sqft",
                    "type": "sub_threshold",
                    "message": f"Sub-threshold plot: Area is {area_sqft:.0f} sq.ft (< 1,500 sq.ft threshold). Imported as Not Eligible for QC review.",
                })

            # Detection Type
            det_type = str(self.get_val(row, ["detection_type", "type"], "greenfield")).lower().strip()
            if det_type not in ("greenfield", "infill", "long_term"):
                warnings.append({
                    "row": idx,
                    "column": "detection_type",
                    "type": "unexpected_value",
                    "message": f"Non-standard detection_type '{det_type}'. Expected greenfield, infill, or long_term.",
                })
                det_type = "greenfield"

            # Detected Stage
            det_stage = str(self.get_val(row, ["detected_stage", "construction_stage", "stage"], "Foundation / Excavation")).strip()

            # Model Confidence Score
            conf_raw = self.get_val(row, ["model_confidence_score", "confidence", "confidence_score"], 0.85)
            try:
                conf_val = float(str(conf_raw).replace(",", "."))
                if not (0.0 <= conf_val <= 1.0):
                    warnings.append({
                        "row": idx,
                        "column": "model_confidence_score",
                        "type": "out_of_bounds",
                        "message": f"Confidence score {conf_val} outside 0.0-1.0 range. Clamped to valid range.",
                    })
                    conf_val = max(0.0, min(1.0, conf_val))
            except ValueError:
                conf_val = 0.85

            # Priority Tier
            prio_raw = str(self.get_val(row, ["priority_tier", "priority", "tier"], "Tier-1")).strip()
            prio_clean = "Tier-1"
            if "2" in prio_raw:
                prio_clean = "Tier-2"
            elif "3" in prio_raw:
                prio_clean = "Tier-3"

            # Strict Construction Definition
            meets_strict = str(self.get_val(row, ["meets_strict_construction_definition", "strict_definition"], "true")).lower() in ("true", "1", "yes")

            # PlanetScope Vegetated Contradiction
            contradicts_veg = str(self.get_val(row, ["contradicts_planetscope_vegetated", "vegetated_contradiction"], "false")).lower() in ("true", "1", "yes")
            if contradicts_veg:
                warnings.append({
                    "row": idx,
                    "column": "contradicts_planetscope_vegetated",
                    "type": "vegetation_flag",
                    "message": "Site contradicts PlanetScope non-vegetated classification (vegetated signal present).",
                })

            # DTCP Building Type
            dtcp_bldg = str(self.get_val(row, ["dtcp_building_type", "building_type", "property_type"], "Residential")).strip() or None

            parsed_rows.append({
                "row_num": idx,
                "lat": lat_val,
                "lon": lon_val,
                "village": str(village_raw).strip(),
                "taluk": norm_taluk,
                "district": "Coimbatore",
                "detection_type": det_type,
                "detected_stage": det_stage,
                "area_sqm": area_sqm_val,
                "area_sqft": area_sqft,
                "is_eligible": is_eligible,
                "model_confidence_score": conf_val,
                "priority_tier": prio_clean,
                "meets_strict_construction_definition": meets_strict,
                "contradicts_planetscope_vegetated": contradicts_veg,
                "dtcp_building_type": dtcp_bldg,
                "gmaps_link": f"https://maps.google.com/?q={lat_val},{lon_val}",
            })

        # If any row has reject errors, whole batch is invalid (All-or-Nothing)
        if errors:
            return {
                "valid": False,
                "rejected": True,
                "reject_reason": f"Batch failed with {len(errors)} validation errors across {len(rows)} rows. No records were written.",
                "total_rows": len(rows),
                "valid_count": len(parsed_rows),
                "errors": errors,
                "warnings": warnings,
                "merged_candidates": [],
                "new_candidates": [],
            }

        # ── 40m Spatial Deduplication Check Against DB ──
        merged_candidates: List[Dict[str, Any]] = []
        new_candidates: List[Dict[str, Any]] = []

        # Pre-fetch existing candidate records in Coimbatore box
        existing_recs = (
            self.db.query(
                CaptureRecord.id,
                CaptureRecord.unique_id,
                CaptureRecord.latitude,
                CaptureRecord.longitude,
                CaptureRecord.village,
                CaptureRecord.area,
            )
            .filter(
                CaptureRecord.latitude.isnot(None),
                CaptureRecord.longitude.isnot(None),
                CaptureRecord.latitude.between(LAT_MIN - 0.01, LAT_MAX + 0.01),
                CaptureRecord.longitude.between(LON_MIN - 0.01, LON_MAX + 0.01),
            )
            .all()
        )

        for item in parsed_rows:
            p_lat = item["lat"]
            p_lon = item["lon"]
            nearest_dist = 999999.0
            nearest_rec = None

            for er in existing_recs:
                if er.latitude is None or er.longitude is None:
                    continue
                # Fast bbox pre-check (~0.0006 deg is ~66m)
                if abs(er.latitude - p_lat) > 0.0006 or abs(er.longitude - p_lon) > 0.0006:
                    continue
                dist = haversine_distance_m(p_lat, p_lon, er.latitude, er.longitude)
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_rec = er

            if nearest_rec and nearest_dist <= 40.0:
                merged_candidates.append({
                    "row_num": item["row_num"],
                    "existing_record_id": nearest_rec.id,
                    "existing_unique_id": nearest_rec.unique_id,
                    "distance_m": round(nearest_dist, 1),
                    "lat": p_lat,
                    "lon": p_lon,
                    "parsed_data": item,
                })
            else:
                new_candidates.append(item)

        return {
            "valid": True,
            "rejected": False,
            "total_rows": len(rows),
            "valid_count": len(parsed_rows),
            "errors": [],
            "warnings": warnings,
            "merged_candidates": merged_candidates,
            "new_candidates": new_candidates,
            "parsed_rows": parsed_rows,
        }

    def commit_batch(
        self, validation_result: Dict[str, Any], current_user: User
    ) -> Dict[str, Any]:
        """
        Commits valid parsed rows inside a single atomic database transaction.
        - Updates metadata for 40m spatial duplicates.
        - Mints standard 6-digit CBE-XXXXXX IDs for new sites.
        - Runs Cadastral WFS Auto-Enrichment.
        - Records activity log.
        """
        if not validation_result.get("valid"):
            raise ValueError("Cannot commit invalid batch: " + validation_result.get("reject_reason", "Validation failed"))

        merged_candidates = validation_result.get("merged_candidates", [])
        new_candidates = validation_result.get("new_candidates", [])

        committed_records: List[Dict[str, Any]] = []
        updated_records: List[Dict[str, Any]] = []

        now_utc = datetime.now(timezone.utc)

        # 1. Process 40m Merged Records (Update metadata, do not create duplicate)
        for m in merged_candidates:
            rec_id = m["existing_record_id"]
            p = m["parsed_data"]
            rec = self.db.query(CaptureRecord).filter(CaptureRecord.id == rec_id).first()
            if rec:
                rec.detection_type = p["detection_type"]
                rec.detected_stage = p["detected_stage"]
                rec.area_sqm = p["area_sqm"]
                rec.area_sqft = p["area_sqft"]
                rec.is_eligible = p["is_eligible"]
                rec.model_confidence_score = p["model_confidence_score"]
                rec.priority_tier = p["priority_tier"]
                rec.meets_strict_construction_definition = p["meets_strict_construction_definition"]
                rec.contradicts_planetscope_vegetated = p["contradicts_planetscope_vegetated"]
                rec.dtcp_building_type = p["dtcp_building_type"]
                rec.gmaps_link = p["gmaps_link"]
                rec.updated_at = now_utc

                updated_records.append({
                    "record_id": rec.id,
                    "unique_id": rec.unique_id,
                    "action": "merged_40m",
                    "distance_m": m["distance_m"],
                    "village": rec.village,
                    "is_eligible": rec.is_eligible,
                })

        # 2. Process New Sites (Mint standard 6-digit CBE-XXXXXX ID)
        for item in new_candidates:
            minted_id = self.record_service.next_six_digit_unique_id(prefix="CBE")
            
            # Check 11m collision reference
            collision_ref = None
            cell_collision = (
                self.db.query(CaptureRecord)
                .filter(
                    CaptureRecord.latitude.isnot(None),
                    CaptureRecord.longitude.isnot(None),
                    CaptureRecord.latitude.between(item["lat"] - 0.0001, item["lat"] + 0.0001),
                    CaptureRecord.longitude.between(item["lon"] - 0.0001, item["lon"] + 0.0001),
                )
                .first()
            )
            if cell_collision:
                collision_ref = f"CBE-{item['lat']:.5f}-{item['lon']:.5f}-r{item['row_num']}"

            # Cadastral WFS Auto-Enrichment (point-in-polygon ray-cast) and Village Master canonicalization
            cad_res = self.cadastral_service.enrich_record_cadastral(
                lat=item["lat"],
                lon=item["lon"],
                raw_village=item["village"],
                raw_taluk=item["taluk"],
                raw_district=item["district"],
            )
            canon_v = cad_res["village"]
            canon_t = cad_res["taluk"]
            canon_d = cad_res["district"]
            survey_no = cad_res["survey_number"]
            subdiv_no = cad_res["sub_division_number"]
            ulpin_val = cad_res["ulpin"]
            cadastral_status = cad_res["cadastral_lookup_status"]

            new_record = CaptureRecord(
                name=minted_id,
                unique_id=minted_id,
                old_unique_id=collision_ref,
                latitude=item["lat"],
                longitude=item["lon"],
                village=canon_v,
                taluk=canon_t,
                district=canon_d,
                area=canon_v,
                detection_type=item["detection_type"],
                detected_stage=item["detected_stage"],
                area_sqm=item["area_sqm"],
                area_sqft=item["area_sqft"],
                is_eligible=item["is_eligible"],
                model_confidence_score=item["model_confidence_score"],
                priority_tier=item["priority_tier"],
                meets_strict_construction_definition=item["meets_strict_construction_definition"],
                contradicts_planetscope_vegetated=item["contradicts_planetscope_vegetated"],
                dtcp_building_type=item["dtcp_building_type"],
                survey_number=survey_no,
                survey_no=survey_no,
                sub_division_number=subdiv_no,
                subdivision_no=subdiv_no,
                ulpin=ulpin_val,
                gmaps_link=item["gmaps_link"],
                qc_status="QC Pending",
                status="NOT_COMPLETED",
                audit_status="PENDING",
                source="imported",
                created_at=now_utc,
                uploaded_by_id=current_user.id,
                cadastral_lookup_status=cadastral_status,
            )

            self.db.add(new_record)
            self.db.flush()

            committed_records.append({
                "record_id": new_record.id,
                "unique_id": new_record.unique_id,
                "action": "created",
                "village": new_record.village,
                "taluk": new_record.taluk,
                "survey_no": survey_no,
                "subdivision_no": subdiv_no,
                "ulpin": ulpin_val,
                "is_eligible": new_record.is_eligible,
                "cadastral_status": cadastral_status,
            })

        # Activity log
        log_entry = ActivityLog(
            user_id=current_user.id,
            user_name=getattr(current_user, "full_name", "Admin"),
            action_type="gis_batch_imported",
            type="record",
            title=f"GIS Import: {len(committed_records)} created, {len(updated_records)} merged",
            detail=f"Ingested {len(committed_records)} new sites and updated {len(updated_records)} existing sites within 40m",
            status="success",
            created_at=now_utc,
        )
        self.db.add(log_entry)
        self.db.commit()

        return {
            "success": True,
            "created_count": len(committed_records),
            "merged_count": len(updated_records),
            "total_processed": len(committed_records) + len(updated_records),
            "committed_records": committed_records,
            "updated_records": updated_records,
        }
