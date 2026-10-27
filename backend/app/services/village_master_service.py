"""
Village Master Service for automatic resolution and backfilling of
empty Village, Taluk, and District fields during record import.

Uses 'Village Master.xlsx' (17,190+ Tamil Nadu revenue villages) combined with
reverse geocoding and phonetic matching.
"""

import os
import re
import logging
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path
import openpyxl
import requests

from app.core.config import get_settings

logger = logging.getLogger("village_master")
settings = get_settings()

CORP_NORTH = {
    'vname': 'Coimbatore Corporation North Part',
    'tname': 'Coimbatore (N)',
    'dname': 'Coimbatore',
}
CORP_SOUTH = {
    'vname': 'Coimbatore Corporation South Part',
    'tname': 'Coimbatore (S)',
    'dname': 'Coimbatore',
}

# Sublocalities inside Coimbatore Corporation South
CORP_SOUTH_AREAS = [
    'singanallur', 'neelikonampalayam', 'ondipudur', 'ramanathapuram',
    'sihs', 'sowdeswari', 'nethaji', 'jantha', 'arb', 'surya',
    'chinthamani', 'udayampalayam', 'krishna', 'puliyakulam', 'sowripalayam',
    'varadharajapuram', 'sungam'
]

# Sublocalities inside Coimbatore Corporation North
CORP_NORTH_AREAS = [
    'ganapathi', 'ganapathy', 'koundampalayam', 'kavundam', 'rathinapuri',
    'tatabad', 'avarampalayam', 'kkpudur', 'kuppakonam', 'tvs', 'pmrnagar',
    'peelamedu', 'maniyakarampalayam', 'gandhipuram', 'ramnagar', 'hudco'
]

# Specific priority revenue villages in Coimbatore
PRIORITY_REVENUE_STEMS = [
    'vilankurici', 'irugur', 'nilambur', 'kalapati', 'saravanampati',
    'kurici', 'kadavali', 'sulur', 'vedapati', 'perur', 'thudiyalur',
    'veerapandi', 'chinnavedampati', 'vellakinar', 'somayampalayam'
]


def stem(s: str) -> str:
    """Normalize Tamil place names for phonetic comparison."""
    s = str(s or "").lower()
    s = re.sub(r'\s*\([^)]*\)', '', s)
    s = re.sub(r'[^a-zA-Z]', '', s)
    s = s.replace('ll', 'l').replace('ee', 'i').replace('oo', 'u')
    s = s.replace('chch', 'c').replace('cch', 'c').replace('ch', 'c')
    s = s.replace('y', 'i')
    s = s.replace('th', 't')
    s = s.replace('dh', 'd')
    s = s.replace('bh', 'b')
    if s.startswith('e'):
        s = 'i' + s[1:]
    return s


class VillageMasterService:
    _instance: Optional['VillageMasterService'] = None

    def __init__(self):
        self.master_list: List[Dict[str, str]] = []
        self.master_by_stem: Dict[str, List[Dict[str, str]]] = {}
        self.master_by_name: Dict[str, List[Dict[str, str]]] = {}
        self.coimbatore_villages: List[Dict[str, str]] = []
        self._geocode_cache: Dict[Tuple[float, float], Tuple[List[str], List[str]]] = {}
        self._http_session = requests.Session()
        self._loaded = False
        self._load_master()

    @classmethod
    def get_instance(cls) -> 'VillageMasterService':
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _locate_master_file(self) -> Optional[Path]:
        """Locate the Village Master.xlsx file across known search paths."""
        candidates = [
            Path(__file__).parent.parent / "data" / "Village Master.xlsx",
            Path("backend/app/data/Village Master.xlsx"),
            Path("app/data/Village Master.xlsx"),
            Path("Village Master.xlsx"),
            Path(r"D:\My workspace\TN scraping\Village Master.xlsx"),
            Path(r"D:\My workspace\Camera App\backend\app\data\Village Master.xlsx"),
        ]
        for c in candidates:
            if c.exists():
                return c.resolve()
        return None

    def _load_master(self):
        """Load and index all records from Village Master.xlsx."""
        if self._loaded:
            return

        path = self._locate_master_file()
        if not path or not path.exists():
            logger.warning("Village Master.xlsx not found. Village auto-resolution will use geocoding fallbacks.")
            return

        try:
            logger.info("Loading Village Master from %s...", path)
            wb = openpyxl.load_workbook(str(path), read_only=True)
            ws = wb.active
            if not ws:
                return

            rows = ws.iter_rows(values_only=True)
            # Skip header if present
            first_row = next(rows, None)
            if first_row and str(first_row[0] or "").lower() in ("vname", "village", "village_name"):
                pass  # header skipped
            elif first_row:
                self._index_row(first_row)

            for row in rows:
                self._index_row(row)

            self._loaded = True
            logger.info(
                "Village Master loaded: %d total villages indexed (%d Coimbatore revenue villages).",
                len(self.master_list),
                len(self.coimbatore_villages),
            )
        except Exception as e:
            logger.error("Failed to load Village Master.xlsx: %s", e)

    def _index_row(self, row: tuple):
        if not row or len(row) < 3:
            return
        v, t, d = row[0], row[1], row[2]
        if not v or not d:
            return

        v_orig = str(v).strip()
        v_base = re.sub(r'\s*\([^)]*\)', '', v_orig).rstrip('.').strip()
        t_name = str(t).strip() if t else ''
        d_name = str(d).strip() if d else ''

        # Skip rural Singanallur in Anaimalai (urban Singanallur is in Coimbatore South)
        if 'singanallur' in v_base.lower() and 'anaimalai' in t_name.lower():
            return

        entry = {
            'vname': v_base,
            'orig_vname': v_orig,
            'tname': t_name,
            'dname': d_name,
            'stem': stem(v_base),
            'vname_lower': v_base.lower(),
        }

        self.master_list.append(entry)

        st = entry['stem']
        if st not in self.master_by_stem:
            self.master_by_stem[st] = []
        self.master_by_stem[st].append(entry)

        nl = entry['vname_lower']
        if nl not in self.master_by_name:
            self.master_by_name[nl] = []
        self.master_by_name[nl].append(entry)

        if 'coimbatore' in d_name.lower():
            self.coimbatore_villages.append(entry)

    def reverse_geocode(self, lat: float, lng: float) -> Tuple[List[str], List[str]]:
        """
        Reverse geocode GPS coordinates using Google Maps Geocoding API.
        Returns (address_components, formatted_addresses).
        Caches in memory to avoid duplicate requests.
        """
        key = (round(lat, 5), round(lng, 5))
        if key in self._geocode_cache:
            return self._geocode_cache[key]

        api_key = settings.GOOGLE_GEOCODING_API_KEY
        if not api_key:
            return [], []

        url = f"https://maps.googleapis.com/maps/api/geocode/json?latlng={lat},{lng}&key={api_key}"
        try:
            resp = self._http_session.get(url, timeout=10).json()
            components: List[str] = []
            formatted_addresses: List[str] = []

            for res in resp.get('results', []):
                fa = res.get('formatted_address', '')
                if fa and fa not in formatted_addresses:
                    formatted_addresses.append(fa)
                for comp in res.get('address_components', []):
                    types = comp.get('types', [])
                    ln = comp.get('long_name', '')
                    if 'country' in types or 'administrative_area_level_1' in types or 'postal_code' in types:
                        continue
                    if ln and ln not in components:
                        components.append(ln)

            result = (components, formatted_addresses)
            self._geocode_cache[key] = result
            return result
        except Exception as e:
            logger.warning("Geocoding failed for %s,%s: %s", lat, lng, e)
            return [], []

    def match_location_from_components(
        self,
        components: List[str],
        formatted_addresses: List[str],
    ) -> Dict[str, str]:
        """
        Match geocoded components + formatted addresses against Village Master entries.
        """
        full_text = " ".join(formatted_addresses + components)
        clean_full = re.sub(r'[^a-zA-Z0-9]', '', full_text).lower()

        comp_stems = [
            stem(c) for c in components
            if len(stem(c)) >= 4 and stem(c) not in ['coimbatore', 'tamilnadu', 'india']
        ]

        # 1. Chennai special case
        if 'chennai' in clean_full and any(x in clean_full for x in ['purasawalkam', 'purasai', 'egmore', 't-nagar']):
            return {
                'vname': 'Purasaivakam',
                'tname': 'Purasawalkam',
                'dname': 'Chennai',
            }

        # 2. Check priority revenue villages in Coimbatore
        for m in self.coimbatore_villages:
            mst = m['stem']
            if mst in PRIORITY_REVENUE_STEMS:
                for cs in comp_stems:
                    if cs == mst:
                        return {
                            'vname': m['vname'],
                            'tname': m['tname'],
                            'dname': m['dname'],
                        }

        # 3. Podanur / Kurichi -> Madukkarai
        if any(x in clean_full for x in ['podanur', 'pothanur', 'madukkarai', 'kurichi', 'kurichchi', 'kurichy']):
            return {
                'vname': 'Kurichy',
                'tname': 'Madukkarai',
                'dname': 'Coimbatore',
            }

        # 4. Coimbatore Corporation North areas
        if any(x in clean_full for x in CORP_NORTH_AREAS):
            # Check if any specific village name inside Corp North matches
            for m in self.coimbatore_villages:
                if 'north' in m['tname'].lower() and m['stem'] in comp_stems:
                    return {'vname': m['vname'], 'tname': m['tname'], 'dname': m['dname']}
            return CORP_NORTH

        # 5. Coimbatore Corporation South areas
        if any(x in clean_full for x in CORP_SOUTH_AREAS):
            # Check if any specific village name inside Corp South matches
            for m in self.coimbatore_villages:
                if 'south' in m['tname'].lower() and m['stem'] in comp_stems:
                    return {'vname': m['vname'], 'tname': m['tname'], 'dname': m['dname']}
            return CORP_SOUTH

        # 6. Check all Coimbatore villages
        for m in self.coimbatore_villages:
            if m['stem'] in comp_stems:
                return {
                    'vname': m['vname'],
                    'tname': m['tname'],
                    'dname': m['dname'],
                }

        # 7. Check all other Tamil Nadu villages in master
        for cs in comp_stems:
            entries = self.master_by_stem.get(cs)
            if entries:
                best = entries[0]
                return {
                    'vname': best['vname'],
                    'tname': best['tname'],
                    'dname': best['dname'],
                }

        # 8. Fallback from Google Maps administrative area components
        if 'coimbatoresouth' in clean_full:
            return CORP_SOUTH
        if 'coimbatorenorth' in clean_full:
            return CORP_NORTH
        if 'coimbatore' in clean_full:
            return CORP_SOUTH

        # Default fallback if Coimbatore bounds
        return CORP_SOUTH

    def lookup_village_by_name(self, name: str) -> Optional[Dict[str, str]]:
        """Direct lookup of village name against master sheet."""
        if not name or not name.strip():
            return None

        clean = re.sub(r'\s*\([^)]*\)', '', str(name)).rstrip('.').strip().lower()
        if clean in self.master_by_name:
            entries = self.master_by_name[clean]
            # Prioritize Coimbatore if multiple matches
            for e in entries:
                if 'coimbatore' in e['dname'].lower():
                    return e
            return entries[0]

        st = stem(clean)
        if st in self.master_by_stem:
            entries = self.master_by_stem[st]
            for e in entries:
                if 'coimbatore' in e['dname'].lower():
                    return e
            return entries[0]

        return None

    def resolve_record_location(
        self,
        village: Optional[str] = None,
        taluk: Optional[str] = None,
        district: Optional[str] = None,
        coordinates: Optional[str] = None,
        site_address: Optional[str] = None,
        street_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for resolving empty Village, Taluk, or District.

        Returns:
            {
                "village": str,
                "taluk": str,
                "district": str,
                "resolved": bool,
                "method": str,
                "formatted_address": Optional[str]
            }
        """
        v = (village or "").strip()
        t = (taluk or "").strip()
        d = (district or "").strip()
        coords = (coordinates or "").strip()
        site = (site_address or "").strip()
        street = (street_address or "").strip()

        # If all 3 are already filled, no resolution needed
        if v and t and d:
            return {
                "village": v,
                "taluk": t,
                "district": d,
                "resolved": False,
                "method": "already_complete",
                "formatted_address": None,
            }

        best_addr = None

        # Case 1: Village is present, but Taluk or District is missing
        if v:
            matched = self.lookup_village_by_name(v)
            if matched:
                return {
                    "village": v,
                    "taluk": t or matched["tname"],
                    "district": d or matched["dname"],
                    "resolved": True,
                    "method": "master_village_lookup",
                    "formatted_address": None,
                }

        # Case 2: Coordinates are present — use Google reverse geocoding + Master match
        if coords and "," in coords:
            parts = [p.strip() for p in coords.split(",")[:2]]
            try:
                lat = float(parts[0])
                lng = float(parts[1])
                if -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0):
                    components, addresses = self.reverse_geocode(lat, lng)
                    if addresses:
                        best_addr = addresses[0]

                    if components or addresses:
                        matched = self.match_location_from_components(components, addresses)
                        if matched:
                            return {
                                "village": v or matched["vname"],
                                "taluk": t or matched["tname"],
                                "district": d or matched["dname"],
                                "resolved": True,
                                "method": "geocoded_master_match",
                                "formatted_address": best_addr,
                            }
            except (ValueError, TypeError):
                pass

        # Case 3: Scan address text (site_address or street_address) for village name in master
        addr_text = f"{site} {street}".strip()
        if addr_text:
            clean_addr = re.sub(r'[^a-zA-Z0-9\s]', ' ', addr_text).lower()
            tokens = [t.strip() for t in clean_addr.split() if len(t.strip()) >= 4]

            # Check individual tokens or 2-word n-grams against master
            for token in tokens:
                matched = self.lookup_village_by_name(token)
                if matched:
                    return {
                        "village": v or matched["vname"],
                        "taluk": t or matched["tname"],
                        "district": d or matched["dname"],
                        "resolved": True,
                        "method": "address_token_master_match",
                        "formatted_address": best_addr,
                    }

            # Check Corp areas
            for area in CORP_NORTH_AREAS:
                if area in clean_addr:
                    return {
                        "village": v or CORP_NORTH["vname"],
                        "taluk": t or CORP_NORTH["tname"],
                        "district": d or CORP_NORTH["dname"],
                        "resolved": True,
                        "method": "address_corp_north_match",
                        "formatted_address": best_addr,
                    }
            for area in CORP_SOUTH_AREAS:
                if area in clean_addr:
                    return {
                        "village": v or CORP_SOUTH["vname"],
                        "taluk": t or CORP_SOUTH["tname"],
                        "district": d or CORP_SOUTH["dname"],
                        "resolved": True,
                        "method": "address_corp_south_match",
                        "formatted_address": best_addr,
                    }

        # Case 4: Default fallback if any field is still missing
        return {
            "village": v or (CORP_SOUTH["vname"] if d.lower() == "coimbatore" else (v or "Coimbatore Corporation")),
            "taluk": t or (CORP_SOUTH["tname"] if d.lower() == "coimbatore" else (t or "Coimbatore (S)")),
            "district": d or "Coimbatore",
            "resolved": True,
            "method": "default_fallback",
            "formatted_address": best_addr,
        }


def get_village_master_service() -> VillageMasterService:
    return VillageMasterService.get_instance()
