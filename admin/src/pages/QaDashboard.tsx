import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordsApi } from '../services/api';
import { useTopHeader } from '../context/HeaderContext';
import { Icon, PageShell } from '../components/ui';
import './Dashboard.css';

type DatePreset = 'allTime' | 'today' | 'thisWeek' | 'thisMonth';

function businessToday(): Date {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${date}T12:00:00`);
}

function startOfThisWeek(): Date {
  const now = businessToday();
  const diff = (now.getDay() + 6) % 7; // Monday start
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sample recent commercial records for the exclusive QC desk panel
const COMMERCIAL_HIGHLIGHTS = [
  { id: 'CBE-COMM-01', name: 'Grand City Commercial Hub', area: 'Gandhipuram, CBE', type: 'Mall & Commercial', contact: '+91 98421 54320', status: 'To review' },
  { id: 'CBE-COMM-02', name: 'Tristar Tech Towers Ph-2', area: 'Avinashi Road, CBE', type: 'IT Office Park', contact: '+91 94432 11090', status: 'Approved' },
  { id: 'CBE-COMM-03', name: 'Emerald Highline Towers', area: 'Saravanampatti, CBE', type: 'G+14 Residential Builder', contact: '+91 98940 33411', status: 'To review' },
  { id: 'CBE-COMM-04', name: 'Apex Industrial Logistics Park', area: 'Eachanari, CBE', type: 'Industrial Warehouse', contact: '+91 97890 88201', status: 'Approved' },
];

// Sample live audit decision stream
const RECENT_AUDIT_STREAM = [
  { id: 'CBE-546643', auditor: 'Priya S.', time: '2h ago', status: 'Approved', note: 'VHR confirms active G+2 framing, RCC columns poured' },
  { id: 'CBE-546621', auditor: 'Karthik R.', time: '4h ago', status: 'Disapproved', note: 'Vacant plot, no active construction visible on satellite' },
  { id: 'CBE-546590', auditor: 'Arun M.', time: '6h ago', status: 'Commercial', note: 'Commercial clearance approved for Big Builder Group' },
  { id: 'CHN-102941', auditor: 'Priya S.', time: '8h ago', status: 'Approved', note: 'Street View verified active roofing work on site' },
];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'allTime', label: 'All time' },
];

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export default function QaDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ total: number; done: number; pending: number; completion_rate: number; categories: { label: string; count: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [datePreset, setDatePreset] = useState<DatePreset>('allTime');
  const [searchCategory, setSearchCategory] = useState('');

  // Calculate API date parameters based on selected preset
  const dateParams = useMemo(() => {
    if (datePreset === 'allTime') return {};
    const now = businessToday();
    const todayStr = toISODate(now);
    if (datePreset === 'today') {
      return {
        date_from: `${todayStr}T00:00:00+05:30`,
        date_to: `${todayStr}T23:59:59.999+05:30`,
        date_field: 'assigned_at',
      };
    }
    if (datePreset === 'thisWeek') {
      const weekStartStr = toISODate(startOfThisWeek());
      return {
        date_from: `${weekStartStr}T00:00:00+05:30`,
        date_to: `${todayStr}T23:59:59.999+05:30`,
        date_field: 'assigned_at',
      };
    }
    if (datePreset === 'thisMonth') {
      const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return {
        date_from: `${monthStartStr}T00:00:00+05:30`,
        date_to: `${todayStr}T23:59:59.999+05:30`,
        date_field: 'assigned_at',
      };
    }
    return {};
  }, [datePreset]);

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">QC dashboard</h1>
        <p className="topbar-page-sub">Imagery and street-view review progress, findings and recent decisions.</p>
      </div>
    ),
    right: (
      <div className="k-head-actions">
        <div className="k-presets" role="group" aria-label="Filter by timeframe">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`k-preset ${datePreset === key ? 'is-active' : ''}`}
              onClick={() => setDatePreset(key)}
              aria-pressed={datePreset === key}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-sm k-cta" onClick={() => navigate('/audit')} title="Open QA review queue">
          <Icon name="fact_check" size={15} />
          <span>Start reviewing{data ? ` ${data.pending.toLocaleString()}` : ''}</span>
        </button>
        <button
          type="button"
          className="k-iconbtn"
          onClick={() => setRefresh((v) => v + 1)}
          title="Refresh quality metrics"
          aria-label="Refresh quality metrics"
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>
    ),
  }, [data?.pending, datePreset]);

  useEffect(() => {
    let active = true;
    const load = () =>
      recordsApi.qaDashboard(dateParams)
        .then(result => {
          if (active) {
            setData(result);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Could not load QC dashboard data. Click refresh to retry.');
        });

    void load();
    window.addEventListener('focus', load);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.clearInterval(timer);
    };
  }, [refresh, dateParams]);

  // Filter categories by search string
  const filteredCategories = useMemo(() => {
    if (!data?.categories) return [];
    if (!searchCategory.trim()) return data.categories;
    const q = searchCategory.toLowerCase();
    return data.categories.filter(c => c.label.toLowerCase().includes(q));
  }, [data, searchCategory]);

  const topFinding = data?.categories?.[0];
  const reviewedPct = data ? Math.min(100, Math.max(0, data.completion_rate)) : 0;

  return (
    <PageShell>
      <div className="k-dash">
        {error && (
          <div role="alert" className="alert alert-error">
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        {!data ? (
          <div className="k-card">
            <div className="k-card-empty">
              <Icon name="refresh" size={22} className="fos-spin" />
              <span>Loading quality metrics…</span>
            </div>
          </div>
        ) : (
          <>
            {/* KPI row */}
            <section className="k-kpis" aria-label="QC executive metrics">
              <button
                type="button"
                className="k-kpi is-total"
                onClick={() => navigate('/audit?qc_status=ALL')}
                title="View all records in QA queue"
              >
                <span className="k-kpi-label"><span className="k-dot is-neutral" />Assigned for QC</span>
                <span className="k-kpi-value">{data.total.toLocaleString()}</span>
                <span className="k-kpi-sub">All records in your queue</span>
              </button>

              <button
                type="button"
                className="k-kpi is-green"
                onClick={() => navigate('/audit?qc_status=DONE')}
                title="View completed QC records"
              >
                <span className="k-kpi-label"><span className="k-dot is-green" />Reviewed</span>
                <span className="k-kpi-value">{data.done.toLocaleString()}</span>
                <span className="k-kpi-sub">{data.completion_rate}% done</span>
              </button>

              <button
                type="button"
                className="k-kpi is-amber"
                onClick={() => navigate('/audit?qc_status=PENDING')}
                title="View pending QC records"
              >
                <span className="k-kpi-label"><span className="k-dot is-amber" />Awaiting review</span>
                <span className="k-kpi-value">{data.pending.toLocaleString()}</span>
                <span className="k-kpi-sub">Start with these</span>
              </button>

              <button
                type="button"
                className="k-kpi is-violet"
                onClick={() => navigate('/audit?search=Commercial')}
                title="View commercial properties in QC queue"
              >
                <span className="k-kpi-label"><span className="k-dot is-purple" />Commercial and builders</span>
                <span className="k-kpi-value">50</span>
                <span className="k-kpi-sub">QC only — no field visit</span>
              </button>
            </section>

            {/* Review progress + findings */}
            <section className="k-twocol">
              <div className="k-card">
                <div className="k-card-head">
                  <div>
                    <h2 className="k-card-title">Review progress</h2>
                    <p className="k-card-sub">{data.done.toLocaleString()} of {data.total.toLocaleString()} reviewed</p>
                  </div>
                  <span className="k-pill is-green">{data.completion_rate}% done</span>
                </div>

                <div className="k-progress is-lg">
                  <span className="k-progress-track">
                    <span className="k-progress-fill is-green" style={{ width: `${reviewedPct}%` }} />
                  </span>
                </div>

                <div className="k-strip is-three" style={{ marginTop: 16 }}>
                  <div className="k-mini">
                    <span className="k-mini-label">Reviewed today</span>
                    <span className="k-mini-value">{data.done.toLocaleString()}</span>
                    <span className="k-mini-note">Assessments completed</span>
                  </div>
                  <div className="k-mini is-orange">
                    <span className="k-mini-label">Still in queue</span>
                    <span className="k-mini-value">{data.pending.toLocaleString()}</span>
                    <span className="k-mini-note">Awaiting a decision</span>
                  </div>
                  <div className="k-mini is-blue">
                    <span className="k-mini-label">Total assigned</span>
                    <span className="k-mini-value">{data.total.toLocaleString()}</span>
                    <span className="k-mini-note">All QC records</span>
                  </div>
                </div>

                <p className="k-footnote">
                  {data.pending === 0
                    ? 'Queue is clear — every assigned record has a review decision.'
                    : `${data.pending.toLocaleString()} records still need a satellite review decision.`}
                </p>
              </div>

              <div className="k-card">
                <div className="k-card-head">
                  <div>
                    <h2 className="k-card-title">What reviewers found</h2>
                    <p className="k-card-sub">QC findings recorded on reviewed records</p>
                  </div>
                  <div className="k-inline-search">
                    <Icon name="search" size={14} />
                    <input
                      type="search"
                      placeholder="Search findings…"
                      value={searchCategory}
                      onChange={e => setSearchCategory(e.target.value)}
                      aria-label="Filter QC findings"
                    />
                    {searchCategory && (
                      <button type="button" onClick={() => setSearchCategory('')} aria-label="Clear search">
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="k-findings">
                  {filteredCategories.length > 0 ? (
                    filteredCategories.slice(0, 8).map((category) => {
                      const percent = data.done > 0 ? Math.round((category.count * 100) / data.done) : 0;
                      return (
                        <button
                          key={category.label}
                          type="button"
                          className="k-finding"
                          onClick={() => navigate(`/audit?search=${encodeURIComponent(category.label)}`)}
                          title={`View leads with finding: ${category.label}`}
                        >
                          <span className="k-finding-label">{category.label}</span>
                          <span className="k-finding-count">{category.count.toLocaleString()}</span>
                          <span className="k-finding-pct">{percent}%</span>
                          <span className="k-finding-track">
                            <span className="k-finding-fill" style={{ width: `${Math.max(3, Math.min(100, percent))}%` }} />
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="k-table-empty">No matching QC findings for “{searchCategory}”.</div>
                  )}
                </div>
              </div>
            </section>

            {/* Commercial queue + recent decisions */}
            <section className="k-twocol">
              <div className="k-card">
                <div className="k-card-head">
                  <div>
                    <h2 className="k-card-title">Commercial and big builders</h2>
                    <p className="k-card-sub">50 sites handled by QC only — not sent to field</p>
                  </div>
                  <button
                    type="button"
                    className="k-link"
                    onClick={() => navigate('/audit?search=Commercial')}
                  >
                    View all 50
                  </button>
                </div>

                <div className="k-table-wrap">
                  <table className="k-table">
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th className="num">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMMERCIAL_HIGHLIGHTS.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="k-cell-stack">
                              <span className="k-person-name">{c.name}</span>
                              <span className="k-person-role">{c.contact}</span>
                            </div>
                          </td>
                          <td>{c.area}</td>
                          <td><span className="k-role-tag is-purple">{c.type}</span></td>
                          <td>
                            <span className={`k-status ${c.status === 'Approved' ? 'is-green' : 'is-amber'}`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="num">
                            <button
                              type="button"
                              className="k-row-action"
                              onClick={() => navigate(`/audit?search=${encodeURIComponent(c.name)}`)}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="k-card">
                <div className="k-card-head">
                  <div>
                    <h2 className="k-card-title">Recent decisions</h2>
                    <p className="k-card-sub">Latest satellite review outcomes</p>
                  </div>
                  <span className="k-live"><span className="k-live-dot" />Live</span>
                </div>

                <ul className="k-stream">
                  {RECENT_AUDIT_STREAM.map((item) => (
                    <li key={item.id} className="k-stream-item">
                      <span className="k-stream-avatar">{initials(item.auditor)}</span>
                      <div className="k-stream-body">
                        <div className="k-stream-line">
                          <button
                            type="button"
                            className="k-stream-id"
                            onClick={() => navigate(`/audit?search=${encodeURIComponent(item.id)}`)}
                          >
                            {item.id}
                          </button>
                          <span className={`k-status ${item.status === 'Approved' ? 'is-green' : item.status === 'Disapproved' ? 'is-red' : 'is-purple'}`}>
                            {item.status}
                          </span>
                          <span className="k-stream-time">{item.time}</span>
                        </div>
                        <p className="k-stream-note">{item.note}</p>
                        <span className="k-stream-meta">Reviewed by {item.auditor}</span>
                      </div>
                    </li>
                  ))}
                </ul>

                {topFinding && (
                  <p className="k-footnote">Most common finding: {topFinding.label} ({topFinding.count.toLocaleString()} records).</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
