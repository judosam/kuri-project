import React from 'react';
import type { CapturedPhoto } from '../types';
import Icon from '../components/common/Icon';
import { formatCoordinates, formatDateTime } from '../utils/format';

interface PreviewScreenProps {
  photo: CapturedPhoto | null;
  onRetake: () => void;
  onKeep: () => void;
  photoCount: number;
}

export default function PreviewScreen({
  photo,
  onRetake,
  onKeep,
  photoCount,
}: PreviewScreenProps) {
  if (!photo) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <p>No photo captured</p>
        <button type="button" className="btn btn-secondary" onClick={onRetake}>
          Take Photo
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 700,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '75vh',
      }}
    >
      {/* Photo Preview Container */}
      <div
        className="card"
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
          backgroundColor: '#0f172a',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 420,
        }}
      >
        <img
          src={photo.uri}
          alt="Preview capture"
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '65vh',
            objectFit: 'contain',
          }}
        />

        {/* Top Badge: Photo # In Queue */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(4px)',
            color: '#ffffff',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: '0.75rem',
            fontWeight: 700,
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          Photo #{photoCount + 1}
        </div>
      </div>

      {/* Metadata Pill Summary */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 4px',
          fontSize: '0.78rem',
          color: '#64748b',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669', fontWeight: 600 }}>
          <Icon name="verified" size={16} />
          <span>Geotag Stamped: {formatCoordinates(photo.latitude, photo.longitude)}</span>
        </div>
        <div>{formatDateTime(new Date(photo.capturedAt).toISOString())}</div>
      </div>

      {/* Bottom Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 10,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-lg"
          onClick={onRetake}
          style={{ flex: 1, display: 'flex', gap: 6 }}
        >
          <Icon name="replay" size={20} />
          <span>Retake</span>
        </button>

        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={onKeep}
          style={{ flex: 2, display: 'flex', gap: 8, fontWeight: 700 }}
        >
          <Icon name="check" size={20} />
          <span>Keep Photo</span>
        </button>
      </div>
    </div>
  );
}
