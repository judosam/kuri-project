/**
 * Google Maps satellite snapshot viewer (admin portal).
 *
 * One snapshot per location — downloaded while its sheet is imported and cached
 * on the server — so the importer, auditor and field views always open on the
 * same saved imagery. The viewer only magnifies and pans that one picture; it
 * never re-downloads a deeper tile level.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../services/api';
import { parseCoordinates } from '../utils/geo';
import { Icon } from './ui';

/** Server default tile zoom; the record's stored zoom wins when it has one. */
const DEFAULT_GMAP_ZOOM = 18;
const TILE_SIZE = 256;
const GRID = 3;
/** Mosaic is drawn at this size, so marker maths below uses the same scale. */
const MOSAIC_PX = TILE_SIZE * GRID;

function deg2num(lat: number, lon: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  return [
    ((lon + 180) / 360) * n,
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  ];
}

/** Pixel position of a coordinate inside its own 3x3 mosaic. */
function markerOffset(lat: number, lon: number, zoom: number): { x: number; y: number } | null {
  const [x, y] = deg2num(lat, lon, zoom);
  const half = Math.floor(GRID / 2);
  return {
    x: (x - (Math.floor(x) - half)) * TILE_SIZE,
    y: (y - (Math.floor(y) - half)) * TILE_SIZE,
  };
}

const AVAILABLE_ZOOMS = [17, 18, 19, 20];

/** Authenticated image blob → object URL. Revoked as soon as it is replaced. */
function useGmapImage(recordId: number, requestedZoom: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [zoom, setZoom] = useState(requestedZoom);
  const seq = useRef(0);

  const load = useCallback(
    async (opts?: { refresh?: boolean; thumb?: boolean; targetZoom?: number }) => {
      const ticket = ++seq.current;
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const z = opts?.targetZoom ?? requestedZoom;
      const queryParams = new URLSearchParams();
      if (z) queryParams.set('zoom', String(z));
      if (opts?.thumb) queryParams.set('thumb', 'true');
      const suffix = queryParams.toString() ? `?${queryParams.toString()}` : '';

      const fetchImage = async (refresh: boolean) => {
        if (refresh) {
          const postParams = new URLSearchParams();
          if (z) postParams.set('zoom', String(z));
          postParams.set('refresh', 'true');
          await fetch(`${API_BASE}/admin/records/${recordId}/gmap-image?${postParams.toString()}`, {
            method: 'POST',
            headers,
          });
        }
        return fetch(`${API_BASE}/admin/records/${recordId}/gmap-image${suffix}`, { headers });
      };

      try {
        let res = await fetchImage(!!opts?.refresh);
        if (res.status === 404 && !opts?.refresh) {
          // Imported before this feature: build the snapshot now, then read it.
          res = await fetchImage(true);
        }
        if (!res.ok) {
          if (ticket === seq.current) {
            setUrl(null);
            setError(res.status === 404 ? 'No satellite image saved for this location yet.' : 'Satellite image unavailable.');
          }
          return;
        }
        const served = Number(res.headers.get('x-gmap-zoom'));
        const blob = await res.blob();
        if (ticket !== seq.current) return;
        if (Number.isFinite(served) && served > 0) setZoom(served);
        else if (z) setZoom(z);

        setUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return URL.createObjectURL(blob);
        });
        setSavedAt(res.headers.get('last-modified') || new Date().toISOString());
      } catch {
        if (ticket === seq.current) {
          setUrl(null);
          setError('Could not load the satellite image.');
        }
      } finally {
        if (ticket === seq.current) setLoading(false);
      }
    },
    [recordId, requestedZoom]
  );

  useEffect(() => {
    void load();
    return () => {
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    };
  }, [load]);

  return { url, loading, error, savedAt, zoom, reload: load };
}

/** The pannable / magnifiable satellite frame with its control overlays. */
export function GmapSatelliteFrame({
  recordId,
  coordinates,
  initialZoom,
  height = 300,
  title,
}: {
  recordId: number;
  coordinates?: string | null;
  initialZoom?: number | null;
  height?: number;
  title?: string;
}) {
  const point = useMemo(() => parseCoordinates(coordinates), [coordinates]);
  const [selectedZoom, setSelectedZoom] = useState<number>(initialZoom || DEFAULT_GMAP_ZOOM);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** Once the viewer is moved by hand, resizing must not yank the picture back. */
  const moved = useRef(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ w: MOSAIC_PX, h: height });
  const { url, loading, error, savedAt, zoom, reload } = useGmapImage(recordId, selectedZoom);

  const marker = useMemo(
    () => (point ? markerOffset(point[0], point[1], zoom) : null),
    [point, zoom]
  );

  // Track the frame box so the site itself can be centred inside it.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || MOSAIC_PX;
      const h = el.clientHeight || height;
      setView((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  /**
   * Offset that puts the site in the middle of the frame. The canvas starts
   * centred in the stage (flex), so the offset is measured from there and is
   * capped at what still covers the frame — no empty space at the edges.
   */
  const centredOffset = useCallback(
    (atScale: number) => {
      if (!marker) return { x: 0, y: 0 };
      const clamp = (value: number, frame: number) => {
        const limit = Math.max(0, (MOSAIC_PX * atScale - frame) / 2);
        return Math.min(limit, Math.max(-limit, value));
      };
      return {
        x: clamp((MOSAIC_PX / 2 - marker.x) * atScale, view.w),
        y: clamp((MOSAIC_PX / 2 - marker.y) * atScale, view.h),
      };
    },
    [marker, view.w, view.h]
  );

  // A freshly loaded picture opens on the site at 1x, until the user moves it.
  useEffect(() => {
    if (!url || moved.current) return;
    const next = centredOffset(scale);
    setOffset((prev) => (prev.x === next.x && prev.y === next.y ? prev : next));
  }, [url, scale, centredOffset]);

  /**
   * Magnify. A wheel/pointer origin stays put under the cursor; the plain
   * buttons keep the recorded site itself in the middle of the frame.
   */
  const zoomBy = (factor: number, origin?: { x: number; y: number }) => {
    moved.current = true;
    const next = Math.min(8, Math.max(1, Number((scale * factor).toFixed(2))));
    if (next === scale) return;
    if (!origin) {
      setScale(next);
      setOffset(centredOffset(next));
      return;
    }
    const ratio = next / scale;
    const rawX = origin.x - ratio * (origin.x - offset.x);
    const rawY = origin.y - ratio * (origin.y - offset.y);
    const limitX = Math.max(0, (MOSAIC_PX * next - view.w) / 2);
    const limitY = Math.max(0, (MOSAIC_PX * next - view.h) / 2);
    setOffset({
      x: Math.min(limitX, Math.max(-limitX, rawX)),
      y: Math.min(limitY, Math.max(-limitY, rawY)),
    });
    setScale(next);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, {
      x: e.clientX - box.left - view.w / 2,
      y: e.clientY - box.top - view.h / 2,
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!url) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    moved.current = true;
    const limitX = Math.max(0, (MOSAIC_PX * scale - view.w) / 2);
    const limitY = Math.max(0, (MOSAIC_PX * scale - view.h) / 2);
    const rawX = drag.current.ox + (e.clientX - drag.current.x);
    const rawY = drag.current.oy + (e.clientY - drag.current.y);
    setOffset({
      x: Math.min(limitX, Math.max(-limitX, rawX)),
      y: Math.min(limitY, Math.max(-limitY, rawY)),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="gmap-frame" style={{ height }}>
      <div
        className="gmap-stage"
        ref={stage}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => zoomBy(1.6)}
        style={{ cursor: url ? (drag.current ? 'grabbing' : 'grab') : 'default' }}
      >
        {url ? (
          <div
            className={`gmap-canvas ${scale > 1 ? 'is-magnified' : ''}`}
            style={{ width: MOSAIC_PX, height: MOSAIC_PX, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          >
            <img className="gmap-image" src={url} alt={title || 'Google Maps satellite image'} draggable={false} />
            {marker && <span className="gmap-pin" style={{ left: marker.x, top: marker.y }} title="Recorded coordinates" />}
          </div>
        ) : (
          <div className="gmap-empty">
            <Icon name={loading ? 'refresh' : 'map'} size={22} className={loading ? 'fos-spin' : undefined} />
            <span>{loading ? 'Loading satellite image…' : error || 'No satellite image for this location.'}</span>
            {!loading && <span className="gmap-empty-hint">Coordinates are required, and the server needs access to Google Maps tiles.</span>}
          </div>
        )}
      </div>

      <div className="gmap-tools">
        <button type="button" className="gmap-tool" onClick={() => zoomBy(1.4)} title="Zoom in" aria-label="Zoom in">
          <Icon name="zoom_in" size={16} />
        </button>
        <span className="gmap-scale">{scale.toFixed(1)}×</span>
        <button type="button" className="gmap-tool" onClick={() => zoomBy(1 / 1.4)} title="Zoom out" aria-label="Zoom out">
          <Icon name="zoom_out" size={16} />
        </button>
        <button
          type="button"
          className="gmap-tool"
          onClick={() => {
            moved.current = false;
            setScale(1);
            setOffset(centredOffset(1));
          }}
          title="Reset the view"
          aria-label="Reset the view"
        >
          <Icon name="restart_alt" size={16} />
        </button>
      </div>

      <div className="gmap-bar">
        <span className="gmap-bar-title">
          <Icon name="satellite_alt" size={14} />
          Google Maps satellite
          {savedAt && !loading ? ` · saved ${new Date(savedAt).toLocaleDateString()}` : ''}
        </span>
        <div className="gmap-zoom-levels" role="group" aria-label="Satellite tile zoom levels">
          {AVAILABLE_ZOOMS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`gmap-zoom-btn ${zoom === lvl ? 'active' : ''}`}
              onClick={() => {
                moved.current = false;
                setSelectedZoom(lvl);
              }}
              disabled={loading}
              title={`Tile zoom level ${lvl}`}
              aria-label={`Tile zoom level ${lvl}`}
              aria-pressed={zoom === lvl}
            >
              {lvl}
            </button>
          ))}
        </div>
        <div className="gmap-bar-actions">
          <button
            type="button"
            className="gmap-tool"
            onClick={() => void reload({ refresh: true, targetZoom: selectedZoom })}
            title="Download the tiles again from Google Maps"
            aria-label="Re-download the satellite image"
          >
            <Icon name="refresh" size={15} className={loading ? 'fos-spin' : undefined} />
          </button>
          {url && (
            <a
              className="gmap-tool"
              href={url}
              download={`Record_${recordId}_Satellite_z${zoom}.jpg`}
              title="Download this image"
              aria-label="Download this image"
            >
              <Icon name="download" size={15} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline panel used in record detail / auditor review sections. */
export function GmapSatellitePanel({
  recordId,
  coordinates,
  zoom,
  height = 300,
  title,
}: {
  recordId: number;
  coordinates?: string | null;
  zoom?: number | null;
  height?: number;
  title?: string;
}) {
  return (
    <div className="gmap-panel">
      <GmapSatelliteFrame recordId={recordId} coordinates={coordinates} initialZoom={zoom} height={height} title={title} />
      <span className="gmap-caption">
        Field imagery is saved while the sheet is imported and reused from the cache — the same picture is shown to the
        importer, the auditor and the field verifier.
      </span>
    </div>
  );
}

/** Thumbnails are shared across rows and paging, so keep them in a cache. */
const THUMB_CACHE = new Map<string, string>();

function GmapThumbImage({ recordId }: { recordId: number }) {
  const cacheKey = `thumb:${recordId}`;
  const [src, setSrc] = useState<string | null>(() => THUMB_CACHE.get(cacheKey) || null);

  useEffect(() => {
    if (THUMB_CACHE.has(cacheKey)) {
      setSrc(THUMB_CACHE.get(cacheKey)!);
      return;
    }
    let active = true;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_BASE}/admin/records/${recordId}/gmap-image?thumb=true`, { headers })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        THUMB_CACHE.set(cacheKey, objectUrl);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setSrc(null);
      });
    return () => {
      active = false;
    };
  }, [cacheKey, recordId]);

  return src ? <img src={src} alt="" draggable={false} /> : <span className="gmap-thumb-loading" />;
}

/** Compact table-cell thumbnail: click for the full, zoomable viewer. */
export function GmapSatelliteThumb({
  recordId,
  coordinates,
  zoom,
  size = 46,
  label,
}: {
  recordId: number;
  coordinates?: string | null;
  zoom?: number | null;
  size?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasCoordinates = !!parseCoordinates(coordinates);

  if (!hasCoordinates) {
    return (
      <span className="gmap-thumb-missing" title="No coordinates — satellite image unavailable">
        <Icon name="map" size={15} />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="gmap-thumb"
        style={{ width: size, height: size }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Open the Google Maps satellite image (zoom & pan)"
        aria-label={`Satellite image for ${label || `record ${recordId}`}`}
      >
        <GmapThumbImage recordId={recordId} />
        <span className="gmap-thumb-zoom">
          <Icon name="zoom_in" size={12} />
        </span>
      </button>

      {open && (
        <div className="gmap-modal-backdrop" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="gmap-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gmap-modal-head">
              <span className="gmap-modal-title">
                <Icon name="satellite_alt" size={16} />
                {label ? `Satellite · ${label}` : `Satellite · Record #${recordId}`}
              </span>
              <button type="button" className="gmap-tool" onClick={() => setOpen(false)} title="Close" aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
            <GmapSatelliteFrame recordId={recordId} coordinates={coordinates} initialZoom={zoom} height={460} />
          </div>
        </div>
      )}
    </>
  );
}
