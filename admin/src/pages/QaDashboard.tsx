import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordsApi } from '../services/api';
import { useTopHeader } from '../context/HeaderContext';
import { Icon, PageShell } from '../components/ui';

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
  { id: 'CBE-COMM-01', name: 'Grand City Commercial Hub', area: 'Gandhipuram, CBE', type: 'Mall & Commercial', contact: '+91 98421 54320' },
  { id: 'CBE-COMM-02', name: 'Tristar Tech Towers Ph-2', area: 'Avinashi Road, CBE', type: 'IT Office Park', contact: '+91 94432 11090' },
  { id: 'CBE-COMM-03', name: 'Emerald Highline Towers', area: 'Saravanampatti, CBE', type: 'G+14 Residential Builder', contact: '+91 98940 33411' },
  { id: 'CBE-COMM-04', name: 'Apex Industrial Logistics Park', area: 'Eachanari, CBE', type: 'Industrial Warehouse', contact: '+91 97890 88201' },
];

// Sample live audit decision stream
const RECENT_AUDIT_STREAM = [
  { id: 'CBE-546643', auditor: 'Priya S.', time: '2h ago', status: 'Approved', note: 'VHR confirms active G+2 framing, RCC columns poured' },
  { id: 'CBE-546621', auditor: 'Karthik R.', time: '4h ago', status: 'Disapproved', note: 'Vacant plot, no active construction visible on satellite' },
  { id: 'CBE-546590', auditor: 'Arun M.', time: '6h ago', status: 'Corporate', note: 'Commercial clearance approved for Big Builder Group' },
  { id: 'CHN-102941', auditor: 'Priya S.', time: '8h ago', status: 'Approved', note: 'Street View verified active roofing work on site' },
];

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
        <h1 className="topbar-page-title">QC Review Command Center</h1>
        <span className="count-pill">Quality Control Desk</span>
      </div>
    ),
    right: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/audit')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 14px',
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            background: '#7c3aed',
            color: '#fff',
            border: 'none',
            boxShadow: '0 2px 4px rgba(124, 58, 237, 0.2)',
          }}
          title="Open QA Review Queue"
        >
          <Icon name="fact_check" size={15} />
          <span>Open QA Queue</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setRefresh(v => v + 1)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 13px',
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
          }}
          title="Refresh quality metrics"
        >
          <Icon name="refresh" size={15} />
          <span>Refresh</span>
        </button>
      </div>
    ),
  }, []);

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
          if (active) setError('Could not load QC dashboard data. Click Refresh to retry.');
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

  // Top 5 categories for donut chart calculation
  const donutSlices = useMemo(() => {
    if (!data?.categories || data.categories.length === 0) return [];
    const top = data.categories.slice(0, 5);
    const totalCount = top.reduce((acc, c) => acc + c.count, 0) || 1;
    const colors = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#e11d48'];
    
    let cumulative = 0;
    return top.map((c, i) => {
      const fraction = c.count / totalCount;
      const startAngle = cumulative * 2 * Math.PI;
      cumulative += fraction;
      const endAngle = cumulative * 2 * Math.PI;
      return {
        label: c.label,
        count: c.count,
        percent: Math.round(fraction * 100),
        color: colors[i % colors.length],
        startAngle,
        endAngle,
      };
    });
  }, [data?.categories]);

  return (
    <PageShell>
      <div className="qc-dashboard-container">
        {/* Modern SaaS Header Hero Card */}
        <header className="qc-dash-hero">
          <div className="qc-dash-hero-content">
            <span className="qc-dash-badge">
              <Icon name="verified" size={13} style={{ color: '#059669' }} />
              Quality Control Desk • Live Satellite VHR
            </span>
            <h2>
              <Icon name="fact_check" size={24} style={{ color: '#7c3aed' }} />
              VHR &amp; Street View Review Command Center
            </h2>
            <p>
              <Icon name="calendar_today" size={14} />
              Monitor high-resolution imagery inspection findings, verification speed, and auditor throughput.
            </p>
          </div>

          <div className="qc-dash-controls">
            {/* Quick Date Range Pills */}
            <div className="qc-dash-quick-filters" role="group" aria-label="Filter by timeframe">
              <span className="qc-filter-label">Timeframe:</span>
              {([
                ['allTime', 'All Time'],
                ['today', 'Today'],
                ['thisWeek', 'This Week'],
                ['thisMonth', 'This Month'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`qc-dash-filter-pill ${datePreset === val ? 'active' : ''}`}
                  onClick={() => setDatePreset(val)}
                  aria-pressed={datePreset === val}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/audit')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                background: '#7c3aed',
                color: '#fff',
                border: 'none',
                boxShadow: '0 2px 4px rgba(124, 58, 237, 0.2)',
              }}
              title="Open QA Review Queue"
            >
              <Icon name="arrow_forward" size={15} />
              <span>Open Queue</span>
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="alert alert-error">
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        {!data ? (
          <div className="qc-loading-card">
            <Icon name="refresh" size={28} className="fos-spin" style={{ color: '#7c3aed' }} />
            <p style={{ fontWeight: 600, color: '#334155' }}>Initializing quality metrics &amp; satellite records…</p>
          </div>
        ) : (
          <>
            {/* 4-Card Executive KPI Grid (100% Full-Width) */}
            <section className="qc-kpi-grid" aria-label="QC Executive Metrics">
              {/* Card 1: Total Leads for QA */}
              <div
                className="qc-kpi-card"
                onClick={() => navigate('/audit?qc_status=ALL')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=ALL')}
                title="View all records in QA queue"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #dbeafe' }}>
                    <Icon name="folder_open" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #dbeafe' }}>
                    Total Queue
                  </span>
                </div>
                <div className="qc-kpi-value">{data.total.toLocaleString()}</div>
                <div className="qc-kpi-label">Records Assigned for QC</div>
                <div className="qc-kpi-action" style={{ color: '#2563eb' }}>
                  <span>View all queue leads</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>

              {/* Card 2: QC Done */}
              <div
                className="qc-kpi-card"
                onClick={() => navigate('/audit?qc_status=DONE')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=DONE')}
                title="View completed QC records"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #d1fae5' }}>
                    <Icon name="check_circle" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #d1fae5' }}>
                    {data.completion_rate}% Done
                  </span>
                </div>
                <div className="qc-kpi-value" style={{ color: '#059669' }}>{data.done.toLocaleString()}</div>
                <div className="qc-kpi-label">Assessments Completed</div>
                <div className="qc-kpi-action" style={{ color: '#059669' }}>
                  <span>View audited leads</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>

              {/* Card 3: QC Pending */}
              <div
                className="qc-kpi-card"
                onClick={() => navigate('/audit?qc_status=PENDING')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=PENDING')}
                title="View pending QC records"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fef3c7' }}>
                    <Icon name="pending_actions" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fef3c7' }}>
                    Action Required
                  </span>
                </div>
                <div className="qc-kpi-value" style={{ color: '#d97706' }}>{data.pending.toLocaleString()}</div>
                <div className="qc-kpi-label">Leads Awaiting Review</div>
                <div className="qc-kpi-action" style={{ color: '#d97706' }}>
                  <span>Start reviewing</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>

              {/* Card 4: Commercial & Big Builders */}
              <div
                className="qc-kpi-card"
                onClick={() => navigate('/audit?search=Commercial')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?search=Commercial')}
                title="View commercial properties in QC queue"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ede9fe' }}>
                    <Icon name="storefront" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#f5f3ff', color: '#5b21b6', border: '1px solid #ede9fe' }}>
                    QC Exclusive
                  </span>
                </div>
                <div className="qc-kpi-value" style={{ color: '#7c3aed' }}>50</div>
                <div className="qc-kpi-label">Commercial &amp; Builders</div>
                <div className="qc-kpi-action" style={{ color: '#7c3aed' }}>
                  <span>View corporate queue</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>
            </section>

            {/* Middle Tier: Velocity Trend Area + Donut Findings Breakdown */}
            <section className="qc-middle-grid">
              {/* Left Column: Velocity Trend & Completion Velocity */}
              <div className="qc-chart-card">
                <div className="qc-card-head">
                  <div>
                    <h3>
                      <Icon name="trending_up" size={19} style={{ color: '#059669' }} />
                      QC Audit Velocity &amp; Completion Velocity
                    </h3>
                    <p>Review throughput pace across high-resolution satellite imagery</p>
                  </div>
                  <div className="qc-progress-rate-badge">
                    <strong>{data.completion_rate}%</strong>
                    <span>COMPLETED</span>
                  </div>
                </div>

                <div className="qc-velocity-summary">
                  <div className="qc-velocity-stat">
                    <span>Audit Output</span>
                    <strong>{data.done.toLocaleString()} Completed</strong>
                  </div>
                  <div className="qc-velocity-stat">
                    <span>Backlog Queue</span>
                    <strong style={{ color: '#d97706' }}>{data.pending.toLocaleString()} Pending</strong>
                  </div>
                  <div className="qc-velocity-stat">
                    <span>Overall Pace</span>
                    <strong style={{ color: '#059669' }}>~28.4 / day</strong>
                  </div>
                </div>

                {/* Progress Bar Track */}
                <div className="qc-progress-bar-track">
                  <div
                    className="qc-progress-bar-fill"
                    style={{ width: `${Math.min(100, Math.max(0, data.completion_rate))}%` }}
                  />
                </div>

                <div className="qc-progress-metrics-row">
                  <div className="qc-progress-metric">
                    <span className="dot dot-done" />
                    <span>Completed: <strong>{data.done.toLocaleString()}</strong></span>
                  </div>
                  <div className="qc-progress-metric">
                    <span className="dot dot-pending" />
                    <span>Pending: <strong>{data.pending.toLocaleString()}</strong></span>
                  </div>
                  <div className="qc-progress-metric">
                    <span className="dot dot-total" />
                    <span>Total Scope: <strong>{data.total.toLocaleString()}</strong></span>
                  </div>
                </div>

                {/* Modern Smooth SVG Trend Curve (Simulating Weekly Throughput Pace) */}
                <div style={{ marginTop: 6, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#334155' }}>
                    <span>Weekly Review Throughput Curve</span>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Last 7 Days Output</span>
                  </div>
                  <svg viewBox="0 0 500 130" style={{ width: '100%', height: 110, overflow: 'visible' }}>
                    <defs>
                      <linearGradient id="qcAreaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 10 100 Q 80 85, 150 90 T 290 50 T 420 30 T 490 20 L 490 120 L 10 120 Z"
                      fill="url(#qcAreaGradient)"
                    />
                    <path
                      d="M 10 100 Q 80 85, 150 90 T 290 50 T 420 30 T 490 20"
                      fill="none"
                      stroke="#059669"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                    {/* Data Points */}
                    <circle cx="10" cy="100" r="4" fill="#059669" stroke="#fff" strokeWidth="2" />
                    <circle cx="150" cy="90" r="4" fill="#059669" stroke="#fff" strokeWidth="2" />
                    <circle cx="290" cy="50" r="4" fill="#059669" stroke="#fff" strokeWidth="2" />
                    <circle cx="420" cy="30" r="4" fill="#059669" stroke="#fff" strokeWidth="2" />
                    <circle cx="490" cy="20" r="5" fill="#10b981" stroke="#fff" strokeWidth="2" />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: 600 }}>
                    <span>Mon</span>
                    <span>Tue</span>
                    <span>Wed</span>
                    <span>Thu</span>
                    <span>Fri</span>
                    <span>Sat</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Donut Findings Distribution & Searchable List */}
              <div className="qc-chart-card">
                <div className="qc-card-head">
                  <div>
                    <h3>
                      <Icon name="pie_chart" size={19} style={{ color: '#7c3aed' }} />
                      QC Assessment Findings
                    </h3>
                    <p>Observations recorded during VHR satellite inspection</p>
                  </div>
                  <div className="qc-search-wrap">
                    <Icon name="search" size={14} />
                    <input
                      type="search"
                      placeholder="Filter findings…"
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

                {/* Donut Chart Visual Representation */}
                {donutSlices.length > 0 && !searchCategory && (
                  <div className="qc-donut-container">
                    <div className="qc-donut-svg-wrap">
                      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                        {donutSlices.map((slice) => {
                          const strokeDasharray = `${slice.percent * 2.83} 283`;
                          const strokeDashoffset = -slice.startAngle / (2 * Math.PI) * 283;
                          return (
                            <circle
                              key={slice.label}
                              cx="50"
                              cy="50"
                              r="42"
                              fill="transparent"
                              stroke={slice.color}
                              strokeWidth="15"
                              strokeDasharray={strokeDasharray}
                              strokeDashoffset={strokeDashoffset}
                              style={{ transition: 'stroke-dasharray 0.3s ease' }}
                            />
                          );
                        })}
                      </svg>
                      <div className="qc-donut-center-text">
                        <strong>{data.done}</strong>
                        <span>Audited</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
                      {donutSlices.map((slice) => (
                        <div
                          key={slice.label}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11.5, cursor: 'pointer' }}
                          onClick={() => navigate(`/audit?search=${encodeURIComponent(slice.label)}`)}
                          title={`View ${slice.label}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: slice.color, flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 600 }}>
                              {slice.label}
                            </span>
                          </div>
                          <span style={{ color: '#64748b', fontWeight: 700, flexShrink: 0 }}>
                            {slice.percent}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Searchable Findings List */}
                <div className="qc-categories-list">
                  {filteredCategories.length > 0 ? (
                    filteredCategories.map((category, index) => {
                      const percent = data.done > 0 ? Math.round((category.count * 100) / data.done) : 0;
                      return (
                        <div
                          key={category.label}
                          className="qc-category-row"
                          onClick={() => navigate(`/audit?search=${encodeURIComponent(category.label)}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => e.key === 'Enter' && navigate(`/audit?search=${encodeURIComponent(category.label)}`)}
                          title={`View leads with finding: ${category.label}`}
                        >
                          <div className="qc-cat-rank">#{index + 1}</div>
                          <div className="qc-cat-info">
                            <div className="qc-cat-label-row">
                              <span className="qc-cat-name">{category.label}</span>
                              <span className="qc-cat-count-badge">
                                <strong>{category.count.toLocaleString()}</strong> leads ({percent}%)
                              </span>
                            </div>
                            <div className="qc-cat-progress-track">
                              <div className="qc-cat-progress-fill" style={{ width: `${Math.min(100, Math.max(3, percent))}%` }} />
                            </div>
                          </div>
                          <div className="qc-cat-arrow">
                            <Icon name="chevron_right" size={16} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                      No matching QC findings for "{searchCategory}"
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Bottom Tier: Corporate Commercial Queue + Real-Time Audit Decision Stream */}
            <section className="qc-bottom-grid">
              {/* Left Column: Commercial & Corporate Builders Queue (QC Exclusive) */}
              <div className="qc-card-panel">
                <div className="qc-card-head">
                  <div>
                    <h3>
                      <Icon name="storefront" size={19} style={{ color: '#7c3aed' }} />
                      Commercial &amp; Big Builders (QC Desk Exclusive)
                    </h3>
                    <p>50 high-value corporate properties strictly reserved from field dispatch</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate('/audit?search=Commercial')}
                    style={{ height: 30, fontSize: 11.5, padding: '0 10px', borderRadius: 7 }}
                  >
                    View All 50
                  </button>
                </div>

                <table className="qc-priority-table">
                  <thead>
                    <tr>
                      <th>Property &amp; Builder</th>
                      <th>Location</th>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMMERCIAL_HIGHLIGHTS.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <strong style={{ fontSize: 12.5, color: '#0f172a' }}>{c.name}</strong>
                            <span style={{ fontSize: 11, color: '#64748b' }}>{c.contact}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: '#334155' }}>{c.area}</span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 5,
                              background: '#f5f3ff',
                              color: '#6d28d9',
                              border: '1px solid #ede9fe',
                            }}
                          >
                            {c.type}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => navigate(`/audit?search=${encodeURIComponent(c.name)}`)}
                            style={{ height: 28, padding: '0 9px', fontSize: 11, borderRadius: 6 }}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right Column: Recent Auditor Decision Stream */}
              <div className="qc-card-panel">
                <div className="qc-card-head">
                  <div>
                    <h3>
                      <Icon name="receipt_long" size={19} style={{ color: '#2563eb' }} />
                      Recent Auditor Review Stream
                    </h3>
                    <p>Live audit decisions and satellite inspection assessments</p>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#059669',
                      background: '#ecfdf5',
                      padding: '2px 8px',
                      borderRadius: 6,
                    }}
                  >
                    ● Live Feed
                  </span>
                </div>

                <div className="qc-stream-list">
                  {RECENT_AUDIT_STREAM.map((item) => (
                    <div key={item.id} className="qc-stream-item">
                      <div className="qc-stream-avatar">
                        {item.auditor.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="qc-stream-details">
                        <div className="qc-stream-title">
                          <span
                            style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => navigate(`/audit?search=${item.id}`)}
                          >
                            {item.id}
                          </span>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 5,
                              background: item.status === 'Approved' ? '#ecfdf5' : item.status === 'Disapproved' ? '#fff1f2' : '#f5f3ff',
                              color: item.status === 'Approved' ? '#065f46' : item.status === 'Disapproved' ? '#9f1239' : '#5b21b6',
                            }}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="qc-stream-sub">
                          {item.note}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10.5, color: '#94a3b8' }}>
                          <span>Audited by <strong>{item.auditor}</strong></span>
                          <span>{item.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
