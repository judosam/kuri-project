import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { recordsApi } from '../services/api';
import { Icon } from './ui';

type Choice = { value: string; label: string; count: number };

function formatChoiceLabel(val: string, field?: string): string {
  if (!val || val === '__EMPTY__' || val === '__BLANK__' || val === '(Blanks)') return '(Blanks)';
  if (field === 'qc_status' || val === 'DONE' || val === 'QC Done' || val === 'QC_DONE') {
    if (val === 'DONE' || val === 'QC Done' || val === 'QC_DONE') return 'QC Done';
    if (val === 'PENDING' || val === 'QC Pending' || val === 'QC_PENDING') return 'QC Pending';
  }
  if (field === 'status') {
    if (val === 'COMPLETED_REVISITED' || val === 'Updated Revisited' || val === 'UPDATED_REVISITED') return 'Completed Revisited';
    if (val === 'COMPLETED') return 'Completed';
    if (val === 'REASSIGNED') return 'Reassigned';
    if (val === 'NOT_COMPLETED' || val === 'PENDING') return 'Pending';
    if (val === 'NOT_INTERESTED' || val === 'Not Interested') return 'Not Interested';
    if (val === 'DUPLICATE' || val === 'Duplicate') return 'Duplicate';
    if (val === 'CONSTRUCTION_FINISHED' || val === 'Construction Finished') return 'Construction Finished';
    if (val === 'MANUALLY_ADDED' || val === 'MANUAL') return 'Manually Added';
  }
  if (field === 'telecaller_status') {
    if (val === 'CONSTRUCTION_CONFIRMED' || val === 'CONFIRMED') return 'Construction Confirmed';
    if (val === 'CONNECTED_FOLLOW_UP' || val === 'FOLLOW_UP') return 'Follow Up Needed';
    if (val === 'NOT_REACHABLE' || val === 'UNREACHABLE') return 'Ringing / Not Reachable';
    if (val === 'DISCONNECTED_BUSY') return 'Disconnected / Busy';
    if (val === 'WRONG_NUMBER') return 'Wrong Number';
    if (val === 'NOT_INTERESTED') return 'Not Interested';
    if (val === 'PENDING') return 'Pending Call';
  }
  if (val === 'COMPLETED_REVISITED' || val === 'Updated Revisited' || val === 'UPDATED_REVISITED') return 'Completed Revisited';
  if (val === 'DONE') return 'QC Done';
  if (val === 'NOT_COMPLETED') return 'Pending';
  if (val === 'COMPLETED') return 'Completed';
  if (val === 'REASSIGNED') return 'Reassigned';
  if (val === 'MANUALLY_ADDED' || val === 'MANUAL') return 'Manually Added';
  if (val === 'APPROVAL') return 'Approval';
  if (val === 'DISAPPROVAL') return 'Disapproval';
  if (val === 'COMMERCIAL_PROPERTY') return 'Commercial Property';
  if (val === 'RE_AUDITED') return 'Reaudited';
  if (val === 'PENDING') return 'Pending';
  if (val === 'APPROVED') return 'Approved';
  if (val === 'REJECTED') return 'Rejected';
  if (val === 'NEEDS_CORRECTION') return 'Needs Correction';
  if (val === 'READY_FOR_AUDIT') return 'Ready for Audit';
  if (val === 'UNASSIGNED') return 'Unassigned';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return val;
}

export default function RecordColumnHeader({
  label,
  field,
  sortKey,
  sortBy,
  sortOrder,
  onSort,
  values = [],
  onFilter,
  params,
  width,
  minWidth,
  maxWidth,
  className,
}: {
  label: string;
  field?: string;
  sortKey?: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (key: string) => void;
  values?: string[];
  onFilter: (values: string[]) => void;
  params: Record<string, unknown>;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [choices, setChoices] = useState<Choice[]>([]);
  const [draft, setDraft] = useState<string[]>(values);
  const [all, setAll] = useState(!values.length);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!open || !field) return;
    let active = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      recordsApi
        .filterOptions(field, JSON.parse(paramsKey), search)
        .then((result) => {
          if (active) {
            setChoices(result.options);
            setTruncated(result.truncated);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Could not load values. Reopen this filter to retry.');
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, field, paramsKey, search]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
      if (event.key === 'Tab' && panel.current) {
        const elements = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', keys);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = trigger.current!.getBoundingClientRect();
    const popoverWidth = 300;
    const popoverHeight = 390;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    let top = rect.bottom + 6;
    if (top + popoverHeight > window.innerHeight && rect.top - popoverHeight - 6 > 0) {
      top = rect.top - popoverHeight - 6;
    }
    setPosition({ left, top });
    setDraft(values);
    setAll(!values.length);
    setSearch('');
    setError('');
    setOpen(true);
  };

  const isFiltered = values.length > 0;

  const colKey = field || sortKey;
  const colClass = colKey ? `col-${colKey.replace(/_/g, '-')}` : '';

  return (
    <th
      data-col={colKey}
      style={width ? { width, minWidth: minWidth ?? width, maxWidth: maxWidth || undefined } : (minWidth ? { minWidth, maxWidth: maxWidth || undefined } : undefined)}
      aria-sort={sortKey === sortBy ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={[isFiltered ? 'th-filter-active' : '', className, colClass].filter(Boolean).join(' ') || undefined}
    >
      <div className="record-column-heading">
        {sortKey ? (
          <button
            type="button"
            className="record-sort-heading"
            onClick={() => onSort(sortKey)}
            title={`Sort by ${label}`}
          >
            <span>{label}</span>
            {sortKey === sortBy && (
              <Icon
                name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                size={13}
              />
            )}
          </button>
        ) : (
          <span className="record-column-title">{label}</span>
        )}

        {field && (
          <button
            ref={trigger}
            type="button"
            className={`column-filter-trigger${isFiltered ? ' is-active' : ''}`}
            aria-label={`Filter by ${label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={isFiltered ? `${values.length} active filter${values.length > 1 ? 's' : ''} for ${label}` : `Filter by ${label}`}
            onClick={toggle}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="filter-funnel-icon"
              style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
            >
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {isFiltered && <span className="filter-count-badge">{values.length}</span>}
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={panel}
            className="column-filter-popover"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} filter`}
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
            }}
          >
            <div className="column-filter-title">
              <div>
                <strong>{label}</strong>
                <span className="col-filter-subtitle">Filter column values</span>
              </div>
              <button
                type="button"
                className="col-filter-close"
                aria-label="Close filter"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="column-filter-search-box">
              <Icon name="search" size={14} style={{ color: '#64748b' }} />
              <input
                autoFocus
                type="search"
                placeholder={`Search ${label}...`}
                aria-label={`Search ${label} values`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="col-search-clear"
                  onClick={() => setSearch('')}
                  title="Clear search"
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>

            <div className="column-filter-tools">
              <button
                type="button"
                className="col-tool-btn"
                onClick={() => {
                  setAll(true);
                  setDraft([]);
                }}
              >
                Select all
              </button>
              <span className="col-tool-divider">•</span>
              <button
                type="button"
                className="col-tool-btn"
                onClick={() => {
                  setAll(false);
                  setDraft([]);
                }}
              >
                Clear all
              </button>
              {isFiltered && (
                <>
                  <span className="col-tool-divider">•</span>
                  <span className="col-active-pill">{values.length} active</span>
                </>
              )}
            </div>

            <div className="column-filter-values">
              {busy ? (
                <div className="col-filter-status-box">
                  <div className="col-spinner" />
                  <span>Loading options...</span>
                </div>
              ) : error ? (
                <div className="col-filter-status-box error" role="alert">
                  <span>{error}</span>
                </div>
              ) : choices.length ? (
                choices.map((choice) => {
                  const isChecked = all || draft.includes(choice.value);
                  return (
                    <label key={choice.value} className={`col-value-row${isChecked ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const currentSelected = all ? choices.map((c) => c.value) : draft;
                          if (currentSelected.includes(choice.value)) {
                            setDraft(currentSelected.filter((v) => v !== choice.value));
                          } else {
                            setDraft([...currentSelected, choice.value]);
                          }
                          setAll(false);
                        }}
                      />
                      <span className="col-value-text" title={choice.label}>
                        {formatChoiceLabel(choice.label, field)}
                      </span>
                      <span className="col-value-count">{choice.count}</span>
                    </label>
                  );
                })
              ) : (
                <div className="col-filter-status-box">
                  <span>No matching values</span>
                </div>
              )}
            </div>

            {truncated && (
              <small className="column-filter-hint">
                Showing top results. Search to narrow options.
              </small>
            )}

            <div className="column-filter-footer">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onFilter([]);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || !!error || (!all && !draft.length)}
                onClick={() => {
                  onFilter(all ? [] : draft);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                Apply {!all && draft.length ? `(${draft.length})` : ''}
              </button>
            </div>
          </div>,
          document.body
        )}
    </th>
  );
}
