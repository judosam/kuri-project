import type { CSSProperties } from 'react';

export function SetBadge({
  name,
  style,
}: {
  name?: string | null;
  style?: CSSProperties;
}) {
  const setName = (name || '').trim();
  if (!setName) {
    return <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>—</span>;
  }

  let bg = '#f8fafc';
  let text = '#475569';
  let border = '#e2e8f0';

  const lower = setName.toLowerCase();
  if (lower.includes('district') || lower === 'cbe district') {
    bg = '#eff6ff';
    text = '#1d4ed8';
    border = '#bfdbfe';
  } else if (lower.includes('corporation') || lower === 'cbe corporation') {
    bg = '#f0fdf4';
    text = '#15803d';
    border = '#bbf7d0';
  } else if (lower.includes('qa')) {
    bg = '#faf5ff';
    text = '#7c3aed';
    border = '#e9d5ff';
  } else if (lower.includes('field')) {
    bg = '#fff7ed';
    text = '#c2410c';
    border = '#fed7aa';
  } else {
    bg = '#f1f5f9';
    text = '#334155';
    border = '#cbd5e1';
  }

  return (
    <span
      className="set-badge"
      title={setName}
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
        letterSpacing: '0.01em',
        ...style,
      }}
    >
      {setName}
    </span>
  );
}
