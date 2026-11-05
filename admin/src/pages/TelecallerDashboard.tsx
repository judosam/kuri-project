import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaptureRecord } from '../types';
import { telecallerApi, type TelecallerDashboardData } from '../services/api';
import {
  Icon,
  EmptyPanel,
  LoadingPanel,
  PageShell,
  formatDateTime,
} from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import { TelecallerRecordModal, TELECALLER_STATUS_OPTIONS } from '../components/TelecallerRecordModal';
import { ExpandableCellText } from '../components/ExpandableCellText';
import './Dashboard.css';

type CallFilter = 'ALL' | 'CONNECTED_FOLLOW_UP' | 'NOT_REACHABLE' | 'CONSTRUCTION_CONFIRMED';

const CALL_FILTERS: { key: CallFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'CONNECTED_FOLLOW_UP', label: 'Follow-up' },
  { key: 'NOT_REACHABLE', label: 'Not reachable' },
  { key: 'CONSTRUCTION_CONFIRMED', label: 'Confirmed' },
];

const greeting = () => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export default function TelecallerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<TelecallerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<CaptureRecord | null>(null);
  const [callFilter, setCallFilter] = useState<CallFilter>('ALL');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await telecallerApi.getDashboard();
      setData(res);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load telecaller dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const metrics = data?.metrics;

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Calling desk</h1>
        <p className="topbar-page-sub">
          {greeting()} — verified contacts, construction confirmations and owner follow-ups.
        </p>
      </div>
    ),
    right: (
      <div className="k-head-actions">
        <span className="k-muted">
          {metrics ? `${metrics.total_eligible.toLocaleString()} verified contacts` : 'Loading queue…'}
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm k-cta"
          onClick={() => navigate('/telecaller/records')}
          title="Open telecaller calling queue"
        >
          <Icon name="call" size={15} />
          <span>Start calling{metrics ? ` ${metrics.pending_calls.toLocaleString()}` : ''}</span>
        </button>
        <button
          type="button"
          className="k-iconbtn"
          onClick={() => loadData()}
          title="Refresh dashboard metrics"
          aria-label="Refresh dashboard metrics"
        >
          <Icon name="refresh" size={16} className={loading ? 'fos-spin' : undefined} />
        </button>
      </div>
    ),
  }, [metrics?.total_eligible, metrics?.pending_calls, loading]);

  if (loading && !data) {
    return (
      <PageShell>
        <LoadingPanel text="Loading telecaller dashboard metrics…" />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell>
        <div role="alert" className="record-load-error" style={{ margin: '20px 0' }}>
          {error || 'Failed to load data'}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadData()}>
            Retry
          </button>
        </div>
      </PageShell>
    );
  }

  const { metrics: m, recent_calls } = data;

  const totalCalled = Math.max(0, m.total_eligible - m.pending_calls);
  const contactRate = m.total_eligible > 0 ? Math.round((totalCalled / m.total_eligible) * 100) : 0;
  const confirmedRate = totalCalled > 0 ? Math.round((m.construction_confirmed / totalCalled) * 100) : 0;

  const kpis = [
    { key: 'PENDING', tone: 'is-amber', dot: 'is-amber', label: 'Pending calls', value: m.pending_calls, sub: 'Not called yet' },
    { key: 'CONNECTED_FOLLOW_UP', tone: 'is-call', dot: 'is-blue', label: 'Follow-ups', value: m.connected_follow_up, sub: 'Connected, call back needed' },
    { key: 'NOT_REACHABLE', tone: 'is-field', dot: 'is-red', label: 'Retry', value: m.not_reachable, sub: 'Switched off or unanswered' },
    { key: 'CONSTRUCTION_CONFIRMED', tone: 'is-green', dot: 'is-green', label: 'Confirmed', value: m.construction_confirmed, sub: 'Owner confirmed construction' },
  ];

  const visibleCalls = callFilter === 'ALL'
    ? recent_calls
    : recent_calls.filter((r) => (r.telecaller_status || 'PENDING') === callFilter);

  const callCoverage = m.called_today + m.pending_calls;
  const todayShare = callCoverage > 0 ? Math.round((m.called_today / callCoverage) * 100) : 0;

  return (
    <PageShell>
      <div className="k-dash">
        {/* Day summary + KPI row */}
        <section className="k-twocol" style={{ alignItems: 'stretch' }}>
          <div className="k-day">
            <div className="k-day-head">
              <span className="k-day-eyebrow">My day</span>
              <span className="k-day-date">
                {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date())}
              </span>
            </div>
            <p className="k-day-value">
              {m.called_today.toLocaleString()}
              <span className="k-day-unit">calls logged today</span>
            </p>
            <div className="k-day-track">
              <span className="k-day-fill" style={{ width: `${Math.min(100, Math.max(0, todayShare))}%` }} />
            </div>
            <div className="k-day-stats">
              <div>
                <strong>{m.construction_confirmed.toLocaleString()}</strong>
                <span>Confirmed</span>
              </div>
              <div>
                <strong>{m.connected_follow_up.toLocaleString()}</strong>
                <span>Follow-ups</span>
              </div>
              <div>
                <strong>{m.not_reachable.toLocaleString()}</strong>
                <span>Not reachable</span>
              </div>
            </div>
            <p className="k-day-foot">Queue dispositions across all verified leads.</p>
          </div>

          <div className="k-kpis is-two">
            {kpis.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`k-kpi ${k.tone}`}
                onClick={() => navigate(`/telecaller/records?status=${k.key}`)}
                title={`View ${k.label} in the calling queue`}
              >
                <span className="k-kpi-label"><span className={`k-dot ${k.dot}`} />{k.label}</span>
                <span className="k-kpi-value">{k.value.toLocaleString()}</span>
                <span className="k-kpi-sub">{k.sub}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Funnel + outcomes */}
        <section className="k-twocol">
          <div className="k-card">
            <div className="k-card-head">
              <div>
                <h2 className="k-card-title">From contact to confirmed site</h2>
                <p className="k-card-sub">All verified contacts assigned to you</p>
              </div>
              <span className="k-pill is-green">{contactRate}% contacted</span>
            </div>

            <div className="k-funnel-rows is-three">
              <div className="k-funnel-row">
                <span className="k-funnel-label">Verified contacts</span>
                <span className="k-funnel-track">
                  <span className="k-funnel-fill is-blue" style={{ width: '100%' }} />
                </span>
                <span className="k-funnel-value">{m.total_eligible.toLocaleString()}</span>
              </div>
              <div className="k-funnel-row">
                <span className="k-funnel-label">Called</span>
                <span className="k-funnel-track">
                  <span className="k-funnel-fill is-purple" style={{ width: `${Math.max(1, contactRate)}%` }} />
                </span>
                <span className="k-funnel-value">{totalCalled.toLocaleString()}</span>
              </div>
              <div className="k-funnel-row">
                <span className="k-funnel-label">Construction confirmed</span>
                <span className="k-funnel-track">
                  <span className="k-funnel-fill is-orange" style={{ width: `${Math.max(1, confirmedRate)}%` }} />
                </span>
                <span className="k-funnel-value">{m.construction_confirmed.toLocaleString()}</span>
              </div>
            </div>

            <p className="k-footnote">
              {confirmedRate}% of completed calls so far confirmed active construction.
            </p>
          </div>

          <div className="k-card">
            <div className="k-card-head">
              <div>
                <h2 className="k-card-title">Call outcomes</h2>
                <p className="k-card-sub">{totalCalled.toLocaleString()} calls completed</p>
              </div>
            </div>

            <ul className="k-outcomes">
              {[
                { label: 'Construction confirmed', value: m.construction_confirmed, tone: 'is-green' },
                { label: 'Follow-up needed', value: m.connected_follow_up, tone: 'is-blue' },
                { label: 'Not reachable / busy', value: m.not_reachable, tone: 'is-red' },
                { label: 'Wrong number', value: m.wrong_number, tone: 'is-neutral' },
              ].map((row) => {
                const share = totalCalled > 0 ? Math.round((row.value / totalCalled) * 100) : 0;
                return (
                  <li key={row.label}>
                    <span className={`k-dot ${row.tone}`} />
                    <span className="k-outcome-label">{row.label}</span>
                    <span className="k-outcome-value">{row.value.toLocaleString()}</span>
                    <span className="k-outcome-pct">{share}%</span>
                  </li>
                );
              })}
            </ul>

            <p className="k-footnote">Pending queue: {m.pending_calls.toLocaleString()} leads still to call.</p>
          </div>
        </section>

        {/* Recent calls */}
        <section className="k-card">
          <div className="k-card-head">
            <div>
              <h2 className="k-card-title">My recent calls</h2>
              <p className="k-card-sub">Newest first — open a row to log or update an outcome</p>
            </div>
            <div className="k-segmented" role="group" aria-label="Filter recent calls by outcome">
              {CALL_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`k-segment ${callFilter === f.key ? 'is-active' : ''}`}
                  onClick={() => setCallFilter(f.key)}
                  aria-pressed={callFilter === f.key}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {recent_calls.length === 0 ? (
            <EmptyPanel icon="call" text="No calls have been logged yet. Open the Calling Queue to start verifying leads." />
          ) : visibleCalls.length === 0 ? (
            <div className="k-table-empty">No calls logged with this outcome yet.</div>
          ) : (
            <div className="k-table-wrap">
              <table className="k-table">
                <thead>
                  <tr>
                    <th>Unique ID</th>
                    <th>Owner / contractor</th>
                    <th>Phone</th>
                    <th>Outcome</th>
                    <th>Last note</th>
                    <th>Called</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCalls.map((r) => {
                    const o = (r.owner_name_en || '').trim();
                    const isBad = (v: string) => !v || v.toLowerCase() === 'new' || v === r.unique_id;
                    const cleanOwner = !isBad(o) ? o : (!isBad((r.name || '').trim()) ? (r.name || '').trim() : '');
                    const status = r.telecaller_status || 'PENDING';
                    return (
                      <tr key={r.id} className="rowlink" onClick={() => setActiveRecord(r)}>
                        <td className="k-mono">{r.unique_id || `#${r.id}`}</td>
                        <td>
                          <div className="rec-text-cell" style={{ maxWidth: 200 }}>
                            <ExpandableCellText text={cleanOwner || null} maxChars={28} />
                          </div>
                        </td>
                        <td className="k-mono">{r.contact_number || r.site_contractor_architect_number || '—'}</td>
                        <td>{getStatusChip(status)}</td>
                        <td>
                          {r.telecaller_comment ? (
                            <div className="rec-text-cell" style={{ maxWidth: 240 }}>
                              <ExpandableCellText text={r.telecaller_comment} maxChars={38} />
                            </div>
                          ) : (
                            <span className="k-muted">—</span>
                          )}
                        </td>
                        <td className="k-muted" style={{ whiteSpace: 'nowrap' }}>
                          {r.telecaller_called_at ? formatDateTime(r.telecaller_called_at) : '—'}
                        </td>
                        <td className="num" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="k-row-action" onClick={() => setActiveRecord(r)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="k-table-foot">
            <span>Showing {visibleCalls.length.toLocaleString()} of {recent_calls.length.toLocaleString()} calls</span>
            <button type="button" className="k-link" onClick={() => navigate('/telecaller/records')}>
              See all calls
            </button>
          </div>
        </section>

        {activeRecord && (
          <TelecallerRecordModal
            key={activeRecord.id}
            record={activeRecord}
            onClose={() => setActiveRecord(null)}
            onUpdated={() => {
              loadData();
              setActiveRecord(null);
            }}
          />
        )}
      </div>
    </PageShell>
  );
}

function getStatusChip(st?: string | null) {
  if (!st || st === 'PENDING') {
    return <span className="k-status is-neutral">Pending</span>;
  }
  if (st === 'CONSTRUCTION_CONFIRMED') {
    return <span className="k-status is-green">Confirmed</span>;
  }
  if (st === 'CONNECTED_FOLLOW_UP') {
    return <span className="k-status is-blue">Follow-up</span>;
  }
  if (st === 'NOT_REACHABLE') {
    return <span className="k-status is-red">Not reachable</span>;
  }
  if (st === 'WRONG_NUMBER') {
    return <span className="k-status is-amber">Wrong number</span>;
  }
  const opt = TELECALLER_STATUS_OPTIONS.find((o) => o.value === st);
  return <span className="k-status is-neutral">{opt?.label || st}</span>;
}
