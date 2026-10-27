import React from 'react';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

const SVG_ICONS: Record<string, (color: string) => React.ReactNode> = {
  assignment: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
    </svg>
  ),
  streetview: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <circle cx="12" cy="5" r="3" />
      <path d="M17 11h-2.5l-1.2 4.5-1.8 2.5V22h-2v-4.5l1.6-2.5 1-4H10.5l-1.5 3.5-1.8-1 1.8-4C9.4 9.2 10.1 9 11 9h3.5c.8 0 1.5.4 1.9 1l1.6 2.5-1.5 1z" />
    </svg>
  ),
  satellite_alt: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <path d="M5.59 13.41L7 12l2 2-1.41 1.41c-.78.78-.78 2.05 0 2.83l3.17 3.17c.78.78 2.05.78 2.83 0L15 20l2 2-1.41 1.41c-1.56 1.56-4.1 1.56-5.66 0L6.76 20.24l-3.17-3.17c-1.56-1.56-1.56-4.1 0-5.66l2-2zm12.82-7.82l-2-2 1.41-1.41c1.56-1.56 4.1-1.56 5.66 0l3.17 3.17c1.56 1.56 1.56 4.1 0 5.66L25.24 12l-2-2 1.41-1.41c.78-.78.78-2.05 0-2.83l-3.17-3.17c-.78-.78-2.05-.78-2.83 0L17 4l1.41 1.59zM12 8c2.21 0 4 1.79 4 4s-1.79 4-4 4-4-1.79-4-4 1.79-4 4-4zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  ),
  photo_camera: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
      <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
    </svg>
  ),
  map: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" />
    </svg>
  ),
  directions: (c) => (
    <svg viewBox="0 0 24 24" fill={c} width="100%" height="100%" aria-hidden="true">
      <path d="M21.71 11.29l-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z" />
    </svg>
  ),
};

export default function Icon({ name, size = 20, color, className = '', style }: IconProps) {
  const effectiveColor = color || 'currentColor';
  const renderSvg = SVG_ICONS[name];

  if (renderSvg) {
    return (
      <span
        aria-hidden="true"
        className={`icon-svg-wrap ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'middle',
          color: effectiveColor,
          lineHeight: 1,
          flexShrink: 0,
          ...style,
        }}
      >
        {renderSvg(effectiveColor)}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        color: effectiveColor,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
        verticalAlign: 'middle',
        letterSpacing: 'normal',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {name}
    </span>
  );
}
