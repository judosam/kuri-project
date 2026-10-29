import type { CSSProperties } from 'react';

export function formatSourceLabel(source?: string | null, isManual?: boolean): string {
  if (isManual) return 'Admin Added';
  if (!source) return 'Imported';
  const s = source.toLowerCase().trim();
  if (s === 'imported') return 'Imported';
  if (s === 'qa_portal' || s === 'qa portal' || s === 'qa') return 'QA User Added';
  if (s === 'captured' || s === 'field' || s === 'field_captured') return 'Field User Added';
  if (s === 'manual' || s === 'admin') return 'Admin Added';
  return source;
}

export function SourceBadge({
  source,
  isManual,
  style,
}: {
  source?: string | null;
  isManual?: boolean;
  style?: CSSProperties;
}) {
  const label = formatSourceLabel(source, isManual);

  let bg = '#f0f9ff';
  let text = '#0284c7';
  let border = '#bae6fd';

  if (label === 'QA User Added') {
    bg = '#faf5ff';
    text = '#7c3aed';
    border = '#e9d5ff';
  } else if (label === 'Field User Added') {
    bg = '#f0fdf4';
    text = '#15803d';
    border = '#bbf7d0';
  } else if (label === 'Admin Added') {
    bg = '#fffbeb';
    text = '#b45309';
    border = '#fde68a';
  } else {
    // Imported
    bg = '#f0f9ff';
    text = '#0284c7';
    border = '#bae6fd';
  }

  return (
    <span
      className="source-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: '0.72rem',
        fontWeight: 600,
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        ...style,
      }}
      title={`Source: ${label}`}
    >
      {label}
    </span>
  );
}
export default SourceBadge;
