import type { CSSProperties } from 'react';

export function formatSourceLabel(
  source?: string | null,
  isManual?: boolean,
  uploadedByName?: string | null,
): string {
  if (isManual) return 'Field User Added';
  if (!source) return 'Imported';
  const s = source.toLowerCase().trim();
  if (s === 'qa_portal' || s === 'qa portal' || s === 'qa') return 'QA User Added';
  if (s === 'manual' || s === 'field' || s === 'field_user' || s === 'field_captured') return 'Field User Added';
  if (s === 'captured' || s === 'admin' || s === 'admin_added') {
    const name = uploadedByName?.trim();
    return name ? `Imported by ${name}` : 'Imported by Admin';
  }
  if (s === 'imported') {
    const name = uploadedByName?.trim();
    return name ? `Imported by ${name}` : 'Imported';
  }
  return source;
}

export function SourceBadge({
  source,
  isManual,
  uploadedByName,
  style,
}: {
  source?: string | null;
  isManual?: boolean;
  uploadedByName?: string | null;
  style?: CSSProperties;
}) {
  const label = formatSourceLabel(source, isManual, uploadedByName);

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
  } else if (label === 'Admin Added' || label.startsWith('Imported by')) {
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
        ...style,
      }}
    >
      {label}
    </span>
  );
}
