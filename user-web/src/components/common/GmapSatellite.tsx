/**
 * Google Maps satellite snapshot for the field verifier.
 *
 * One saved picture per location — downloaded while the sheet was imported, or
 * generated on first view — so the verifier sees exactly what the importer and
 * auditor reviewed. The viewer only magnifies and pans that picture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { parseCoordinates } from '../../utils/geo';
import Icon from './Icon';
import './GmapSatellite.css';

/** Server default; the record's saved zoom wins when it has one. */
const DEFAULT_TILE_ZOOM = 18;
const TILE_SIZE = 256;
const GRID = 3;
const MOSAIC_PX = TILE_SIZE * GRID;

/** Pixel position of a coordinate inside its own 3x3 tile mosaic. */
function markerOffset(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const half = Math.floor(GRID / 2);
  return {
    x: (x - (Math.floor(x) - half)) * TILE_SIZE,
    y: (y - (Math.floor(y) - half)) * TILE_SIZE,
  };
}

export default function GmapSatellite({
  recordId,
  coordinates,
  zoom,
  height = 260,
  label,
}: {
  recordId: number;
  coordinates?: string | null;
  zoom?: number | null;
  height?: number;
  label?: string;
}) {
  const point = parseCoordinates(coordinates);
  const [selectedZoom, setSelectedZoom] = useState<number>(zoom || DEFAULT_TILE_ZOOM);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** Once the verifier moves the picture by hand, a resize must not reset it. */
  const moved = useRef(false);
  const frame = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ w: MOSAIC_PX, h: 0 });

  const imageUrl = point
    ? api.getAuthenticatedImageUrl(`/api/records/${recordId}/gmap-image?zoom=${selectedZoom}`)
    : undefined;

  useEffect(() => {
    setFailed(false);
    moved.current = false;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [recordId, selectedZoom]);

  // Page scroll stays untouched until the viewer is engaged (ctrl+wheel, or an
  // already magnified image), so the card never traps the scroll gesture.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && scale <= 1) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    pinch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    moved.current = true;
    const [a, b] = [e.touches[0], e.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current.distance > 0) {
      setScale(Math.min(6, Math.max(1, Number(((pinch.current.scale * distance) / pinch.current.distance).toFixed(2)))));
    }
  };

  const marker = point ? markerOffset(point[0], point[1], selectedZoom) : null;

  // Track the frame box so the site itself can be centred inside it.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth || MOSAIC_PX, h: el.clientHeight || 0 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  /**
   * Offset that puts the site in the middle of the frame. The canvas starts
   * centred in the frame (negative margins), so the offset is measured from
   * there and is capped at what still covers the frame.
   */
  const centredOffset = useCallback(
    (atScale: number) => {
      if (!marker || !view.h) return { x: 0, y: 0 };
      const clamp = (value: number, frameSize: number) => {
        const limit = Math.max(0, (MOSAIC_PX * atScale - frameSize) / 2);
        return Math.min(limit, Math.max(-limit, value));
      };
      return {
        x: clamp((MOSAIC_PX / 2 - marker.x) * atScale, view.w),
        y: clamp((MOSAIC_PX / 2 - marker.y) * atScale, view.h),
      };
    },
    [marker, view.w, view.h]
  );

  /** Zooming keeps the recorded site itself in the middle of the frame. */
  const zoomBy = useCallback(
    (factor: number) => {
      moved.current = true;
      setScale((current) => {
        const next = Math.min(6, Math.max(1, Number((current * factor).toFixed(2))));
        if (next !== current) setOffset(centredOffset(next));
        return next;
      });
    },
    [centredOffset]
  );

  useEffect(() => {
    if (!imageUrl || failed || moved.current) return;
    setOffset(centredOffset(scale));
  }, [imageUrl, failed, scale, centredOffset]);

  return (
    <div className="gmapsat">
      <div
        className="gmapsat-frame"
        ref={frame}
        style={{ height }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => {
          pinch.current = null;
        }}
        onPointerDown={(e) => {
          if (!imageUrl || failed) return;
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          moved.current = true;
          const limitX = Math.max(0, (MOSAIC_PX * scale - view.w) / 2);
          const limitY = Math.max(0, (MOSAIC_PX * scale - (view.h || height)) / 2);
          const rawX = drag.current.ox + (e.clientX - drag.current.x);
          const rawY = drag.current.oy + (e.clientY - drag.current.y);
          setOffset({
            x: Math.min(limitX, Math.max(-limitX, rawX)),
            y: Math.min(limitY, Math.max(-limitY, rawY)),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => zoomBy(1.6)}
      >
        {imageUrl && !failed ? (
          <div
            className={`gmapsat-canvas ${scale > 1 ? 'is-magnified' : ''}`}
            style={{ width: MOSAIC_PX, height: MOSAIC_PX, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          >
            <img src={imageUrl} alt={label ? `Satellite image of ${label}` : 'Google Maps satellite image'} onError={() => setFailed(true)} draggable={false} />
            {marker && <span className="gmapsat-pin" style={{ left: marker.x, top: marker.y }} />}
          </div>
        ) : (
          <div className="gmapsat-empty">
            <Icon name={point ? 'satellite_alt' : 'location_off'} size={22} />
            <span>
              {!point
                ? 'No coordinates for this site — satellite image unavailable.'
                : 'No satellite image saved yet. It downloads automatically when a sheet is imported.'}
            </span>
          </div>
        )}

        <div className="gmapsat-tools">
          <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
            <Icon name="zoom_in" size={16} />
          </button>
          <span className="gmapsat-scale">{scale.toFixed(1)}×</span>
          <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
            <Icon name="zoom_out" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              moved.current = false;
              setScale(1);
              setOffset(centredOffset(1));
            }}
            aria-label="Reset view"
            title="Reset view"
          >
            <Icon name="restart_alt" size={16} />
          </button>
        </div>
      </div>

      <div className="gmapsat-bar">
        <span className="gmapsat-title">
          <Icon name="satellite_alt" size={13} />
          Satellite view
        </span>
        <div className="gmapsat-zoom-levels" role="group" aria-label="Satellite tile zoom levels">
          {[17, 18, 19, 20].map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`gmapsat-zoom-btn ${selectedZoom === lvl ? 'active' : ''}`}
              onClick={() => {
                moved.current = false;
                setSelectedZoom(lvl);
              }}
              title={`Tile zoom level ${lvl}`}
              aria-label={`Tile zoom level ${lvl}`}
              aria-pressed={selectedZoom === lvl}
            >
              {lvl}
            </button>
          ))}
        </div>
        {imageUrl && !failed && (
          <a className="gmapsat-download" href={imageUrl} download={`Record_${recordId}_Satellite_z${selectedZoom}.jpg`} title="Download this image">
            <Icon name="download" size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
