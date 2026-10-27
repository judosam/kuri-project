import { useState, useEffect } from 'react';
import Icon from './Icon';
import { parseCoordinates } from '../../utils/geo';

interface GoogleMapEmbedProps {
  latitude?: number | null;
  longitude?: number | null;
  coordinates?: string | null;
  address?: string | null;
  title?: string;
  height?: number | string;
  zoom?: number;
}

export default function GoogleMapEmbed({
  latitude,
  longitude,
  coordinates,
  address,
  title = 'Site Location Map',
  height = 240,
  zoom = 15,
}: GoogleMapEmbedProps) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [loaded, attempt]);

  let parsedLat = latitude;
  let parsedLng = longitude;

  if ((!parsedLat || !parsedLng) && coordinates) {
    const parsed = parseCoordinates(coordinates);
    if (parsed) {
      parsedLat = parsed[0];
      parsedLng = parsed[1];
    }
  }

  let query = '';
  if (parsedLat !== null && parsedLat !== undefined && parsedLng !== null && parsedLng !== undefined) {
    query = `${parsedLat},${parsedLng}`;
  } else if (address && address.trim()) {
    query = encodeURIComponent(address.trim());
  }

  if (!query) {
    return (
      <div
        style={{
          height: typeof height === 'number' ? `${height}px` : height,
          backgroundColor: '#f8fafc',
          borderRadius: 14,
          border: '1px dashed #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          color: '#94a3b8',
          fontSize: '0.8125rem',
        }}
      >
        <Icon name="map" size={28} color="#cbd5e1" />
        <span>No GPS coordinates or site address for map preview</span>
      </div>
    );
  }

  const embedUrl = `https://maps.google.com/maps?q=${query}&t=&z=${zoom}&ie=UTF8&iwloc=&output=embed`;
  const mapH = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        backgroundColor: '#f1f5f9',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Icon name="location_on" size={18} color="#ea4335" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </div>
            {parsedLat && parsedLng ? (
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                {parsedLat.toFixed(6)}, {parsedLng.toFixed(6)}
              </div>
            ) : address ? (
              <div style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {address}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height: mapH, backgroundColor: '#f1f5f9' }}>
        {!loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f8fafc',
              color: '#94a3b8',
              fontSize: '0.8125rem',
              gap: 8,
            }}
          >
            <Icon name="map" size={20} color="#94a3b8" />
            <span>Loading map preview…</span>
          </div>
        )}

        {slow && !loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(248, 250, 252, 0.95)',
              color: '#64748b',
              fontSize: '0.8125rem',
              gap: 10,
              padding: 16,
              textAlign: 'center',
              zIndex: 2,
            }}
          >
            <Icon name="schedule" size={22} color="#94a3b8" />
            <span>Map preview is taking longer than usual</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSlow(false);
                setLoaded(false);
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}

        <iframe
          key={attempt}
          title={title}
          src={embedUrl}
          width="100%"
          height="100%"
          style={{ border: 0, display: 'block', opacity: loaded ? 1 : 0 }}
          loading="eager"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
