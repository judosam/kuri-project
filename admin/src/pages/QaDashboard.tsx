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
        <h1 className="topbar-page-title">QC Dashboard</h1>
        <span className="count-pill">Quality Review</span>
      </div>
    ),
    right: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/audit')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 11, height: 30, borderRadius: 6 }}
        >
          <Icon name="fact_check" size={14} />
          <span>Open QA Queue</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setRefresh(v => v + 1)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: 11, height: 30, borderRadius: 6 }}
          title="Refresh quality metrics"
        >
          <Icon name="refresh" size={14} />
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

  return (
    <PageShell>
      <div className="qc-dashboard-container">
        {/* Header Hero */}
        <div className="qc-dash-hero">
          <div className="qc-dash-hero-content">
            <span className="qc-dash-badge">
              <Icon name="verified" size={13} style={{ color: '#059669' }} />
              Quality Control Desk
            </span>
            <h2>VHR &amp; Street View Review Dashboard</h2>
            <p>Monitor high-resolution imagery inspection findings, verification speed, and auditor throughput.</p>
          </div>

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
        </div>

        {error && (
          <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        {!data ? (
          <div className="qc-loading-card">
            <Icon name="refresh" size={24} className="fos-spin" style={{ color: '#bf3646' }} />
            <p>Loading quality metrics…</p>
          </div>
        ) : (
          <>
            {/* KPI Stat Cards Grid */}
            <div className="qc-kpi-grid">
              {/* Total Leads for QA */}
              <div
                className="qc-kpi-card qc-kpi-total"
                onClick={() => navigate('/audit?qc_status=ALL')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=ALL')}
                title="View all records in QA queue"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#f1f5f9', color: '#334155' }}>
                    <Icon name="folder_open" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#f1f5f9', color: '#475569' }}>Total Queue</span>
                </div>
                <div className="qc-kpi-value">{data.total.toLocaleString()}</div>
                <div className="qc-kpi-label">Records assigned for QC</div>
                <div className="qc-kpi-action">
                  <span>View all leads</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>

              {/* QC Done */}
              <div
                className="qc-kpi-card qc-kpi-done"
                onClick={() => navigate('/audit?qc_status=DONE')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=DONE')}
                title="View completed QC records"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
                    <Icon name="check_circle" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#ecfdf5', color: '#065f46' }}>
                    {data.completion_rate}% Done
                  </span>
                </div>
                <div className="qc-kpi-value" style={{ color: '#059669' }}>{data.done.toLocaleString()}</div>
                <div className="qc-kpi-label">Assessments completed</div>
                <div className="qc-kpi-action" style={{ color: '#059669' }}>
                  <span>View completed</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>

              {/* QC Pending */}
              <div
                className="qc-kpi-card qc-kpi-pending"
                onClick={() => navigate('/audit?qc_status=PENDING')}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/audit?qc_status=PENDING')}
                title="View pending QC records"
              >
                <div className="qc-kpi-header">
                  <div className="qc-kpi-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
                    <Icon name="pending_actions" size={20} />
                  </div>
                  <span className="qc-kpi-tag" style={{ background: '#fffbeb', color: '#b45309' }}>
                    Action Required
                  </span>
                </div>
                <div className="qc-kpi-value" style={{ color: '#d97706' }}>{data.pending.toLocaleString()}</div>
                <div className="qc-kpi-label">Leads awaiting QC review</div>
                <div className="qc-kpi-action" style={{ color: '#d97706' }}>
                  <span>Start reviewing</span>
                  <Icon name="arrow_forward" size={13} />
                </div>
              </div>
            </div>

            {/* Completion Velocity Bar */}
            <div className="qc-progress-card">
              <div className="qc-progress-header">
                <div>
                  <h3>QC Review Completion Velocity</h3>
                  <p>Overall progress across all assigned records</p>
                </div>
                <div className="qc-progress-rate-badge">
                  <strong>{data.completion_rate}%</strong>
                  <span>completed</span>
                </div>
              </div>

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
                  <span>Total: <strong>{data.total.toLocaleString()}</strong></span>
                </div>
              </div>
            </div>

            {/* Assessment Categories Breakdown */}
            <div className="qc-categories-card">
              <div className="qc-categories-header">
                <div>
                  <h3>QC Assessment Findings Breakdown</h3>
                  <p>Common findings recorded during high-resolution satellite imagery inspection</p>
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

              {filteredCategories.length > 0 ? (
                <div className="qc-categories-list">
                  {filteredCategories.map((category, index) => {
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
                  })}
                </div>
              ) : (
                <div className="qc-empty-categories">
                  <Icon name="info" size={24} style={{ color: '#94a3b8' }} />
                  <p>{searchCategory ? 'No findings match your search.' : 'No completed QC assessments yet. Open the QA queue to start reviewing.'}</p>
                </div>
              )}
            </div>

            {/* Bottom Quick Action Banner */}
            <div className="qc-dash-footer-banner">
              <div>
                <h4>Ready to perform assessments?</h4>
                <p>Open the audit queue to inspect satellite imagery and record VHR comments.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/audit?qc_status=PENDING')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 8 }}
              >
                <Icon name="fact_check" size={16} />
                <span>Review Pending Queue ({data.pending.toLocaleString()})</span>
              </button>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
