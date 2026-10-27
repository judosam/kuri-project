import React from 'react';

interface BadgeProps {
  label: string;
  variant?: 'emerald' | 'amber' | 'blue' | 'slate' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  className?: string;
}

export default function Badge({
  label,
  variant = 'slate',
  size = 'md',
  icon,
  className = '',
}: BadgeProps) {
  const styles: Record<string, React.CSSProperties> = {
    emerald: {
      backgroundColor: '#ecfdf5',
      color: '#059669',
      border: '1px solid #a7f3d0',
    },
    amber: {
      backgroundColor: '#fffbeb',
      color: '#d97706',
      border: '1px solid #fde68a',
    },
    blue: {
      backgroundColor: '#eff6ff',
      color: '#2563eb',
      border: '1px solid #bfdbfe',
    },
    slate: {
      backgroundColor: '#f1f5f9',
      color: '#475569',
      border: '1px solid #e2e8f0',
    },
    danger: {
      backgroundColor: '#fef2f2',
      color: '#dc2626',
      border: '1px solid #fecaca',
    },
  };

  const pad = size === 'sm' ? '2px 7px' : '4px 10px';
  const fontSize = size === 'sm' ? '0.7rem' : '0.75rem';

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: pad,
        fontSize,
        fontWeight: 600,
        borderRadius: 9999,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        ...styles[variant],
      }}
    >
      {icon && <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{icon}</span>}
      <span>{label}</span>
    </span>
  );
}
