/**
 * Audit Review — read-only oversight of every record's audit workflow state.
 * Shows the live audit status, the auditor's comment, who decided it and when,
 * plus who the staged operator is so approvers can trace a release end-to-end.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordsApi } from '../services/api';
import type { AuditStatus, CaptureRecord } from '../types';
import {
  formatDate,
  formatDateTime,
  Icon,
  type IconName,
  EmptyPanel,
  LoadingPanel,
  Pager,
  PageShell,
  AuthThumbnail,
  CustomSelect,
} from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';

const PAGE_SIZE = 15;

const AUDIT_META: Record<AuditStatus, { label: string; icon: IconName; cls: string }> = {
  PENDING: { label: 'Pending', icon: 'pending_actions', cls: 'audit-chip-pending' },
  APPROVAL: { label: 'Approval', icon: 'check_circle', cls: 'audit-chip-approval' },
  DISAPPROVAL: { label: 'Disapproval', icon: 'block', cls: 'audit-chip-disapproval' },
  COMMERCIAL_PROPERTY: { label: 'Commercial Property', icon: 'storefront', cls: 'audit-chip-commercial_property' },
  RE_AUDITED: { label: 'Re Audited', icon: 'history', cls: 'audit-chip-re_audited' },
};

const AUDIT_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All audit statuses' },
  { value: 'PENDING', label: 'Pending (staged tasks)' },
  { value: 'APPROVAL', label: 'Approval (released)' },
  { value: 'DISAPPROVAL', label: 'Disapproval (blocked)' },
  { value: 'COMMERCIAL_PROPERTY', label: 'Commercial Property' },
  { value: 'RE_AUDITED', label: 'Re Audited (revised)' },
];

type SortKey = 'created_at' | 'unique_id' | 'audited_at' | 'audit_status' | 'village' | 'taluk' | 'district';

function AuditChip({ status }: { status?: AuditStatus | null }) {
  if (!status) {
    return (
      <span className="audit-chip audit-chip-unset" title="No audit decision recorded">
        <Icon name="info" size={13} />
        No audit
      </span>
    );
  }
  const meta = AUDIT_META[status] ?? AUDIT_META.PENDING;
  return (
    <span className={`audit-chip ${meta.cls}`} title={`Audit status: ${meta.label}`}>
      <Icon name={meta.icon} size={13} />
      {meta.label}
    </span>
  );
}

export default function AuditReview() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const requestSeq = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const shownFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const shownTo = Math.min(page * PAGE_SIZE, total);

  // Live counts across the whole table (independent of the active filter).
  const [counts, setCounts] = useState({ PENDING: 0, APPROVAL: 0, DISAPPROVAL: 0, COMMERCIAL_PROPERTY: 0, RE_AUDITED: 0 });

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Audit Review</h1>
        <span className="count-pill">{total.toLocaleString()}</span>
      </div>
    ),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: typeof counts = { PENDING: 0, APPROVAL: 0, DISAPPROVAL: 0, COMMERCIAL_PROPERTY: 0, RE_AUDITED: 0 };
      for (const status of Object.keys(next) as AuditStatus[]) {
        try {
          const res = await recordsApi.list({ page: 1, page_size: 1, audit_status: status });
          if (cancelled) return;
          next[status] = res.total;
        } catch {
          // A failed count leaves that chip at 0 — the table itself still renders.
        }
      }
      if (!cancelled) setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    recordsApi
      .list({
        page,
        page_size: PAGE_SIZE,
        audit_status: auditFilter || undefined,
        search: search || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
      })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setRecords(res.records || []);
        setTotal(res.total);
        setLoading(false);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setRecords([]);
        setTotal(0);
        setLoading(false);
      });
  }, [page, auditFilter, search, sortBy, sortOrder]);

  const filterChips = useMemo(
    () =>
      (Object.keys(AUDIT_META) as AuditStatus[]).map((status) => {
        const meta = AUDIT_META[status];
        const active = auditFilter === status;
        return (
          <button
            key={status}
            type="button"
            className={`seg-btn ${active ? 'active' : ''}`}
            onClick={() => {
              setAuditFilter(active ? '' : status);
              setPage(1);
            }}
            title={`Show only ${meta.label} records`}
          >
            <Icon name={meta.icon} size={13} />
            {meta.label} ({counts[status]})
          </button>
        );
      }),
    [counts, auditFilter]
  );

  const sortHeader = (label: string, key: SortKey, width?: number) => (
    <th style={width ? { minWidth: width } : undefined}>
      <button
        type="button"
        className="record-sort-heading"
        onClick={() => {
          setSortOrder(sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc');
          setSortBy(key);
          setPage(1);
        }}
        title={`Sort by ${label}`}
      >
        {label}
        <Icon name={sortBy === key ? (sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'} size={14} />
      </button>
    </th>
  );

  return (
    <PageShell>
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div className="search-wrap" style={{ flex: '1 1 260px', minWidth: 220 }}>
            <Icon name="search" />
            <input
              type="text"
              className="fld fld-soft"
              placeholder="Search by UID, site address, survey no, owner, or operator…"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              aria-label="Search audit records"
            />
            {searchInput && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div style={{ minWidth: 200 }}>
            <CustomSelect
              value={auditFilter}
              onChange={(val) => {
                setAuditFilter(val);
                setPage(1);
              }}
              options={AUDIT_FILTERS}
              ariaLabel="Filter by audit status"
            />
          </div>
        </div>
        <div className="seg records-quick-filters" role="group" aria-label="Quick audit filters" style={{ marginTop: 10 }}>
          {filterChips}
          {auditFilter && (
            <button
              type="button"
              className="seg-btn"
              onClick={() => {
                setAuditFilter('');
                setPage(1);
              }}
              title="Show all audit statuses"
            >
              <Icon name="close" size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingPanel text="Loading audit records…" />}
      {!loading && records.length === 0 && (
        <EmptyPanel
          icon="fact_check"
          text={
            auditFilter || search
              ? 'No records match the current audit filters.'
              : 'No records yet. Task sheets staged by the Import Task Sheet user will appear here for review.'
          }
        />
      )}

      {!loading && records.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="fos-table records-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Photo</th>
                  {sortHeader('Unique ID', 'unique_id', 130)}
                  {sortHeader('Village', 'village', 140)}
                  {sortHeader('Taluk', 'taluk', 130)}
                  {sortHeader('District', 'district', 130)}
                  <th style={{ minWidth: 170 }}>Site</th>
                  {sortHeader('Audit Status', 'audit_status', 170)}
                  <th style={{ minWidth: 220 }}>QC Comments (VHR Imagery)</th>
                  <th style={{ minWidth: 130 }}>Audited By</th>
                  {sortHeader('Audited At', 'audited_at', 140)}
                  <th style={{ minWidth: 140 }}>Staged Operator</th>
                  <th style={{ minWidth: 110 }}>Assigned To</th>
                  {sortHeader('Created', 'created_at', 110)}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const firstImg = r.images?.[0];
                  const site = r.site_address || r.street_address || r.formatted_address || r.name;
                  return (
                    <tr
                      key={r.id}
                      className="rowlink"
                      onClick={() => {
                        if (r.source === 'imported') {
                          window.open(`/records/imported/${r.id}`, '_blank', 'noopener');
                        } else {
                          navigate(`/records/${r.id}`);
                        }
                      }}
                      title="Open record details"
                    >
                      <td className="cell-thumb">
                        <AuthThumbnail imageUrl={firstImg?.image_url} alt={r.name || 'Record photo'} size={34} />
                      </td>
                      <td>
                        {r.unique_id ? (
                          <span className="mono-sm rec-unique-id" style={{ fontWeight: 700, color: '#0f172a' }}>
                            {r.unique_id}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        <div className="rec-text-cell">
                          <span style={{ color: '#0f172a', fontWeight: 600 }}>{r.village || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="rec-text-cell">
                          <span style={{ color: '#0f172a' }}>{r.taluk || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="rec-text-cell">
                          <span style={{ color: '#0f172a' }}>{r.district || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="rec-text-cell">
                          <span style={{ color: '#0f172a', fontWeight: 500 }}>{site}</span>
                        </div>
                      </td>
                      <td>
                        <AuditChip status={r.audit_status} />
                      </td>
                      <td>
                        {(r.qc_vhr_comment || r.audit_comment) ? (
                          <div className="rec-text-cell">
                            <ExpandableComment text={r.qc_vhr_comment || r.audit_comment || ''} />
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        {r.audited_by_name ? (
                          <span style={{ color: '#0f172a', fontWeight: 600 }}>{r.audited_by_name}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.audited_at ? (
                          <time dateTime={r.audited_at} title={formatDateTime(r.audited_at)}>
                            {formatDate(r.audited_at)}
                          </time>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        {r.staged_operator_name ? (
                          <span style={{ color: '#0f172a', fontWeight: 600 }} title="Operator who will receive the task on approval">
                            {r.staged_operator_name}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        {r.user_name ? (
                          <span style={{ color: '#0f172a', fontWeight: 600 }}>{r.user_name}</span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              color: '#b45309',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                            title="Not released to a field operator"
                          >
                            <Icon name="pending_actions" size={13} />
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="table-foot-note">
              Showing {shownFrom}–{shownTo} of {total.toLocaleString()}
            </span>
            <Pager
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}

/** Comment cell that expands on click — audit notes can be long. */
function ExpandableComment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 80;
  return (
    <span
      onClick={(e) => {
        if (truncated) {
          e.stopPropagation();
          setExpanded((v) => !v);
        }
      }}
      style={{
        display: 'block',
        maxWidth: 260,
        whiteSpace: expanded ? 'normal' : 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: truncated ? 'pointer' : 'default',
        color: '#334155',
        fontSize: '0.8rem',
      }}
      title={text}
    >
      {text}
    </span>
  );
}
