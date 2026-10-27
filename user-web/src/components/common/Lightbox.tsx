import React, { useEffect } from 'react';
import type { ImageData } from '../../types';
import Icon from './Icon';
import { formatCoordinates, formatDateTime } from '../../utils/format';

interface LightboxProps {
  images: ImageData[];
  currentIndex: number | null;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  imageUrls: Record<number, string>;
}

export default function Lightbox({
  images,
  currentIndex,
  onClose,
  onSelectIndex,
  imageUrls,
}: LightboxProps) {
  useEffect(() => {
    if (currentIndex == null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onSelectIndex(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onSelectIndex(currentIndex + 1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, images.length, onClose, onSelectIndex]);

  if (currentIndex == null || !images[currentIndex]) return null;

  const current = images[currentIndex];
  const src = imageUrls[current.id] || current.image_url;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: 'rgba(10, 15, 29, 0.94)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      {/* Top Header Bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          color: '#ffffff',
          zIndex: 10001,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.02em' }}>
            PHOTO {currentIndex + 1} OF {images.length}
          </span>
          <span
            style={{
              fontSize: '0.75rem',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            Order #{current.photo_order}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            border: 'none',
            color: '#ffffff',
            width: 38,
            height: 38,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          title="Close Lightbox"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      {/* Main Image Viewport */}
      <div
        style={{
          maxWidth: '92vw',
          maxHeight: '78vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {src ? (
          <img
            src={src}
            alt={`Field capture ${currentIndex + 1}`}
            style={{
              maxWidth: '100%',
              maxHeight: '78vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            }}
          />
        ) : (
          <div
            style={{
              padding: 40,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              color: '#ffffff',
              textAlign: 'center',
            }}
          >
            <Icon name="broken_image" size={48} color="#94a3b8" />
            <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#94a3b8' }}>Image not available</p>
          </div>
        )}
      </div>

      {/* Prev / Next navigation buttons */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex > 0) onSelectIndex(currentIndex - 1);
            }}
            style={{
              position: 'absolute',
              left: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIndex === 0 ? 'default' : 'pointer',
              opacity: currentIndex === 0 ? 0.3 : 1,
              transition: 'all 0.15s ease',
            }}
            title="Previous photo"
          >
            <Icon name="chevron_left" size={28} />
          </button>

          <button
            type="button"
            disabled={currentIndex === images.length - 1}
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex < images.length - 1) onSelectIndex(currentIndex + 1);
            }}
            style={{
              position: 'absolute',
              right: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIndex === images.length - 1 ? 'default' : 'pointer',
              opacity: currentIndex === images.length - 1 ? 0.3 : 1,
              transition: 'all 0.15s ease',
            }}
            title="Next photo"
          >
            <Icon name="chevron_right" size={28} />
          </button>
        </>
      )}

      {/* Bottom Metadata Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 24px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
          color: '#ffffff',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          fontSize: '0.825rem',
          zIndex: 10001,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="schedule" size={16} color="#94a3b8" />
          <span>{formatDateTime(current.captured_at)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
          <Icon name="location_on" size={16} color="#4ade80" />
          <span>{formatCoordinates(current.latitude, current.longitude)}</span>
        </div>

        {current.location_accuracy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
            <span>Accuracy: ±{Math.round(current.location_accuracy)}m</span>
          </div>
        )}
      </div>
    </div>
  );
}
