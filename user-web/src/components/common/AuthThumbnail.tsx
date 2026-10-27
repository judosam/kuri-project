import React, { useState } from 'react';
import { api } from '../../services/api';
import Icon from './Icon';

interface AuthThumbnailProps {
  imageUrl?: string;
  alt?: string;
  className?: string;
  fallbackIcon?: string;
  photoCount?: number;
  thumb?: boolean;
}

export default function AuthThumbnail({
  imageUrl,
  alt = 'Thumbnail',
  className = 'record-thumb-img',
  fallbackIcon = 'photo_camera',
  photoCount,
  thumb = true,
}: AuthThumbnailProps) {
  const [hasError, setHasError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const authUrl = api.getAuthenticatedImageUrl(imageUrl, thumb);

  return (
    <>
      {authUrl && !hasError ? (
        <>
          {!imgLoaded && (
            <div
              className={`skeleton-pulse ${className}`}
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: '#e2e8f0',
                borderRadius: 'inherit',
              }}
            />
          )}
          <img
            src={authUrl}
            alt={alt}
            className={className}
            onLoad={() => setImgLoaded(true)}
            onError={() => setHasError(true)}
            loading="lazy"
            style={{
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.2s ease-in',
            }}
          />
        </>
      ) : (
        <Icon name={fallbackIcon} size={24} color="#FF6467" />
      )}

      {typeof photoCount === 'number' && photoCount > 0 && (
        <span
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: '#ffffff',
            fontSize: '0.62rem',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            pointerEvents: 'none',
          }}
        >
          <Icon name="photo" size={10} color="#ffffff" />
          {photoCount}
        </span>
      )}
    </>
  );
}
