"""
Cadastral Auto-Enrichment Service for Kuri Lead Management.

Integrates:
1. TNGIS WFS GeoServer (cadastral_analysis:fmb_ulpin) for ray-casting point-in-polygon parcel resolution
   (survey_number, sub_division_number, ulpin).
2. Tamil Nadu Revenue Master (Village Master.xlsx) for canonicalization of Revenue Village and Taluk.
"""

import logging
from typing import Any, Dict, Optional, Tuple
from app.services.tngis_wfs_service import get_tngis_wfs_service
from app.services.village_master_service import get_village_master_service, stem

logger = logging.getLogger(__name__)

COIMBATORE_TALUKS = {
    "coimbatore north",
    "coimbatore south",
    "pollachi",
    "sulur",
    "mettupalayam",
    "annur",
    "kinathukadavu",
    "valparai",
    "madukkarai",
    "perur",
    "anaimalai",
}


def normalize_taluk_name(raw_taluk: Optional[str]) -> Optional[str]:
    """Normalize input taluk into official Coimbatore revenue taluk string."""
    if not raw_taluk:
        return None
    cleaned = raw_taluk.strip()
    c_lower = cleaned.lower()
    
    # Common mappings and synonyms
    if "north" in c_lower and "coimbatore" in c_lower:
        return "Coimbatore North"
    if "south" in c_lower and "coimbatore" in c_lower:
        return "Coimbatore South"
    if c_lower in ("coimbatore", "cbe"):
        return "Coimbatore North"
    if "pollachi" in c_lower:
        return "Pollachi"
    if "sulur" in c_lower:
        return "Sulur"
    if "mettupalayam" in c_lower or "mtp" in c_lower:
        return "Mettupalayam"
    if "annur" in c_lower:
        return "Annur"
    if "kinathukadavu" in c_lower or "kinathukadav" in c_lower:
        return "Kinathukadavu"
    if "valparai" in c_lower:
        return "Valparai"
    if "madukkarai" in c_lower:
        return "Madukkarai"
    if "perur" in c_lower:
        return "Perur"
    if "anaimalai" in c_lower:
        return "Anaimalai"
        
    return cleaned.title()


class CadastralEnrichmentService:
    def __init__(self):
        self.wfs_service = get_tngis_wfs_service()
        self.vms_service = get_village_master_service()

    def canonicalize_village_and_taluk(
        self,
        village: Optional[str],
        taluk: Optional[str],
        district: Optional[str] = "Coimbatore",
        lat: Optional[float] = None,
        lon: Optional[float] = None,
    ) -> Tuple[str, str, str]:
        """
        Cross-reference raw inputs against Tamil Nadu Revenue Master (Village Master.xlsx).
        Returns normalized (village, taluk, district).
        """
        norm_taluk = normalize_taluk_name(taluk) or "Coimbatore North"
        norm_dist = (district or "Coimbatore").strip().title()
        norm_village = (village or "").strip()

        # Try exact lookup in Village Master
        if norm_village:
            match = self.vms_service.lookup_village_by_name(norm_village)
            if match:
                canon_v = match.get("village") or norm_village
                canon_t = match.get("taluk") or norm_taluk
                canon_d = match.get("district") or norm_dist
                return canon_v, canon_t, canon_d

        # If coordinates provided, attempt spatial reverse match
        if lat and lon:
            loc = self.vms_service.resolve_record_location(
                coordinates=f"{lat}, {lon}",
                village=norm_village,
                taluk=norm_taluk,
                district=norm_dist,
            )
            if loc.get("village"):
                return loc["village"], loc.get("taluk") or norm_taluk, loc.get("district") or norm_dist

        return norm_village or "Coimbatore", norm_taluk, norm_dist

    def enrich_record_cadastral(
        self,
        lat: float,
        lon: float,
        raw_village: Optional[str] = None,
        raw_taluk: Optional[str] = None,
        raw_district: Optional[str] = "Coimbatore",
    ) -> Dict[str, Any]:
        """
        Query TNGIS WFS layer cadastral_analysis:fmb_ulpin via ray-casting.
        If WFS fails or times out, catches exception, flags cadastral_lookup_pending,
        and proceeds without failing the batch.
        """
        canon_v, canon_t, canon_d = self.canonicalize_village_and_taluk(
            village=raw_village,
            taluk=raw_taluk,
            district=raw_district,
            lat=lat,
            lon=lon,
        )

        survey_number: Optional[str] = None
        sub_division_number: Optional[str] = None
        ulpin: Optional[str] = None
        cadastral_status = "resolved"

        try:
            wfs_res = self.wfs_service.resolve_coordinates(lat, lon)
            if wfs_res:
                survey_number = wfs_res.get("survey_no") or None
                sub_division_number = wfs_res.get("subdivision_no") or None
                ulpin = wfs_res.get("ulpin") or None

                # If WFS returned revenue village, canonicalize further
                if wfs_res.get("village") and not raw_village:
                    canon_v = wfs_res["village"]
                if wfs_res.get("taluk") and not raw_taluk:
                    canon_t = normalize_taluk_name(wfs_res["taluk"]) or canon_t

                if not survey_number and not ulpin:
                    cadastral_status = "no_parcel"
            else:
                cadastral_status = "no_parcel"

        except Exception as exc:
            logger.warning("TNGIS WFS lookup failed for point (%s, %s): %s. Flagging cadastral_lookup_pending.", lat, lon, exc)
            cadastral_status = "cadastral_lookup_pending"

        gmaps_link = f"https://maps.google.com/?q={lat:.6f},{lon:.6f}"

        return {
            "survey_number": survey_number,
            "sub_division_number": sub_division_number,
            "ulpin": ulpin,
            "village": canon_v,
            "taluk": canon_t,
            "district": canon_d,
            "cadastral_lookup_status": cadastral_status,
            "gmaps_link": gmaps_link,
        }


_cadastral_service = CadastralEnrichmentService()

def get_cadastral_enrichment_service() -> CadastralEnrichmentService:
    return _cadastral_service
