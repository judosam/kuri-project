import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { locationsApi, usersApi, SERVER_BASE } from '../services/api';
import type { LocationPoint, User } from '../types';
import { CustomSelect, Icon, LoadingPanel, PageShell, formatDateTime, formatRecordNo } from '../components/ui';
import { enName } from '../utils/english';
import { useTopHeader } from '../context/HeaderContext';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { completedMarkerIcon, pendingMarkerIcon, primaryMarkerIcon, targetBlueMarkerIcon } from '../utils/mapPin';

L.Marker.prototype.options.icon = primaryMarkerIcon;

interface StateInfo {
  name: string;
  center: [number, number];
  zoom: number;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

const INDIAN_STATES: StateInfo[] = [
  { name: 'Karnataka', center: [15.3173, 75.7139], zoom: 7, bounds: { minLat: 11.5, maxLat: 18.5, minLng: 74.0, maxLng: 78.6 } },
  { name: 'Tamil Nadu', center: [11.1271, 78.6569], zoom: 7, bounds: { minLat: 8.0, maxLat: 13.6, minLng: 76.2, maxLng: 80.4 } },
  { name: 'Kerala', center: [10.8505, 76.2711], zoom: 7, bounds: { minLat: 8.2, maxLat: 12.8, minLng: 74.8, maxLng: 77.4 } },
  { name: 'Andhra Pradesh', center: [15.9129, 79.7400], zoom: 7, bounds: { minLat: 12.6, maxLat: 19.9, minLng: 76.7, maxLng: 84.8 } },
  { name: 'Telangana', center: [18.1124, 79.0193], zoom: 7, bounds: { minLat: 15.8, maxLat: 19.9, minLng: 77.2, maxLng: 81.8 } },
  { name: 'Maharashtra', center: [19.7515, 75.7139], zoom: 7, bounds: { minLat: 15.6, maxLat: 22.0, minLng: 72.6, maxLng: 80.9 } },
  { name: 'Goa', center: [15.2993, 74.1240], zoom: 9, bounds: { minLat: 14.9, maxLat: 15.8, minLng: 73.6, maxLng: 74.4 } },
  { name: 'Gujarat', center: [22.2587, 71.1924], zoom: 7, bounds: { minLat: 20.0, maxLat: 24.7, minLng: 68.1, maxLng: 74.5 } },
  { name: 'Rajasthan', center: [27.0238, 74.2179], zoom: 6, bounds: { minLat: 23.0, maxLat: 30.2, minLng: 69.5, maxLng: 78.3 } },
  { name: 'Delhi', center: [28.7041, 77.1025], zoom: 10, bounds: { minLat: 28.4, maxLat: 28.9, minLng: 76.8, maxLng: 77.4 } },
  { name: 'Uttar Pradesh', center: [26.8467, 80.9462], zoom: 6, bounds: { minLat: 23.8, maxLat: 30.4, minLng: 77.0, maxLng: 84.6 } },
  { name: 'Madhya Pradesh', center: [22.9734, 78.6569], zoom: 6, bounds: { minLat: 21.0, maxLat: 26.9, minLng: 74.0, maxLng: 82.8 } },
  { name: 'West Bengal', center: [22.9868, 87.8550], zoom: 7, bounds: { minLat: 21.5, maxLat: 27.2, minLng: 85.8, maxLng: 89.8 } },
  { name: 'Bihar', center: [25.0961, 85.3131], zoom: 7, bounds: { minLat: 24.3, maxLat: 27.5, minLng: 83.3, maxLng: 88.3 } },
  { name: 'Odisha', center: [20.9517, 85.0985], zoom: 7, bounds: { minLat: 17.8, maxLat: 22.6, minLng: 81.4, maxLng: 87.5 } },
  { name: 'Punjab', center: [31.1471, 75.3412], zoom: 7, bounds: { minLat: 29.5, maxLat: 32.5, minLng: 73.8, maxLng: 76.9 } },
  { name: 'Haryana', center: [29.0588, 76.0856], zoom: 7, bounds: { minLat: 27.6, maxLat: 30.9, minLng: 74.4, maxLng: 77.6 } },
  { name: 'Assam', center: [26.2006, 92.9376], zoom: 7, bounds: { minLat: 24.1, maxLat: 28.0, minLng: 89.7, maxLng: 96.0 } },
];

/** Fallback view when no pin resolves to a state — the field work is Tamil Nadu-centric. */
const DEFAULT_STATE = INDIAN_STATES.find((s) => s.name === 'Tamil Nadu')!;

function resolveStateFromCoords(lat: number, lng: number): StateInfo | null {
  for (const s of INDIAN_STATES) {
    if (
      lat >= s.bounds.minLat &&
      lat <= s.bounds.maxLat &&
      lng >= s.bounds.minLng &&
      lng <= s.bounds.maxLng
    ) {
      return s;
    }
  }
  return null;
}

function resolveStateFromLocations(locations: LocationPoint[]): StateInfo | null {
  if (!locations.length) return null;

  // 1. Check string mentions in addresses, location_name, district
  const counts = new Map<string, number>();
  for (const loc of locations) {
    const text = `${loc.formatted_address || ''} ${loc.site_address || ''} ${loc.location_name || ''} ${loc.district || ''}`.toLowerCase();
    for (const s of INDIAN_STATES) {
      if (text.includes(s.name.toLowerCase())) {
        counts.set(s.name, (counts.get(s.name) || 0) + 1);
      }
    }
  }

  if (counts.size > 0) {
    let topName = '';
    let maxCount = 0;
    for (const [name, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topName = name;
      }
    }
    const match = INDIAN_STATES.find((s) => s.name === topName);
    if (match) return match;
  }

  // 2. Fallback to average coordinates
  let totalLat = 0;
  let totalLng = 0;
  let validCount = 0;
  for (const loc of locations) {
    if (loc.latitude && loc.longitude) {
      totalLat += loc.latitude;
      totalLng += loc.longitude;
      validCount++;
    }
  }

  if (validCount > 0) {
    const avgLat = totalLat / validCount;
    const avgLng = totalLng / validCount;
    const match = resolveStateFromCoords(avgLat, avgLng);
    if (match) return match;
  }

  return null;
}

type DatePreset = 'thisWeek' | 'thisMonth' | 'allTime' | 'custom';
type BaseLayer = 'streets' | 'satellite' | 'terrain';
type StatusFilter = 'ALL' | 'COMPLETED' | 'NOT_COMPLETED';

const LAYERS: Record<BaseLayer, { label: string; url: string; attribution: string }> = {
  streets: {
    label: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
  terrain: {
    label: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, USGS, NOAA',
  },
};

/** Draft filter state controlled by the Map page (single source of truth). */
interface FilterState {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  recordSearch: string;
  locationSearch: string;
  userSearch: string;
  /** Client-side only — every pin is already in memory, no refetch needed. */
  status: StatusFilter;
}

function hasValidCoords(loc: LocationPoint): boolean {
  return !!(loc.latitude && loc.longitude && loc.latitude !== 0 && loc.longitude !== 0);
}

/** ISO date helpers (local time) for quick date presets. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toApiStart(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}
function toApiEnd(date: string): string | undefined {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}
function startOfThisWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
}
function defaultPreset(p: DatePreset): { dateFrom: string; dateTo: string } {
  const now = new Date();
  if (p === 'thisWeek') {
    return { dateFrom: toISODate(startOfThisWeek()), dateTo: toISODate(now) };
  }
  if (p === 'thisMonth') {
    return { dateFrom: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: toISODate(now) };
  }
  return { dateFrom: '', dateTo: '' };
}
function blankDraft(preset: DatePreset = 'allTime'): FilterState {
  const r = defaultPreset(preset);
  return {
    preset,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    recordSearch: '',
    locationSearch: '',
    userSearch: '',
    status: 'ALL',
  };
}

function FitToLocations({ locations }: { locations: LocationPoint[] }) {
  const map = useMap();
  if (locations.length === 0) return null;
  return (
    <button
      type="button"
      className="map-fit"
      onClick={() => {
        const bounds = L.latLngBounds(
          locations.map((loc) => [loc.latitude, loc.longitude] as [number, number])
        );
        map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15 });
      }}
      title="Zoom to all pins"
    >
      <Icon name="my_location" />
      Fit to pins ({locations.length})
    </button>
  );
}

function MapReady() {
  const map = useMap();
  useEffect(() => {
    const refresh = () => map.invalidateSize(false);
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener('resize', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', refresh);
    };
  }, [map]);
  return null;
}

function FocusTargetLocation({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
      map.setView([lat, lng], 18, { animate: true });
    }
  }, [lat, lng, map]);
  return null;
}

function FocusLatestLocation({
  locations,
  searchActive,
  hasTarget,
}: {
  locations: LocationPoint[];
  searchActive: boolean;
  hasTarget: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (hasTarget || !locations.length) return;
    if (searchActive) {
      if (locations.length === 1) {
        map.setView([locations[0].latitude, locations[0].longitude], 15, { animate: true });
      } else {
        const bounds = L.latLngBounds(
          locations.map((loc) => [loc.latitude, loc.longitude] as [number, number])
        );
        map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15 });
      }
      return;
    }
    const latest = [...locations].sort((a, b) => {
      const at = new Date(a.captured_at || 0).getTime();
      const bt = new Date(b.captured_at || 0).getTime();
      return bt - at;
    })[0];
    if (!latest) return;
    map.setView([latest.latitude, latest.longitude], Math.max(map.getZoom(), 12), { animate: false });
  }, [locations, map, searchActive, hasTarget]);
  return null;
}

function DynamicStateView({ locations }: { locations: LocationPoint[] }) {
  const map = useMap();
  const primaryState = useMemo(() => resolveStateFromLocations(locations), [locations]);

  const [activeState, setActiveState] = useState<StateInfo>(() => {
    return primaryState || DEFAULT_STATE;
  });

  useEffect(() => {
    if (primaryState) {
      setActiveState(primaryState);
    }
  }, [primaryState]);

  useEffect(() => {
    const onMoveEnd = () => {
      const center = map.getCenter();
      const detected = resolveStateFromCoords(center.lat, center.lng);
      if (detected) {
        setActiveState(detected);
      }
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map]);

  const handleClick = () => {
    const pinsInState = locations.filter((loc) => {
      const b = activeState.bounds;
      return (
        loc.latitude >= b.minLat &&
        loc.latitude <= b.maxLat &&
        loc.longitude >= b.minLng &&
        loc.longitude <= b.maxLng
      );
    });

    if (pinsInState.length > 0) {
      const bounds = L.latLngBounds(
        pinsInState.map((loc) => [loc.latitude, loc.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15 });
    } else {
      map.setView(activeState.center, activeState.zoom, { animate: true });
    }
  };

  return (
    <button
      type="button"
      className="map-reset"
      onClick={handleClick}
      title={`Reset to ${activeState.name} view`}
    >
      <Icon name="location_on" />
      {activeState.name}
    </button>
  );
}

const POPUP_IMG_CACHE = new Map<string, string>();

function MapPopupImage({
  recordId,
  imageId,
  alt,
}: {
  recordId: number;
  imageId: number;
  alt?: string;
}) {
  const cacheKey = `${recordId}:${imageId}`;
  const [src, setSrc] = useState<string | null>(() => POPUP_IMG_CACHE.get(cacheKey) || null);
  const [loading, setLoading] = useState(!src);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (POPUP_IMG_CACHE.has(cacheKey)) {
      setSrc(POPUP_IMG_CACHE.get(cacheKey)!);
      setLoading(false);
      return;
    }

    let active = true;
    const token = localStorage.getItem('token');
    const baseEndpoint = `${SERVER_BASE}/api/admin/records/${recordId}/image/${imageId}`;
    const urlWithToken = token ? `${baseEndpoint}?token=${encodeURIComponent(token)}` : baseEndpoint;

    fetch(urlWithToken, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        POPUP_IMG_CACHE.set(cacheKey, objectUrl);
        setSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        if (token && !error) {
          setSrc(urlWithToken);
        } else {
          setError(true);
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, recordId, imageId, error]);

  return (
    <div
      style={{
        width: '100%',
        height: 112,
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 8,
        backgroundColor: '#0f172a',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src && !error ? (
        <img
          src={src}
          alt={alt || 'Capture photo'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setError(true)}
        />
      ) : loading ? (
        <div style={{ color: '#94a3b8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="refresh" size={15} />
          <span>Loading…</span>
        </div>
      ) : (
        <div style={{ color: '#64748b', fontSize: 11, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Icon name="photo_camera" size={22} />
          <span>No image preview</span>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  state,
  onChange,
  onSubmit,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  onSubmit: (state?: FilterState) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [hasFetchedUsers, setHasFetchedUsers] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (hasFetchedUsers) return;
    usersApi
      .list({ page_size: 100 })
      .then((res) => {
        setUsers(res.users || []);
        setHasFetchedUsers(true);
      })
      .catch(() => {});
  }, [hasFetchedUsers]);

  // Debounced auto-search: when typing in recordSearch, locationSearch, or changing user,
  // automatically submit search after 300ms so map updates smoothly without requiring Enter or button click
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      onSubmit(state);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state.recordSearch, state.locationSearch, state.userSearch]);

  const applyPreset = (p: DatePreset) => {
    const next = { ...state, ...defaultPreset(p), preset: p };
    onChange(next);
    onSubmit(next);
  };

  const handleReset = () => {
    const fresh = blankDraft('allTime');
    onChange(fresh);
    onSubmit(fresh);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSubmit(state);
    }
  };

  return (
    <div className="toolbar records-toolbar geospatial-map-toolbar">
      <div className="toolbar-row toolbar-row-main">
        <div className="search-wrap records-search-wrap">
          <Icon name="search" />
          <input
            type="text"
            className="fld fld-soft"
            placeholder="Search record name / #ID…"
            value={state.recordSearch}
            onChange={(e) => onChange({ ...state, recordSearch: e.target.value })}
            onKeyDown={handleKey}
            aria-label="Search records on map"
          />
          {state.recordSearch ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                const next = { ...state, recordSearch: '' };
                onChange(next);
                onSubmit(next);
              }}
              aria-label="Clear search"
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>

        <div className="search-wrap records-search-wrap" style={{ maxWidth: 260 }}>
          <Icon name="location_on" />
          <input
            type="text"
            className="fld fld-soft"
            placeholder="Search place or address…"
            value={state.locationSearch}
            onChange={(e) => onChange({ ...state, locationSearch: e.target.value })}
            onKeyDown={handleKey}
            aria-label="Search by location"
          />
          {state.locationSearch ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                const next = { ...state, locationSearch: '' };
                onChange(next);
                onSubmit(next);
              }}
              aria-label="Clear location search"
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>

        <div className="toolbar-inline-group">
          <div className="field filter-user">
            <span className="field-label">User</span>
            <div style={{ width: 165 }}>
              <CustomSelect
                value={state.userSearch}
                onChange={(val) => {
                  const next = { ...state, userSearch: val };
                  onChange(next);
                  onSubmit(next);
                }}
                options={[
                  { value: '', label: 'All users' },
                  ...users.map((u) => ({
                    value: String(u.id),
                    label: u.full_name || u.email,
                  })),
                ]}
                ariaLabel="Filter by user"
              />
            </div>
          </div>

          <button type="button" className="btn btn-primary btn-sm" onClick={() => onSubmit(state)}>
            <Icon name="filter_alt" />
            Apply
          </button>
          {(state.recordSearch || state.locationSearch || state.userSearch || state.preset !== 'allTime' || state.status !== 'ALL') && (
            <button type="button" className="btn btn-ghost btn-sm records-reset-btn" onClick={handleReset}>
              <Icon name="close" size={14} />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="toolbar-row toolbar-row-sub">
        <div className="field-range">
          <span className="sub-field-label">Quick range:</span>
          <div className="seg" role="group" aria-label="Date preset">
            {(
              [
                ['allTime', 'All time'],
                ['thisWeek', 'This week'],
                ['thisMonth', 'This month'],
              ] as [DatePreset, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`seg-btn ${state.preset === val ? 'active' : ''}`}
                onClick={() => applyPreset(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-range">
          <span className="sub-field-label">Status:</span>
          <div className="seg" role="group" aria-label="Pin status">
            {(
              [
                ['ALL', 'All'],
                ['COMPLETED', 'Completed'],
                ['NOT_COMPLETED', 'Pending Inspection'],
              ] as [StatusFilter, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`seg-btn ${state.status === val ? 'active' : ''}`}
                onClick={() => onChange({ ...state, status: val })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-date-range">
          <div className="field-date-item">
            <span className="sub-field-label">From</span>
            <input
              type="date"
              className="fld fld-date-input"
              value={state.dateFrom}
              onChange={(e) => onChange({ ...state, dateFrom: e.target.value, preset: 'custom' })}
              aria-label="Date from"
            />
          </div>
          <div className="field-date-item">
            <span className="sub-field-label">To</span>
            <input
              type="date"
              className="fld fld-date-input"
              value={state.dateTo}
              onChange={(e) => onChange({ ...state, dateTo: e.target.value, preset: 'custom' })}
              aria-label="Date to"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetLat = searchParams.get('lat') ? parseFloat(searchParams.get('lat')!) : null;
  const targetLng = searchParams.get('lng') ? parseFloat(searchParams.get('lng')!) : null;
  const targetRecordId = searchParams.get('record_id') ? parseInt(searchParams.get('record_id')!, 10) : null;

  const [draft, setDraft] = useState<FilterState>(() => blankDraft('allTime'));
  const [applied, setApplied] = useState<FilterState | null>(null);
  const [locations, setLocations] = useState<LocationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState<BaseLayer>('streets');
  const mapRef = useRef<L.Map | null>(null);

  // Apply a draft: fetch pins for the chosen range. Filters are authoritative;
  // an empty week stays empty instead of silently switching to All time.
  const run = useCallback((draftState: FilterState) => {
    setLoading(true);
    locationsApi
      .list({
        date_from: toApiStart(draftState.dateFrom),
        date_to: toApiEnd(draftState.dateTo),
        record_search: draftState.recordSearch.trim() || undefined,
        location_search: draftState.locationSearch.trim() || undefined,
        user_id: draftState.userSearch ? Number(draftState.userSearch) : undefined,
      })
      .then((locs) => {
        setLocations(locs.filter(hasValidCoords));
        setApplied(draftState);
      })
      .catch(() => {
        setLocations([]);
        setApplied(draftState);
      })
      .finally(() => setLoading(false));
  }, []);

  // Initial load: default current week
  useEffect(() => {
    run(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback((state?: FilterState) => {
    run(state ?? draft);
  }, [draft, run]);

  const validLocations = useMemo(() => {
    let list = locations.filter(
      (loc) => hasValidCoords(loc) && (draft.status === 'ALL' || loc.status === draft.status)
    );
    if (
      targetRecordId &&
      targetLat &&
      targetLng &&
      !list.some((l) => l.record_id === targetRecordId)
    ) {
      list = [
        ...list,
        {
          record_id: targetRecordId,
          latitude: targetLat,
          longitude: targetLng,
          status: 'NOT_COMPLETED',
          captured_at: new Date().toISOString(),
          location_name: `Record #${targetRecordId}`,
        } as any,
      ];
    }
    return list;
  }, [locations, draft.status, targetRecordId, targetLat, targetLng]);
  const isEmpty = !loading && validLocations.length === 0;

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Geospatial Field Map</h1>
        <span className="count-pill">
          {validLocations.length} pin{validLocations.length === 1 ? '' : 's'}
        </span>
      </div>
    ),
    right: (
      <div className="topbar-right-group">
        <div className="seg" role="group" aria-label="Base layer">
          {(Object.keys(LAYERS) as BaseLayer[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`seg-btn ${layer === key ? 'active' : ''}`}
              onClick={() => setLayer(key)}
              title={LAYERS[key].label}
            >
              {LAYERS[key].label}
            </button>
          ))}
        </div>
        <div className="system-status-pill">
          <span className="pulse-dot" />
          <span className="status-label">GPS Verified</span>
        </div>
      </div>
    ),
  }, [validLocations.length, layer]);

  return (
    <PageShell>
      <FilterBar state={draft} onChange={setDraft} onSubmit={handleSubmit} />

      <div className="map-card">
          <MapContainer
            center={
              targetLat && targetLng
                ? [targetLat, targetLng]
                : validLocations.length > 0
                ? [validLocations[0].latitude, validLocations[0].longitude]
                : (resolveStateFromLocations(locations) || DEFAULT_STATE).center
            }
            zoom={
              targetLat && targetLng
                ? 18
                : validLocations.length > 0
                ? 12
                : (resolveStateFromLocations(locations) || DEFAULT_STATE).zoom
            }
            className="admin-map"
            ref={mapRef}
            scrollWheelZoom
            preferCanvas
          >
            <MapReady />
            <TileLayer attribution={LAYERS[layer].attribution} url={LAYERS[layer].url} />
            {validLocations.map((loc) => {
              const isTarget = targetRecordId !== null && loc.record_id === targetRecordId;
              const isCompleted = loc.status === 'COMPLETED';
              const isPending = loc.status === 'NOT_COMPLETED';
              const pinIcon = isTarget
                ? targetBlueMarkerIcon
                : (isCompleted ? completedMarkerIcon : (isPending ? pendingMarkerIcon : primaryMarkerIcon));

              return (
                <Marker
                  key={`${loc.record_id}:${loc.latitude}:${loc.longitude}:${loc.captured_at}`}
                  position={[loc.latitude, loc.longitude]}
                  icon={pinIcon}
                  /* Dispatched tasks often share coordinates with a completed
                     record on the same site — target floats highest, pending next. */
                  zIndexOffset={isTarget ? 2000 : (isPending ? 1000 : 0)}
                  ref={(marker) => {
                    if (marker && isTarget) {
                      marker.openPopup();
                    }
                  }}
                >
                  <Popup>
                    <div className="map-pop">
                      {loc.image_id ? (
                        <MapPopupImage
                          recordId={loc.record_id}
                          imageId={loc.image_id}
                          alt={loc.record_name}
                        />
                      ) : null}
                      <div className="map-pop-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span className="row-id">{loc.unique_id || formatRecordNo(loc.record_id)}</span>
                        {isCompleted ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', flexShrink: 0 }} />
                            Completed
                          </span>
                        ) : isPending ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F97316', flexShrink: 0 }} />
                            Pending Inspection
                          </span>
                        ) : (
                          <span className="mono-sm txt-faint" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(loc.captured_at)}</span>
                        )}
                      </div>

                      <span className="map-pop-name">{loc.record_name}</span>
                      {(enName(loc.location_name) || enName(loc.formatted_address) || loc.site_address) && (
                        <span className="map-pop-loc">
                          <Icon name="location_on" />
                          {loc.site_address || enName(loc.location_name) || enName(loc.formatted_address)}
                        </span>
                      )}
                      {loc.survey_no ? (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          Survey No: <strong>{loc.survey_no}</strong>
                        </div>
                      ) : null}
                      {loc.user_name && (
                        <span className="map-pop-user">
                          <Icon name="person" />
                          {loc.user_name}
                        </span>
                      )}
                      <button
                        type="button"
                        className="map-pop-btn"
                        onClick={() => navigate(`/records/${loc.record_id}`)}
                      >
                        View Record Details
                        <Icon name="arrow_forward" />
                      </button>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {targetLat !== null && targetLng !== null && (
              <FocusTargetLocation lat={targetLat} lng={targetLng} />
            )}
            <FocusLatestLocation
              locations={validLocations}
              searchActive={!!applied?.recordSearch || !!applied?.locationSearch || !!applied?.userSearch}
              hasTarget={targetLat !== null && targetLng !== null}
            />
            <FitToLocations locations={validLocations} />
            <DynamicStateView locations={validLocations} />
          </MapContainer>

          <div className="map-hud" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot" />
              <span>{validLocations.length} verified capture{validLocations.length === 1 ? '' : 's'} · WGS84</span>
            </div>
            <div style={{ width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.25)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 0 2px rgba(34,197,94,0.3)' }} />
                Completed
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F97316', boxShadow: '0 0 0 2px rgba(249,115,22,0.3)' }} />
                Pending Inspection
              </span>
            </div>
          </div>
          {isEmpty && (
            <div className="map-empty-note" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Icon name="pin_drop" size={32} />
              <span>
                {applied?.recordSearch || applied?.locationSearch
                  ? `No captures match "${applied.recordSearch || applied.locationSearch}" in ${applied.preset === 'thisWeek' ? 'the current week' : 'the selected date range'}.`
                  : 'No captures match the selected filters. Try widening the date range.'}
              </span>
              {applied?.preset !== 'allTime' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    const allTimeDraft = { ...draft, ...defaultPreset('allTime'), preset: 'allTime' as DatePreset };
                    setDraft(allTimeDraft);
                    run(allTimeDraft);
                  }}
                >
                  <Icon name="history" />
                  Search Across All Time
                </button>
              )}
            </div>
          )}
          {loading && <div className="map-loading-overlay"><LoadingPanel text="Loading locations…" /></div>}
        </div>
    </PageShell>
  );
}
