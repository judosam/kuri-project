/**
 * Shared Field Ops Studio UI primitives for the PhotoCapture admin panel.
 * Icons use Material Symbols Outlined; avatars render initials (users have no photos).
 */
import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { SERVER_BASE } from '../services/api';

export type IconName =
  | 'add'
  | 'settings'
  | 'dashboard'
  | 'group'
  | 'folder_open'
  | 'pin_drop'
  | 'logout'
  | 'chevron_right'
  | 'chevron_left'
  | 'search'
  | 'photo_camera'
  | 'check_circle'
  | 'close'
  | 'delete'
  | 'fullscreen'
  | 'arrow_back'
  | 'arrow_forward'
  | 'arrow_upward'
  | 'arrow_downward'
  | 'unfold_more'
  | 'pending_actions'
  | 'near_me'
  | 'my_location'
  | 'location_on'
  | 'image'
  | 'broken_image'
  | 'schedule'
  | 'dataset'
  | 'shutter_speed'
  | 'calendar_today'
  | 'calendar_month'
  | 'event'
  | 'apartment'
  | 'badge'
  | 'person'
  | 'person_add'
  | 'verified'
  | 'lock'
  | 'error'
  | 'warning'
  | 'info'
  | 'refresh'
  | 'cloud_done'
  | 'photo_library'
  | 'tune'
  | 'filter_alt'
  | 'open_in_new'
  | 'receipt_long'
  | 'history'
  | 'flag'
  | 'upload'
  | 'visibility'
  | 'visibility_off'
  | 'security'
  | 'login'
  | 'lock_reset'
  | 'key'
  | 'content_copy'
  | 'auto_awesome'
  | 'assignment_turned_in'
  | 'table_view'
  | 'expand_more'
  | 'expand_less'
  | 'keyboard_arrow_down'
  | 'keyboard_arrow_up'
  | 'edit'
  | 'edit_note'
  | 'download'
  | 'upload_file'
  | 'cloud_upload'
  | 'add_photo_alternate'
  | 'task_alt'
  | 'save'
  | 'playlist_add'
  | 'inventory'
  | 'fact_check'
  | 'block'
  | 'storefront'
  | 'map'
  | 'person_off'
  | 'person_remove'
  | 'how_to_reg'
  | 'zoom_in'
  | 'zoom_out'
  | 'restart_alt'
  | 'satellite_alt'
  | 'call'
  | 'phone_callback'
  | 'phone_missed'
  | 'phone_disabled'
  | 'phone_paused'
  | 'phone_in_talk'
  | 'add_call'
  | 'check'
  | 'published_with_changes'
  | 'comment'
  | 'description'
  | 'edit_document'
  | 'sync';


export function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cls = ['ms', className].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      style={{ ...(size !== 18 ? { fontSize: size } : {}), ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

/** Initials avatar — deterministic soft tint per name. */
const AVATAR_TINTS = ['#e0e7ff', '#dbeafe', '#d9f0e3', '#fff0c2', '#e3e8f5'];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 'md',
  className,
  brand = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Brand fill with white initials instead of the deterministic tint. */
  brand?: boolean;
}) {
  const hue = Math.abs([...name].reduce((acc, c) => acc + c.charCodeAt(0), 0));
  const bg = AVATAR_TINTS[hue % AVATAR_TINTS.length];
  return (
    <span
      className={['avatar', size, brand ? 'avatar-brand' : '', className].filter(Boolean).join(' ')}
      style={brand ? undefined : { background: bg }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

/** Stat / metric card used on Dashboard. */
export function StatCard({
  label,
  value,
  icon,
  tone,
  note,
  codeNote,
}: {
  label: string;
  value: number;
  icon: IconName;
  tone: 'blue' | 'green' | 'purple' | 'sky';
  note?: string;
  codeNote?: string;
}) {
  return (
    <div className={`stat accent-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`icon-tile tile-${tone === 'sky' ? 'sky' : tone === 'green' ? 'green' : tone === 'purple' ? 'purple' : 'blue'}`}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="stat-value">{value.toLocaleString()}</div>
      {(note || codeNote) && (
        <div className="stat-foot">
          {note && <span className="stat-note">{note}</span>}
          {codeNote && <span className="stat-note-code">{codeNote}</span>}
        </div>
      )}
    </div>
  );
}

export function EmptyPanel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="state-panel">
      <Icon name={icon} size={30} />
      <span>{text}</span>
    </div>
  );
}

export function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="state-panel loading">
      <Icon name="refresh" size={26} className="fos-spin" />
      <span>{text}</span>
    </div>
  );
}

/**
 * ⓘ affordance for reference text that would otherwise clutter the page: the
 * full explanation appears on hover and on keyboard focus, and costs no layout
 * space until it is wanted.
 */
export function InfoHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={label}>
      <Icon name="info" size={15} />
      <span className="info-hint-tip" role="tooltip">
        {children}
      </span>
    </span>
  );
}

/** "No. 0039" — clean serial label, hides the raw database id. */
export function formatRecordNo(id: number | null | undefined): string {
  if (id == null) return '—';
  return `No. ${String(id).padStart(4, '0')}`;
}

/**
 * Safely parses an ISO date string into a Date object.
 * If the string lacks a timezone indicator (e.g. SQLite naive ISO "2026-09-08 11:01:39"),
 * it normalizes it as UTC ('Z') so the browser renders in the user's local timezone (e.g. Indian Standard Time).
 */
export function parseUtcDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  let str = String(iso).trim();
  if (!str) return null;
  if ((str.includes('T') || str.includes(' ')) && !str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    str = (str.includes('T') ? str : str.replace(' ', 'T')) + 'Z';
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso: string | undefined | null): string {
  const d = parseUtcDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | undefined | null): string {
  const d = parseUtcDate(iso);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatCapturedDateOrTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const str = String(iso).trim();
  if (!str) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  const d = parseUtcDate(str);
  if (!d) return str;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatCoords(lat: number | null | undefined, lng: number | null | undefined): string {
  if (typeof lat !== 'number' || typeof lng !== 'number') return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

/** Pager row: Previous / current page pill / Next — with real totals. */
export function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pager">
      <button className="pager-btn" disabled={page <= 1} onClick={onPrev} type="button">
        <Icon name="chevron_left" />
        Previous
      </button>
      <span className="pager-cur">
        Page {page} of {Math.max(1, totalPages)}
      </span>
      <button
        className="pager-btn"
        disabled={page >= Math.max(1, totalPages)}
        onClick={onNext}
        type="button"
      >
        Next
        <Icon name="chevron_right" />
      </button>
    </div>
  );
}

/** Wrap children to constrain page width on ultra-wide displays. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 1500,
        margin: '0 auto',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

const THUMB_CACHE = new Map<string, string>();

/** Authenticated thumbnail renderer with memory cache and placeholder fallback. */
export function AuthThumbnail({
  imageUrl,
  alt = 'Record photo',
  size = 42,
  className,
}: {
  imageUrl?: string;
  alt?: string;
  size?: number;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => (imageUrl ? THUMB_CACHE.get(imageUrl) || null : null));

  useEffect(() => {
    if (!imageUrl) return;
    if (THUMB_CACHE.has(imageUrl)) {
      setSrc(THUMB_CACHE.get(imageUrl)!);
      return;
    }

    let active = true;
    const token = localStorage.getItem('token');
    const normalized = imageUrl.startsWith('/api')
      ? imageUrl
      : `/api${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;

    const sep = normalized.includes('?') ? '&' : '?';
    const thumbUrl = `${normalized}${sep}thumb=true`;

    fetch(`${SERVER_BASE}${thumbUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        THUMB_CACHE.set(imageUrl, objectUrl);
        setSrc(objectUrl);
      })
      .catch(() => {
        // Fallback icon shown
      });

    return () => {
      active = false;
    };
  }, [imageUrl]);

  return (
    <div
      className={['auth-thumb-wrap', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, minWidth: size }}
    >
      {src ? (
        <img src={src} alt={alt} className="auth-thumb-img" />
      ) : (
        <div className="auth-thumb-placeholder">
          <Icon name="photo_camera" size={Math.round(size * 0.44)} />
        </div>
      )}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  className = '',
  style,
}: {
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrapRef.current?.querySelector<HTMLButtonElement>('.custom-select-trigger')?.focus();
      }
    };

    if (open) {
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[activeIndex]?.focus();
  }, [open, activeIndex]);

  // Match exact, then case-insensitive trimmed
  const selectedOption =
    options.find((o) => o.value === value) ||
    options.find((o) => o.value && value && o.value.trim().toLowerCase() === value.trim().toLowerCase());

  // If value is non-empty and not in options, dynamically include it in rendered options
  const effectiveOptions = useMemo(() => {
    if (value && value.trim() && !options.some((o) => o.value.trim().toLowerCase() === value.trim().toLowerCase())) {
      const hasBlank = options.length > 0 && options[0].value === '';
      if (hasBlank) {
        return [options[0], { value: value.trim(), label: value.trim() }, ...options.slice(1)];
      }
      return [{ value: value.trim(), label: value.trim() }, ...options];
    }
    return options;
  }, [options, value]);

  const openOptions = (last = false) => {
    const selected = effectiveOptions.findIndex(
      (opt) => opt.value === value || (opt.value && value && opt.value.trim().toLowerCase() === value.trim().toLowerCase())
    );
    setActiveIndex(selected >= 0 ? selected : last ? Math.max(0, effectiveOptions.length - 1) : 0);
    setOpen(true);
  };

  const displayText = selectedOption
    ? selectedOption.label
    : (value && value.trim() !== '')
    ? value
    : (placeholder || options[0]?.label || '');

  return (
    <div
      ref={wrapRef}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      className={`custom-select-wrap ${className}`}
      style={{ position: 'relative', width: '100%', zIndex: open ? 500 : 'auto', ...style }}
    >
      <button
        type="button"
        className={`custom-select-trigger ${open ? 'open' : ''}`}
        onClick={() => open ? setOpen(false) : openOptions()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); openOptions(event.key === 'ArrowUp');
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-description={displayText}
      >
        <span className="custom-select-label" title={displayText}>{displayText}</span>
        <span className={`custom-select-arrow ${open ? 'rotated' : ''}`} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="custom-select-dropdown" role="listbox" aria-label={ariaLabel}>
          {effectiveOptions.map((opt, index) => {
            const isSelected = Boolean(opt.value === value || (opt.value && value && opt.value.trim().toLowerCase() === value.trim().toLowerCase()));
            return (
              <button
                type="button"
                tabIndex={-1}
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`custom-select-option ${isSelected ? 'selected' : ''}`}
                onKeyDown={event => {
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    setActiveIndex(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                  }
                }}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  wrapRef.current?.querySelector<HTMLButtonElement>('.custom-select-trigger')?.focus();
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
