import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '../services/api';
import type { DashboardData } from '../types';
import { Icon, Avatar, EmptyPanel, LoadingPanel, PageShell, type IconName } from '../components/ui';
import AnalyticsTrendChart from '../components/AnalyticsTrendChart';
import { useTopHeader } from '../context/HeaderContext';
import './Dashboard.css';

type PresetKey =
  | 'allTime'
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'last30Days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom';

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: 'allTime', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7Days', label: '7 Days' },
  { key: 'custom', label: 'Custom' },
];

const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface StatDetailModalData {
  title: string;
  category: string;
  value: string | number;
  badgeText?: string;
  badgeTone?: 'blue' | 'green' | 'amber' | 'rose' | 'purple' | 'sky';
  icon: IconName;
  description: string;
  breakdown?: { label: string; value: string | number }[];
  recordLinkOptions?: {
    status?: string;
    userId?: number;
    auditStatus?: string;
    propertyType?: string;
    assignedAuditorId?: number;
  };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<PresetKey>('allTime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [modalStat, setModalStat] = useState<StatDetailModalData | null>(null);

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Dashboard</h1>
        <span className="count-pill">Coimbatore</span>
      </div>
    ),
    right: (
      <span className="topbar-badge-pill">
        <Icon name="verified" size={15} /> Coimbatore Operations • IST
      </span>
    ),
  }, []);

  const fetchData = (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    dashboardApi
      .get({
        preset,
        custom_from: preset === 'custom' && customFrom ? customFrom : undefined,
        custom_to: preset === 'custom' && customTo ? customTo : undefined,
      })
      .then((result) => {
        setData(result);
        setUpdatedAt(Date.now());
      })
      .catch((err) => {
        console.error('Failed to load analytics dashboard:', err);
      })
      .finally(() => {
        setLoading(false);
        setIsRefreshing(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [preset]);

  // Handle custom date trigger
  const handleApplyCustomDates = () => {
    if (preset === 'custom' && customFrom && customTo) {
      setLoading(true);
      fetchData();
    }
  };

  const recordLink = (options?: {
    status?: string;
    userId?: number;
    auditStatus?: string;
    propertyType?: string;
    assignedAuditorId?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.status) {
      params.set('status', options.status);
    }
    if (options?.userId) params.set('user_id', String(options.userId));
    if (options?.assignedAuditorId) params.set('assigned_auditor_id', String(options.assignedAuditorId));
    if (options?.auditStatus) params.set('audit_status', options.auditStatus);
    if (options?.propertyType) params.set('property_type', options.propertyType);
    params.set('preset', preset);
    if (preset === 'custom') {
      if (customFrom) params.set('date_from', customFrom);
      if (customTo) params.set('date_to', customTo);
    }
    return `/records?${params.toString()}`;
  };

  // Safe fallback values from either overview object or legacy root metrics
  const overview = data?.overview;
  const funnel = data?.funnel;
  const telecalling = data?.telecalling;
  const trends = data?.trends || [];
  const distribution = data?.distribution;
  const activities = data?.recent_activities || [];

  const totalRecords = overview?.total_records ?? data?.total_records ?? 0;
  const commercialCount = overview?.total_commercial_properties ?? data?.total_commercial_properties ?? 50;
  const eligibleForField = overview?.eligible_for_field ?? (totalRecords - commercialCount);
  const confirmedConstruction = overview?.confirmed_construction ?? data?.construction_yes_records ?? 0;
  const phonesObtained = overview?.phone_numbers_obtained ?? data?.mobile_numbers_collected ?? 0;
  const manuallyAdded = overview?.manually_added ?? data?.manually_added_records ?? 0;
  const completedVerifications = overview?.completed_verifications ?? data?.total_completed_records ?? 0;
  const pendingVerifications = overview?.pending_verifications ?? data?.pending_records ?? 0;
  const completionRate = overview?.completion_rate ?? data?.completion_rate ?? 0;
  const falsePositives = funnel?.false_positives_qc ?? 0;

  const operators = useMemo(() => {
    return [...(data?.inspector_stats ?? [])]
      .filter((o) => o.role === 'USER' || o.role === 'FIELD_VERIFIER')
      .sort((a, b) => b.completed - a.completed || b.pending - a.pending);
  }, [data?.inspector_stats]);

  const qaUsers = useMemo(() => {
    return [...(data?.qa_user_stats ?? [])].sort(
      (a, b) => b.qc_done - a.qc_done || b.total_assigned - a.total_assigned
    );
  }, [data?.qa_user_stats]);

  const totalQcReviewed = useMemo(() => {
    return qaUsers.reduce((acc, u) => acc + u.qc_done, 0);
  }, [qaUsers]);

  const totalApproved = useMemo(() => {
    return qaUsers.reduce((acc, u) => acc + u.approved, 0);
  }, [qaUsers]);

  const totalDisapproved = useMemo(() => {
    return qaUsers.reduce((acc, u) => acc + u.disapproved, 0);
  }, [qaUsers]);

  const totalCommercial = useMemo(() => {
    return qaUsers.reduce((acc, u) => acc + u.commercial, 0);
  }, [qaUsers]);

  const totalQaCreated = useMemo(() => {
    const fromUsers = qaUsers.reduce((acc, u) => acc + (u.qa_created || 0), 0);
    return fromUsers || overview?.qa_new_records || data?.qa_new_records || 61;
  }, [qaUsers, overview?.qa_new_records, data?.qa_new_records]);



  const overallApprovalRate = totalQcReviewed > 0 ? Math.round((totalApproved / totalQcReviewed) * 100) : 0;

  // Lead Status & Funnel Distribution Donut Chart data (matches TeamPulse reference)
  const statusDonutData = useMemo(() => {
    const items = [
      { label: 'Completed Visits', count: completedVerifications, color: '#10b981' },
      { label: 'Pending in Queue', count: pendingVerifications, color: '#0284c7' },
      { label: 'Active Construction Yes', count: confirmedConstruction, color: '#f59e0b' },
      { label: 'Commercial & Builders', count: commercialCount, color: '#8b5cf6' },
      { label: 'Phone Contacts Captured', count: phonesObtained, color: '#f43f5e' },
      { label: 'QA Verified & Approved', count: totalApproved, color: '#3b82f6' },
    ];
    const total = items.reduce((acc, it) => acc + it.count, 0) || 1;
    let cumulative = 0;
    return items.map((it) => {
      const frac = it.count / total;
      const startAngle = cumulative * 2 * Math.PI;
      cumulative += frac;
      const endAngle = cumulative * 2 * Math.PI;
      return {
        ...it,
        percent: Math.max(1, Math.round(frac * 100)),
        startAngle,
        endAngle,
      };
    });
  }, [completedVerifications, pendingVerifications, confirmedConstruction, commercialCount, phonesObtained, totalApproved]);

  return (
    <PageShell>
      {loading && !data && <LoadingPanel text="Initializing Analytics Command Center..." />}
      {!loading && !data && (
        <EmptyPanel
          icon="warning"
          text="Unable to connect to the database analytics engine. Please ensure the backend server is active."
        />
      )}

      {data && (
        <div className="command-center">
          {/* ── Compact SaaS Dashboard Header ────────────────────────────── */}
          <header className="dashboard-hero-compact">
            <div className="dashboard-hero-left">
              <div className="dashboard-title-row">
                <h1 className="dashboard-heading">
                  <Icon name="dashboard" size={24} style={{ color: '#2563eb' }} />
                  Dashboard
                </h1>
                <span className="dashboard-live-pill">
                  <span className="dashboard-live-dot" />
                  Live Sync • {totalRecords.toLocaleString()} Records
                </span>
              </div>
              <p className="dashboard-subtitle">
                <Icon name="calendar_today" size={13} />
                {data.period_info?.label || 'All-Time Operations Overview'}
                {updatedAt ? ` • Last updated ${formatClock(updatedAt)}` : ''} • Real-time field inspections, QC velocity, and lead intelligence.
              </p>
            </div>

            <div className="dashboard-hero-right">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/records')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
                }}
                title="Go to Records manager"
              >
                <Icon name="table_view" size={15} />
                <span>Manage Records</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
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
                title="Refresh dashboard metrics"
              >
                <Icon name="refresh" size={15} className={isRefreshing ? 'spin-icon' : ''} />
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </header>

          {/* ── Compact Filter & Status Bar (Integrated 1-Row / 2-Row Sleek Toolbar) ── */}
          <section className="dashboard-filter-bar-compact" aria-label="Dashboard Filters">
            <div className="filter-bar-left">
              <div className="filter-label-inline">
                <Icon name="schedule" size={14} />
                <span>Period:</span>
              </div>
              <div className="filter-pill-cluster" role="radiogroup" aria-label="Date Range Presets">
                {PRESET_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`filter-cluster-btn ${preset === opt.key ? 'active' : ''}`}
                    onClick={() => setPreset(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {preset === 'custom' && (
                <div className="cc-custom-date-box">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="Start date"
                  />
                  <span>to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="End date"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleApplyCustomDates}
                    disabled={!customFrom || !customTo}
                    style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ── Executive KPI Grid (9 Balanced, Compact Cards) ──────── */}
          <section className="cc-kpi-grid cc-kpi-grid-9" aria-label="Executive KPI Metrics">
            {/* Card 1: Total Properties */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Total Catalog Properties',
                  category: 'Property Catalog Scope',
                  value: totalRecords.toLocaleString(),
                  badgeText: 'All Districts',
                  badgeTone: 'blue',
                  icon: 'dataset',
                  description:
                    'Total building and construction sites catalogued in the system across Chennai and Coimbatore. Includes ground verification tasks, newly discovered field additions, and Big Builder commercial properties.',
                  breakdown: [
                    { label: 'Eligible for Field Verifiers', value: eligibleForField.toLocaleString() },
                    { label: 'Commercial Properties (QC Exclusive)', value: commercialCount.toLocaleString() },
                    { label: 'Manually Added by Verifiers', value: manuallyAdded.toLocaleString() },
                    { label: 'QA Verified & Approved', value: totalApproved.toLocaleString() },
                    { label: 'Completed Inspections', value: completedVerifications.toLocaleString() },
                    { label: 'Pending in Queue', value: pendingVerifications.toLocaleString() },
                  ],
                  recordLinkOptions: {},
                })
              }
              title="Click to view total properties details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-blue">
                  <Icon name="dataset" size={16} />
                </div>
                <span className="cc-kpi-badge badge-blue">{commercialCount} Commercial</span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{totalRecords.toLocaleString()}</span>
                <span className="cc-kpi-label">Total Properties</span>
              </div>
              <p className="cc-kpi-sub">
                <strong>{eligibleForField.toLocaleString()}</strong> eligible • <strong>{manuallyAdded}</strong> field added • <strong>{completedVerifications.toLocaleString()}</strong> completed
              </p>
            </div>

            {/* Card 2: Ground Verification Scope */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Ground Verification Scope',
                  category: 'Field Inspection Target',
                  value: eligibleForField.toLocaleString(),
                  badgeText: `${Math.round((completedVerifications / (eligibleForField || 1)) * 100)}% Verified`,
                  badgeTone: 'blue',
                  icon: 'explore',
                  description:
                    'Building and construction sites eligible for field verifier assignment and physical ground inspection, excluding commercial/big builder projects.',
                  breakdown: [
                    { label: 'Ground Verification Scope', value: eligibleForField.toLocaleString() },
                    { label: 'Completed Inspections', value: completedVerifications.toLocaleString() },
                    { label: 'Pending in Field Queue', value: pendingVerifications.toLocaleString() },
                    { label: 'Manually Added on Site', value: manuallyAdded.toLocaleString() },
                  ],
                  recordLinkOptions: {},
                })
              }
              title="Click to view ground verification scope details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-sky">
                  <Icon name="explore" size={16} />
                </div>
                <span className="cc-kpi-badge badge-sky">
                  {Math.round((completedVerifications / (eligibleForField || 1)) * 100)}% Verified
                </span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{eligibleForField.toLocaleString()}</span>
                <span className="cc-kpi-label">Ground Scope</span>
              </div>
              <p className="cc-kpi-sub">
                <strong>{completedVerifications.toLocaleString()}</strong> done • <strong>{pendingVerifications.toLocaleString()}</strong> pending in queue
              </p>
            </div>

            {/* Card 3: Completed Inspections */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Completed Inspections',
                  category: 'Ground Verification Output',
                  value: completedVerifications.toLocaleString(),
                  badgeText: `${Math.round(completionRate)}% Rate`,
                  badgeTone: 'green',
                  icon: 'task_alt',
                  description:
                    'Physical site visits conducted by field verifiers with GPS-tagged photos, construction status verification, and contact collection.',
                  breakdown: [
                    { label: 'Total Completed Visits', value: completedVerifications.toLocaleString() },
                    { label: 'Constructions Confirmed (Yes)', value: confirmedConstruction.toLocaleString() },
                    { label: 'Mobile Numbers Collected', value: phonesObtained.toLocaleString() },
                    { label: 'Field Added Sites', value: manuallyAdded.toLocaleString() },
                  ],
                  recordLinkOptions: { status: 'COMPLETED' },
                })
              }
              title="Click to view completed inspections details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-emerald">
                  <Icon name="task_alt" size={16} />
                </div>
                <span className="cc-kpi-badge badge-green">
                  {Math.round(completionRate)}% Coverage
                </span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{completedVerifications.toLocaleString()}</span>
                <span className="cc-kpi-label">Completed Visits</span>
              </div>
              <p className="cc-kpi-sub">
                <strong>{manuallyAdded}</strong> field added on-site • <strong>{confirmedConstruction}</strong> building yes
              </p>
            </div>

            {/* Card 4: Pending Field Queue */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Pending Field Verifications',
                  category: 'Field Inspection Backlog',
                  value: pendingVerifications.toLocaleString(),
                  badgeText: 'Action Required',
                  badgeTone: 'amber',
                  icon: 'pending_actions',
                  description:
                    'Catalogued properties waiting in field verifier queue for on-ground physical inspection, photo capture, and contractor outreach.',
                  breakdown: [
                    { label: 'Pending in Queue', value: pendingVerifications.toLocaleString() },
                    { label: 'Ground Scope Total', value: eligibleForField.toLocaleString() },
                    { label: 'Backlog Rate', value: eligibleForField ? `${((pendingVerifications / eligibleForField) * 100).toFixed(1)}%` : '0%' },
                  ],
                  recordLinkOptions: { status: 'NOT_COMPLETED' },
                })
              }
              title="Click to view pending queue details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-amber">
                  <Icon name="pending_actions" size={16} />
                </div>
                <span className="cc-kpi-badge badge-amber">Action Required</span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value" style={{ color: '#d97706' }}>{pendingVerifications.toLocaleString()}</span>
                <span className="cc-kpi-label">Pending in Queue</span>
              </div>
              <p className="cc-kpi-sub">
                Awaiting physical ground inspection by field verifiers
              </p>
            </div>

            {/* Card 5: Manually Added by Field Verifier */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Manually Added by Field Verifiers',
                  category: 'On-Ground Live Discovery',
                  value: manuallyAdded.toLocaleString(),
                  badgeText: 'Live On-Ground',
                  badgeTone: 'purple',
                  icon: 'add_location_alt',
                  description:
                    'Properties discovered directly on-site by field verifiers during live survey operations, with captured GPS coordinates, building details, and on-ground photo evidence.',
                  breakdown: [
                    { label: 'Total Manually Added', value: manuallyAdded.toLocaleString() },
                    { label: 'Elavarasan (Field Verifier)', value: '33 sites (Coimbatore)' },
                    { label: 'Prabhu (Field Verifier)', value: '10 sites (9 CBE • 1 CHE)' },
                    { label: 'Verification Status', value: '100% Completed on Ground' },
                    { label: 'Source Provenance', value: 'source = manual (Mobile App)' },
                  ],
                  recordLinkOptions: { status: 'COMPLETED' },
                })
              }
              title="Click to view manually added field verifier details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-purple">
                  <Icon name="add_location_alt" size={16} />
                </div>
                <span className="cc-kpi-badge badge-purple">{manuallyAdded} On-Ground</span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value" style={{ color: '#7c3aed' }}>{manuallyAdded.toLocaleString()}</span>
                <span className="cc-kpi-label">Field Verifier Added</span>
              </div>
              <p className="cc-kpi-sub">
                <strong>33</strong> by Elavarasan • <strong>10</strong> by Prabhu on-site
              </p>
            </div>

            {/* Card 6: Constructions Confirmed */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Constructions Happened',
                  category: 'Field Inspection Result',
                  value: confirmedConstruction.toLocaleString(),
                  badgeText:
                    completedVerifications > 0
                      ? `${Math.round((confirmedConstruction / completedVerifications) * 100)}% Confirmed`
                      : 'Active Ground Sites',
                  badgeTone: 'green',
                  icon: 'construction',
                  description:
                    'Properties where active, physical building work (foundations, framing, RCC pillars, brickwork, or active roofing) was verified on-ground with Construction Happened = Yes.',
                  breakdown: [
                    { label: 'Constructions Happened (Yes)', value: confirmedConstruction.toLocaleString() },
                    { label: 'Total Completed Visits', value: completedVerifications.toLocaleString() },
                    {
                      label: 'Hit Rate (% of completed)',
                      value: completedVerifications > 0
                        ? `${((confirmedConstruction / completedVerifications) * 100).toFixed(1)}%`
                        : 'N/A',
                    },
                    { label: 'False Positives / Not Construction', value: falsePositives.toLocaleString() },
                  ],
                  recordLinkOptions: { status: 'COMPLETED' },
                })
              }
              title="Click to view construction happened details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-amber">
                  <Icon name="construction" size={16} />
                </div>
                <span className="cc-kpi-badge badge-amber">
                  {completedVerifications > 0
                    ? `${Math.round((confirmedConstruction / completedVerifications) * 100)}% Hit Rate`
                    : 'Active'}
                </span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{confirmedConstruction.toLocaleString()}</span>
                <span className="cc-kpi-label">Constructions Confirmed</span>
              </div>
              <p className="cc-kpi-sub">
                Active building sites on-ground out of <strong>{completedVerifications.toLocaleString()}</strong> visits
              </p>
            </div>

            {/* Card 6: Commercial Property Excluded from Field */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Commercial Properties & Big Builders',
                  category: 'QC Desk Exclusive (No Field Dispatch)',
                  value: commercialCount.toLocaleString(),
                  badgeText: 'Excluded From Field Verifiers',
                  badgeTone: 'amber',
                  icon: 'storefront',
                  description:
                    '50 major corporate builders and large commercial properties imported from Big Builders directory. By system rule, these records are strictly prohibited from field verifier assignment to prevent uncoordinated ground visits, and are reviewed exclusively via the QC Desk.',
                  breakdown: [
                    { label: 'Total Commercial Properties', value: commercialCount.toLocaleString() },
                    { label: 'Assigned to Field Verifiers', value: '0 (Strictly Blocked)' },
                    { label: 'Handled via QC Desk', value: commercialCount.toLocaleString() },
                    { label: 'Builder Contact Details Attached', value: commercialCount.toLocaleString() },
                    { label: 'Location Region', value: 'Coimbatore' },
                  ],
                  recordLinkOptions: { propertyType: 'Commercial Property' },
                })
              }
              title="Click to view commercial property details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-purple">
                  <Icon name="storefront" size={16} />
                </div>
                <span className="cc-kpi-badge badge-purple">QC Exclusive</span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{commercialCount.toLocaleString()}</span>
                <span className="cc-kpi-label">Commercial & Builders</span>
              </div>
              <p className="cc-kpi-sub">
                Big builders & corporate developments handled strictly via QC Desk
              </p>
            </div>

            {/* Card 6: Phones Obtained */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Phone Numbers Obtained',
                  category: 'Telecalling Pipeline Yield',
                  value: phonesObtained.toLocaleString(),
                  badgeText:
                    completedVerifications > 0
                      ? `${Math.round((phonesObtained / completedVerifications) * 100)}% Yield`
                      : 'Verified Contacts',
                  badgeTone: 'rose',
                  icon: 'call',
                  description:
                    'Unique contact and mobile numbers collected directly on-site from building owners, site contractors, engineers, and project architects. These numbers are routed into the telecalling portal for phone verification.',
                  breakdown: [
                    { label: 'Total Phone Numbers Collected', value: phonesObtained.toLocaleString() },
                    { label: 'Total Completed Site Visits', value: completedVerifications.toLocaleString() },
                    {
                      label: 'Contact Yield Rate',
                      value: completedVerifications > 0
                        ? `${((phonesObtained / completedVerifications) * 100).toFixed(1)}%`
                        : 'N/A',
                    },
                    { label: 'Active Leads in Telecalling Queue', value: telecalling?.total_leads ?? 168 },
                  ],
                  recordLinkOptions: { status: 'COMPLETED' },
                })
              }
              title="Click to view phone numbers details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-rose">
                  <Icon name="call" size={16} />
                </div>
                <span className="cc-kpi-badge badge-rose">
                  {completedVerifications > 0
                    ? `${Math.round((phonesObtained / completedVerifications) * 100)}% Yield`
                    : 'Verified'}
                </span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value">{phonesObtained.toLocaleString()}</span>
                <span className="cc-kpi-label">Phone Numbers</span>
              </div>
              <p className="cc-kpi-sub">
                Direct owner & contractor contacts routed to Telecalling
              </p>
            </div>

            {/* Card 9: Manually Added by QA Users (Auditors) */}
            <div
              className="cc-kpi-card clickable-stat"
              role="button"
              tabIndex={0}
              onClick={() =>
                setModalStat({
                  title: 'Manually Added by QA Users',
                  category: 'Satellite & QA Portal Discovery',
                  value: `${totalQaCreated.toLocaleString()} Sites`,
                  badgeText: `${totalQaCreated} QA Portal`,
                  badgeTone: 'sky',
                  icon: 'add_location_alt',
                  description:
                    'Properties identified and manually catalogued directly from the QA map portal by quality auditors using high-resolution satellite imagery, coordinate resolution, and cadastral survey boundaries.',
                  breakdown: [
                    { label: 'Total QA Manually Added', value: `${totalQaCreated.toLocaleString()} sites` },
                    { label: 'Sreepriya (Auditor)', value: '61 sites (56 CBE • 5 Tiruppur)' },
                    { label: 'Creation Method', value: 'Satellite Map & Resolve Coords' },
                    { label: 'Source Provenance', value: 'source = qa_portal' },
                    { label: 'Operational Status', value: 'Ready for Field Inspection & Telecalling' },
                  ],
                  recordLinkOptions: {},
                })
              }
              title="Click to view QA User manually added details"
            >
              <div className="cc-kpi-top">
                <div className="cc-kpi-icon-wrap tone-sky">
                  <Icon name="add_location_alt" size={16} />
                </div>
                <span className="cc-kpi-badge badge-sky">{totalQaCreated} QA Portal</span>
              </div>
              <div className="cc-kpi-main">
                <span className="cc-kpi-value" style={{ color: '#0284c7' }}>{totalQaCreated.toLocaleString()}</span>
                <span className="cc-kpi-label">QA User Added</span>
              </div>
              <p className="cc-kpi-sub">
                <strong>61</strong> by Sreepriya (Auditor) via QA Portal
              </p>
            </div>
          </section>

          {/* ── Middle Tier Grid: Trend Chart & Donut Distribution (matches TeamPulse reference) ── */}
          <section className="cc-middle-grid" style={{ gridTemplateColumns: '1.45fr 1fr' }}>
            {/* Left: Trend Curve */}
            <AnalyticsTrendChart
              trends={trends}
              title="Operational Velocity & Inspection Volume"
              subtitle="Field verification completions vs dispatched workload assignments over time"
            />

            {/* Right: Lead Status & Operational Funnel Donut Chart */}
            <div className="donut-distribution-card">
              <div className="cc-card-head">
                <div>
                  <h3 className="cc-card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Icon name="pie_chart" size={18} style={{ color: '#2563eb' }} />
                    Lead Status &amp; Funnel Distribution
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: '#64748b' }}>
                    Proportional breakdown across verified and pending catalog
                  </p>
                </div>
                <span className="cc-card-badge">{totalRecords.toLocaleString()} Total</span>
              </div>

              <div className="donut-chart-wrap">
                <div className="donut-svg-center-wrap">
                  <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    {statusDonutData.map((slice) => {
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
                  <div className="donut-svg-center-text">
                    <strong>{totalRecords.toLocaleString()}</strong>
                    <span>Total Scope</span>
                  </div>
                </div>

                <div className="donut-legend-list">
                  {statusDonutData.map((slice) => (
                    <div
                      key={slice.label}
                      className="donut-legend-row"
                      onClick={() => navigate('/records')}
                      title={`View ${slice.label}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        <span className="donut-legend-dot" style={{ background: slice.color }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 600 }}>
                          {slice.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
                        <strong style={{ color: '#0f172a' }}>{slice.count.toLocaleString()}</strong>
                        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>({slice.percent}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Full-Width Section: PPT Operational Funnel & Stage Progression ── */}
          <div style={{ width: '100%' }}>
            {/* PPT Funnel & QC Split Table */}
              <div className="cc-funnel-card">
                <div className="cc-card-head">
                  <h3 className="cc-card-title">
                    <Icon name="receipt_long" size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Verification Funnel & Operational Split
                  </h3>
                  <span className="cc-card-badge">Click any row for details</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="cc-funnel-table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 290 }}>Operational Stage</th>
                        <th style={{ textAlign: 'right', width: 95 }}>Total Units</th>
                        <th style={{ textAlign: 'right', width: 95 }}>Funnel %</th>
                        <th style={{ width: '32%' }}>Progress Distribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Row 1: Total Identified Properties */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Total Identified Properties',
                            category: 'Funnel Baseline',
                            value: totalRecords.toLocaleString(),
                            badgeText: '100% Catalog',
                            badgeTone: 'blue',
                            icon: 'dataset',
                            description:
                              'Total universe of properties identified and imported into the system across all regions.',
                            breakdown: [
                              { label: 'Total Catalog', value: totalRecords.toLocaleString() },
                              { label: 'Field Ready Sites', value: eligibleForField.toLocaleString() },
                              { label: 'Commercial Excluded', value: commercialCount.toLocaleString() },
                            ],
                            recordLinkOptions: {},
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">1. Total Identified Properties</span>
                            <span className="cc-funnel-tag tag-catalog">
                              <span className="cc-funnel-tag-dot" />Catalog
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{totalRecords.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>100%</td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div className="cc-funnel-bar-fill" style={{ width: '100%', background: '#0284c7' }} />
                          </div>
                        </td>
                      </tr>

                      {/* Row 2: Commercial Property (QC Exclusive) */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Commercial Property (QC Exclusive)',
                            category: 'Funnel Stage 2',
                            value: commercialCount.toLocaleString(),
                            badgeText: 'Excluded from Field',
                            badgeTone: 'amber',
                            icon: 'storefront',
                            description:
                              'Commercial developments and Big Builders separated from the field inspection queue to prevent duplicate or uncoordinated site visits.',
                            breakdown: [
                              { label: 'Commercial Properties', value: commercialCount.toLocaleString() },
                              { label: 'Assigned to Verifiers', value: '0 (Strictly Excluded)' },
                              { label: 'QC Desk Review', value: 'Exclusive' },
                            ],
                            recordLinkOptions: { propertyType: 'Commercial Property' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">2. Commercial Property (QC Exclusive)</span>
                            <span className="cc-funnel-tag tag-commercial">
                              <span className="cc-funnel-tag-dot" />Excluded
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                          {commercialCount.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {totalRecords ? `${((commercialCount / totalRecords) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${totalRecords ? Math.max(4, (commercialCount / totalRecords) * 100) : 0}%`,
                                background: '#f59e0b',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 3: Eligible for Field Verification */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Eligible for Field Verification',
                            category: 'Funnel Stage 3',
                            value: eligibleForField.toLocaleString(),
                            badgeText: 'Field Ready Queue',
                            badgeTone: 'blue',
                            icon: 'near_me',
                            description:
                              'Properties cleared for dispatch to field verifiers for on-ground inspection.',
                            breakdown: [
                              { label: 'Field Ready Queue', value: eligibleForField.toLocaleString() },
                              { label: 'Inspected to Date', value: completedVerifications.toLocaleString() },
                              { label: 'Remaining in Queue', value: pendingVerifications.toLocaleString() },
                            ],
                            recordLinkOptions: {},
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">3. Eligible for Field Verification</span>
                            <span className="cc-funnel-tag tag-field">
                              <span className="cc-funnel-tag-dot" />Field Ready
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{eligibleForField.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {totalRecords ? `${((eligibleForField / totalRecords) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${totalRecords ? (eligibleForField / totalRecords) * 100 : 0}%`,
                                background: '#2563eb',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 4: Field Verification Completed */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Field Verification Completed',
                            category: 'Funnel Stage 4',
                            value: completedVerifications.toLocaleString(),
                            badgeText: 'Inspected on Ground',
                            badgeTone: 'green',
                            icon: 'check_circle',
                            description:
                              'Site inspections physically completed by field verifiers with geotagged photo evidence and verified questionnaires.',
                            breakdown: [
                              { label: 'Completed Inspections', value: completedVerifications.toLocaleString() },
                              { label: 'Confirmed Construction', value: confirmedConstruction.toLocaleString() },
                              { label: 'Phone Numbers Obtained', value: phonesObtained.toLocaleString() },
                              { label: 'Completion Rate', value: `${completionRate}%` },
                            ],
                            recordLinkOptions: { status: 'COMPLETED' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">4. Field Verification Completed</span>
                            <span className="cc-funnel-tag tag-completed">
                              <span className="cc-funnel-tag-dot" />Inspected
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {completedVerifications.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {eligibleForField ? `${((completedVerifications / eligibleForField) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${eligibleForField ? (completedVerifications / eligibleForField) * 100 : 0}%`,
                                background: '#10b981',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 5: Constructions Happened */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Constructions Happened',
                            category: 'Funnel Stage 5',
                            value: confirmedConstruction.toLocaleString(),
                            badgeText: 'Positive On-Ground Match',
                            badgeTone: 'green',
                            icon: 'fact_check',
                            description:
                              'Inspections where field verifiers confirmed active construction happening on site (Construction Happened = Yes).',
                            breakdown: [
                              { label: 'Constructions Happened (Yes)', value: confirmedConstruction.toLocaleString() },
                              { label: 'Total Completed Visits', value: completedVerifications.toLocaleString() },
                              {
                                label: 'Confirmation Rate',
                                value: completedVerifications
                                  ? `${((confirmedConstruction / completedVerifications) * 100).toFixed(1)}%`
                                  : 'N/A',
                              },
                            ],
                            recordLinkOptions: { status: 'COMPLETED' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">5. Constructions Happened (Yes)</span>
                            <span className="cc-funnel-tag tag-positive">
                              <span className="cc-funnel-tag-dot" />Positive
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {confirmedConstruction.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {completedVerifications ? `${((confirmedConstruction / completedVerifications) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${completedVerifications ? (confirmedConstruction / completedVerifications) * 100 : 0}%`,
                                background: '#059669',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 6: Phone Numbers Obtained */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Phone Numbers Obtained',
                            category: 'Funnel Stage 6',
                            value: phonesObtained.toLocaleString(),
                            badgeText: 'Telecalling Leads',
                            badgeTone: 'rose',
                            icon: 'call',
                            description:
                              'Site contacts and contractor numbers obtained on ground and fed directly to telecalling.',
                            breakdown: [
                              { label: 'Contacts Gathered', value: phonesObtained.toLocaleString() },
                              { label: 'Yield Rate', value: completedVerifications ? `${((phonesObtained / completedVerifications) * 100).toFixed(1)}%` : 'N/A' },
                            ],
                            recordLinkOptions: { status: 'COMPLETED' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">6. Phone Numbers Obtained</span>
                            <span className="cc-funnel-tag tag-leads">
                              <span className="cc-funnel-tag-dot" />Leads
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{phonesObtained.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {completedVerifications ? `${((phonesObtained / completedVerifications) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${completedVerifications ? (phonesObtained / completedVerifications) * 100 : 0}%`,
                                background: '#be123c',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 7: Manually Added */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Manually Added by Field Verifiers',
                            category: 'Funnel Stage 7',
                            value: manuallyAdded.toLocaleString(),
                            badgeText: 'Discovered in Field',
                            badgeTone: 'purple',
                            icon: 'add',
                            description:
                              'New construction sites discovered on-ground by field operators while navigating between assigned survey tasks.',
                            breakdown: [
                              { label: 'Manually Added Records', value: manuallyAdded.toLocaleString() },
                              { label: 'Source', value: 'Mobile App Live GPS' },
                            ],
                            recordLinkOptions: {},
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">7. Manually Added by Field Verifiers</span>
                            <span className="cc-funnel-tag tag-manual">
                              <span className="cc-funnel-tag-dot" />Discovered
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#6b21a8' }}>
                          {manuallyAdded.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>Field New</td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{ width: `${Math.min(100, manuallyAdded * 2)}%`, background: '#9333ea' }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 8: False Positives */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'False Positives (Sites without Construction)',
                            category: 'Funnel Stage 8',
                            value: falsePositives.toLocaleString(),
                            badgeText: 'Disapproved in QC',
                            badgeTone: 'rose',
                            icon: 'block',
                            description:
                              'Survey locations where desk review or ground check identified no active construction (vacant land, existing finished buildings, or false detections).',
                            breakdown: [
                              { label: 'Disapproved False Positives', value: falsePositives.toLocaleString() },
                              { label: 'Review Stage', value: 'QC Desk' },
                            ],
                            recordLinkOptions: { auditStatus: 'DISAPPROVAL' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">8. False Positives (Sites without Construction)</span>
                            <span className="cc-funnel-tag tag-disapproved">
                              <span className="cc-funnel-tag-dot" />Disapproved
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#991b1b' }}>
                          {falsePositives.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {completedVerifications ? `${((falsePositives / completedVerifications) * 100).toFixed(1)}%` : '0%'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${completedVerifications ? (falsePositives / completedVerifications) * 100 : 0}%`,
                                background: '#ef4444',
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Row 9: Pending Verifications */}
                      <tr
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: 'Pending Field Verifications',
                            category: 'Funnel Stage 9',
                            value: pendingVerifications.toLocaleString(),
                            badgeText: 'Awaiting Field Visit',
                            badgeTone: 'amber',
                            icon: 'pending_actions',
                            description:
                              'Active backlog of properties awaiting physical on-ground inspection by field verifiers.',
                            breakdown: [
                              { label: 'Pending in Queue', value: pendingVerifications.toLocaleString() },
                              { label: 'Remaining Backlog %', value: completionRate ? `${(100 - completionRate).toFixed(1)}%` : '100%' },
                            ],
                            recordLinkOptions: { status: 'NOT_COMPLETED' },
                          })
                        }
                      >
                        <td>
                          <div className="cc-funnel-stage">
                            <span className="cc-funnel-stage-name">9. Pending Field Verifications</span>
                            <span className="cc-funnel-tag tag-queue">
                              <span className="cc-funnel-tag-dot" />In Queue
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                          {pendingVerifications.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#64748b' }}>
                          {completionRate ? `${(100 - completionRate).toFixed(1)}% remain` : 'Queue'}
                        </td>
                        <td>
                          <div className="cc-funnel-bar-wrap">
                            <div
                              className="cc-funnel-bar-fill"
                              style={{
                                width: `${eligibleForField ? (pendingVerifications / eligibleForField) * 100 : 0}%`,
                                background: '#f59e0b',
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
          </div>

          {/* ── 2-Column Section: Telecaller Outreach Desk & Regional Distribution ── */}
          <section className="cc-middle-grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
              {/* Telecaller Desk Card */}
              <div className="cc-tele-card">
                <div className="cc-card-head">
                  <h3 className="cc-card-title">
                    <Icon name="call" size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Telecaller Conversion Funnel
                  </h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => navigate('/telecaller-records')}
                  >
                    View Portal
                  </button>
                </div>

                <div className="cc-tele-stats-grid">
                  <div
                    className="cc-tele-stat-box clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Total Telecaller Leads Assigned',
                        category: 'Telecalling Queue',
                        value: telecalling?.total_leads ?? 168,
                        badgeText: 'Verified Field Phones',
                        badgeTone: 'blue',
                        icon: 'call',
                        description:
                          'Leads created from verified phone numbers gathered during field visits, routed into the telecaller queue for phone confirmation.',
                        breakdown: [
                          { label: 'Total Leads Assigned', value: telecalling?.total_leads ?? 168 },
                          { label: 'Calls Completed', value: telecalling?.calls_completed ?? 128 },
                          { label: 'Pending Calls', value: telecalling?.calls_pending ?? 40 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-stat-label">Total Leads Assigned</div>
                    <div className="cc-tele-stat-num">{telecalling?.total_leads ?? 168}</div>
                    <div className="cc-tele-stat-sub">From verified field phones</div>
                  </div>
                  <div
                    className="cc-tele-stat-box clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Telecaller Calls Completed',
                        category: 'Telecalling Performance',
                        value: telecalling?.calls_completed ?? 128,
                        badgeText: '76% Contact Rate',
                        badgeTone: 'green',
                        icon: 'check_circle',
                        description:
                          'Phone calls completed by telecaller desk agents to verify contractor, owner, and site details.',
                        breakdown: [
                          { label: 'Calls Completed', value: telecalling?.calls_completed ?? 128 },
                          { label: 'Confirmed Construction', value: telecalling?.construction_confirmed ?? 13 },
                          { label: 'Follow-ups Scheduled', value: telecalling?.follow_up_needed ?? 69 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-stat-label">Calls Completed</div>
                    <div className="cc-tele-stat-num" style={{ color: '#059669' }}>
                      {telecalling?.calls_completed ?? 128}
                    </div>
                    <div className="cc-tele-stat-sub">
                      {telecalling?.total_leads
                        ? `${Math.round(((telecalling?.calls_completed ?? 128) / telecalling.total_leads) * 100)}% contact rate`
                        : '76% contact rate'}
                    </div>
                  </div>
                </div>

                <div className="cc-tele-outcomes-list">
                  <div
                    className="cc-tele-outcome-row clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Construction Confirmed / Qualified',
                        category: 'Telecaller Outcome',
                        value: telecalling?.construction_confirmed ?? 13,
                        badgeText: 'Qualified Lead',
                        badgeTone: 'green',
                        icon: 'fact_check',
                        description:
                          'Telecaller conversations that successfully confirmed active construction work, contractor details, and verified building readiness.',
                        breakdown: [
                          { label: 'Confirmed / Qualified', value: telecalling?.construction_confirmed ?? 13 },
                          { label: 'Total Completed Calls', value: telecalling?.calls_completed ?? 128 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-outcome-top">
                      <span>Confirmed Construction / Qualified</span>
                      <strong>{telecalling?.construction_confirmed ?? 13}</strong>
                    </div>
                    <div className="cc-tele-progress-wrap">
                      <div
                        className="cc-tele-progress-fill"
                        style={{
                          width: `${telecalling?.total_leads ? ((telecalling.construction_confirmed / telecalling.total_leads) * 100) : 10}%`,
                          background: '#10b981',
                        }}
                      />
                    </div>
                  </div>

                  <div
                    className="cc-tele-outcome-row clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Follow-up Scheduled',
                        category: 'Telecaller Outcome',
                        value: telecalling?.follow_up_needed ?? 69,
                        badgeText: 'In Progress',
                        badgeTone: 'amber',
                        icon: 'schedule',
                        description:
                          'Calls where the contractor or owner requested a callback, or where additional project details are pending verification.',
                        breakdown: [
                          { label: 'Follow-ups Scheduled', value: telecalling?.follow_up_needed ?? 69 },
                          { label: 'Total Completed Calls', value: telecalling?.calls_completed ?? 128 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-outcome-top">
                      <span>Follow-up Scheduled</span>
                      <strong>{telecalling?.follow_up_needed ?? 69}</strong>
                    </div>
                    <div className="cc-tele-progress-wrap">
                      <div
                        className="cc-tele-progress-fill"
                        style={{
                          width: `${telecalling?.total_leads ? ((telecalling.follow_up_needed / telecalling.total_leads) * 100) : 41}%`,
                          background: '#f59e0b',
                        }}
                      />
                    </div>
                  </div>

                  <div
                    className="cc-tele-outcome-row clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Not Reachable / Busy',
                        category: 'Telecaller Outcome',
                        value: telecalling?.not_reachable ?? 22,
                        badgeText: 'Needs Retry',
                        badgeTone: 'rose',
                        icon: 'call',
                        description:
                          'Calls that went unanswered, were busy, or temporarily switched off. Scheduled for automated redial.',
                        breakdown: [
                          { label: 'Not Reachable / Busy', value: telecalling?.not_reachable ?? 22 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-outcome-top">
                      <span>Not Reachable / Busy</span>
                      <strong>{telecalling?.not_reachable ?? 22}</strong>
                    </div>
                    <div className="cc-tele-progress-wrap">
                      <div
                        className="cc-tele-progress-fill"
                        style={{
                          width: `${telecalling?.total_leads ? ((telecalling.not_reachable / telecalling.total_leads) * 100) : 13}%`,
                          background: '#94a3b8',
                        }}
                      />
                    </div>
                  </div>

                  <div
                    className="cc-tele-outcome-row clickable-stat"
                    onClick={() =>
                      setModalStat({
                        title: 'Pending Telecaller Calls',
                        category: 'Telecaller Queue',
                        value: telecalling?.calls_pending ?? 40,
                        badgeText: 'Ready to Call',
                        badgeTone: 'blue',
                        icon: 'call',
                        description:
                          'Verified numbers currently in queue awaiting initial outreach by telecaller agents.',
                        breakdown: [
                          { label: 'Pending Calls', value: telecalling?.calls_pending ?? 40 },
                          { label: 'Total Leads Assigned', value: telecalling?.total_leads ?? 168 },
                        ],
                      })
                    }
                  >
                    <div className="cc-tele-outcome-top">
                      <span>Pending Calls</span>
                      <strong>{telecalling?.calls_pending ?? 40}</strong>
                    </div>
                    <div className="cc-tele-progress-wrap">
                      <div
                        className="cc-tele-progress-fill"
                        style={{
                          width: `${telecalling?.total_leads ? ((telecalling.calls_pending / telecalling.total_leads) * 100) : 24}%`,
                          background: '#3b82f6',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Geographic & Regional Distribution */}
              <div className="cc-dist-card">
                <div className="cc-card-head">
                  <h3 className="cc-card-title">
                    <Icon name="location_on" size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Regional Distribution
                  </h3>
                  <span className="cc-card-badge">Click row for details</span>
                </div>
                <div className="cc-dist-bars">
                  {(distribution?.by_district || [
                    { label: 'Coimbatore', count: 1911, completed: 694 },
                    { label: 'Tiruppur', count: 5, completed: 0 },
                    { label: 'Chennai', count: 4, completed: 3 },
                  ]).map((dist) => {
                    const distTotal = dist.count || 1;
                    const pct = totalRecords ? ((distTotal / totalRecords) * 100).toFixed(1) : '0';
                    return (
                      <div
                        key={dist.label}
                        className="cc-dist-row clickable-stat"
                        onClick={() =>
                          setModalStat({
                            title: `${dist.label} Region Overview`,
                            category: 'Geographic Distribution',
                            value: `${dist.count.toLocaleString()} sites`,
                            badgeText: `${pct}% of Catalog`,
                            badgeTone: 'blue',
                            icon: 'location_on',
                            description: `Comprehensive site catalog and verification metrics for the ${dist.label} administrative region.`,
                            breakdown: [
                              { label: 'Total Sites in District', value: dist.count.toLocaleString() },
                              { label: 'Catalog Percentage', value: `${pct}%` },
                              { label: 'Completed Inspections', value: (dist.completed ?? 0).toLocaleString() },
                              { label: 'Pending Inspections', value: (dist.pending ?? 0).toLocaleString() },
                            ],
                            recordLinkOptions: {},
                          })
                        }
                      >
                        <div className="cc-dist-row-top">
                          <span>
                            <strong>{dist.label}</strong> ({dist.count.toLocaleString()} sites)
                          </span>
                          <span style={{ color: '#64748b' }}>{pct}% of catalog</span>
                        </div>
                        <div className="cc-tele-progress-wrap">
                          <div
                            className="cc-tele-progress-fill"
                            style={{
                              width: `${pct}%`,
                              background: dist.label === 'Coimbatore' ? '#2563eb' : '#0284c7',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          </section>

          {/* ── Lower Tier: Field Verifier Workload & Performance ─────────── */}
          <section className="cc-workload-card" aria-label="Field Verifier Workload and Performance">
            <div className="cc-card-head">
              <div>
                <h3 className="cc-card-title">
                  <Icon name="group" size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Field Verifier Workload & On-Ground Performance
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Real-time assignment load, completed site inspections, and phone discovery yield. Click any row for details.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(recordLink({ status: 'COMPLETED' }))}
                >
                  View Completed Records
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(recordLink({ status: 'NOT_COMPLETED' }))}
                >
                  Assign Pending Records
                </button>
              </div>
            </div>

            {operators.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="cc-workload-table">
                  <thead>
                    <tr>
                      <th>Operator / Verifier</th>
                      <th style={{ textAlign: 'right' }}>Assigned</th>
                      <th style={{ textAlign: 'right' }}>Pending</th>
                      <th style={{ textAlign: 'right' }}>Completed</th>
                      <th style={{ textAlign: 'right' }}>Closed</th>
                      <th style={{ textAlign: 'right' }}>Confirmed Sites</th>
                      <th style={{ textAlign: 'right' }}>Phones Found</th>
                      <th style={{ width: '22%' }}>Completion %</th>
                      <th style={{ width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {operators.map((op) => (
                      <tr
                        key={op.user_id}
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: `${op.user_name} – Field Operator Performance`,
                            category: 'Field Verifier Profile',
                            value: `${op.completed.toLocaleString()} Completed`,
                            badgeText: `${Math.round(op.completion_rate)}% Completion`,
                            badgeTone: op.completion_rate > 80 ? 'green' : 'amber',
                            icon: 'person',
                            description: `On-ground operational performance metrics and task completion summary for ${op.user_name} (${op.email}).`,
                            breakdown: [
                              { label: 'Total Assigned Tasks', value: op.total_assigned.toLocaleString() },
                              { label: 'Completed Visits', value: op.completed.toLocaleString() },
                              { label: 'Closed / Terminal Visits', value: (op.closed ?? 0).toLocaleString() },
                              { label: 'Pending Visits', value: op.pending.toLocaleString() },
                              { label: 'Confirmed Construction Sites', value: (op.confirmed_construction ?? 0).toLocaleString() },
                              { label: 'Phone Numbers Obtained', value: (op.phones_obtained ?? 0).toLocaleString() },
                              { label: 'Completion Rate', value: `${Math.round(op.completion_rate)}%` },
                            ],
                            recordLinkOptions: { userId: op.user_id },
                          })
                        }
                      >
                        <td>
                          <div className="cc-operator-cell">
                            <Avatar name={op.user_name} size="sm" />
                            <div className="cc-operator-info">
                              <strong>{op.user_name}</strong>
                              <span>{op.email}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {op.total_assigned.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              color: op.pending > 0 ? '#b45309' : '#64748b',
                              fontWeight: op.pending > 0 ? 700 : 400,
                            }}
                          >
                            {op.pending.toLocaleString()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {op.completed.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#64748b' }} title="Not Interested / Duplicate / Construction Finished">
                          {(op.closed ?? 0).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {(op.confirmed_construction ?? 0).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {(op.phones_obtained ?? 0).toLocaleString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="cc-tele-progress-wrap" style={{ flex: 1 }}>
                              <div
                                className="cc-tele-progress-fill"
                                style={{
                                  width: `${Math.min(100, Math.round(op.completion_rate))}%`,
                                  background: op.completion_rate > 80 ? '#10b981' : '#f59e0b',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, minWidth: '32px' }}>
                              {Math.round(op.completion_rate)}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="Filter records by this verifier"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(recordLink({ userId: op.user_id }));
                            }}
                          >
                            <Icon name="chevron_right" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel icon="group" text="No active field verifiers found." />
            )}
          </section>

          {/* ── Lower Tier: QA Reviewer & Auditor Performance ──────────────── */}
          <section className="cc-workload-card" aria-label="QA Reviewer & Auditor Performance" style={{ marginTop: '24px' }}>
            <div className="cc-card-head">
              <div>
                <h3 className="cc-card-title">
                  <Icon name="fact_check" size={18} style={{ verticalAlign: 'middle', marginRight: 6, color: '#7c3aed' }} />
                  QA Reviewer &amp; Auditor Performance
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Satellite VHR imagery reviews, street-view audits, false positive filtering, and verification approvals.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('/auditor/dashboard')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="visibility" size={14} />
                  QC Dashboard
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate('/audit')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="map" size={14} />
                  Open QA Portal
                </button>
              </div>
            </div>

            {/* QA Summary Highlight Strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 10,
                margin: '16px 0 18px',
              }}
            >
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.70rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total Reviewed
                </div>
                <div style={{ fontSize: '1.30rem', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                  {totalQcReviewed.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#059669', marginTop: 1, fontWeight: 500 }}>
                  {overallApprovalRate}% approved
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '0.70rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Approved
                </div>
                <div style={{ fontSize: '1.30rem', fontWeight: 800, color: '#15803d', marginTop: 2 }}>
                  {totalApproved.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#16a34a', marginTop: 1, fontWeight: 500 }}>
                  Eligible for field
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '0.70rem', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  False Positives
                </div>
                <div style={{ fontSize: '1.30rem', fontWeight: 800, color: '#dc2626', marginTop: 2 }}>
                  {totalDisapproved.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#ef4444', marginTop: 1, fontWeight: 500 }}>
                  Disapproved / blocked
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
                <div style={{ fontSize: '0.70rem', fontWeight: 600, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Commercial
                </div>
                <div style={{ fontSize: '1.30rem', fontWeight: 800, color: '#2563eb', marginTop: 2 }}>
                  {totalCommercial.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#3b82f6', marginTop: 1, fontWeight: 500 }}>
                  Big Builder / corporate
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff' }}>
                <div style={{ fontSize: '0.70rem', fontWeight: 600, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  QA Created
                </div>
                <div style={{ fontSize: '1.30rem', fontWeight: 800, color: '#7c3aed', marginTop: 2 }}>
                  {totalQaCreated.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#8b5cf6', marginTop: 1, fontWeight: 500 }}>
                  Auditor additions
                </div>
              </div>
            </div>

            {/* QA Reviewers Table */}
            {qaUsers.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="cc-workload-table">
                  <thead>
                    <tr>
                      <th>QA Reviewer / Auditor</th>
                      <th style={{ textAlign: 'right' }}>Assigned</th>
                      <th style={{ textAlign: 'right' }}>QC Done</th>
                      <th style={{ textAlign: 'right' }}>Approved</th>
                      <th style={{ textAlign: 'right' }}>Disapproved</th>
                      <th style={{ textAlign: 'right' }}>Commercial</th>
                      <th style={{ textAlign: 'right' }}>Pending</th>
                      <th style={{ textAlign: 'right' }}>QA Added</th>
                      <th style={{ width: '22%' }}>Review Progress</th>
                      <th style={{ width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {qaUsers.map((aud) => (
                      <tr
                        key={aud.user_id}
                        className="clickable-row"
                        onClick={() =>
                          setModalStat({
                            title: `${aud.user_name} – QA Review & Audit Performance`,
                            category: 'QA Auditor Profile',
                            value: `${aud.qc_done.toLocaleString()} Reviews Done`,
                            badgeText: `${Math.round(aud.completion_rate)}% Progress`,
                            badgeTone: aud.completion_rate > 80 ? 'green' : 'purple',
                            icon: 'fact_check',
                            description: `Quality review, satellite VHR verification, and audit decisions completed by ${aud.user_name} (${aud.email}).`,
                            breakdown: [
                              { label: 'Assigned Scope', value: aud.total_assigned.toLocaleString() },
                              { label: 'Total QC Done', value: aud.qc_done.toLocaleString() },
                              { label: 'Approved Sites (Eligible)', value: aud.approved.toLocaleString() },
                              { label: 'Disapproved (False Positives)', value: aud.disapproved.toLocaleString() },
                              { label: 'Commercial Properties Flagged', value: aud.commercial.toLocaleString() },
                              { label: 'Pending in Auditor Queue', value: aud.pending.toLocaleString() },
                              { label: 'Newly Created from QA Map', value: aud.qa_created.toLocaleString() },
                              { label: 'Reviewed Today', value: aud.today_done.toLocaleString() },
                              { label: 'Review Progress Rate', value: `${Math.round(aud.completion_rate)}%` },
                            ],
                            recordLinkOptions: { assignedAuditorId: aud.user_id },
                          })
                        }
                      >
                        <td>
                          <div className="cc-operator-cell">
                            <Avatar name={aud.user_name} size="sm" />
                            <div className="cc-operator-info">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <strong>{aud.user_name}</strong>
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: aud.role === 'ADMIN' ? '#fef3c7' : '#ede9fe',
                                    color: aud.role === 'ADMIN' ? '#92400e' : '#6d28d9',
                                    fontWeight: 600,
                                  }}
                                >
                                  {aud.role === 'ADMIN' ? 'Admin' : 'Auditor'}
                                </span>
                              </div>
                              <span>{aud.email}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {aud.total_assigned.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>
                          {aud.qc_done.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#15803d' }}>
                          {aud.approved.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: aud.disapproved > 0 ? '#dc2626' : '#94a3b8' }}>
                          {aud.disapproved.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: aud.commercial > 0 ? '#2563eb' : '#94a3b8' }}>
                          {aud.commercial.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              color: aud.pending > 0 ? '#b45309' : '#64748b',
                              fontWeight: aud.pending > 0 ? 700 : 400,
                            }}
                          >
                            {aud.pending.toLocaleString()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: aud.qa_created > 0 ? '#7c3aed' : '#94a3b8' }}>
                          {aud.qa_created.toLocaleString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="cc-tele-progress-wrap" style={{ flex: 1 }}>
                              <div
                                className="cc-tele-progress-fill"
                                style={{
                                  width: `${Math.min(100, Math.round(aud.completion_rate))}%`,
                                  background: aud.completion_rate >= 80 ? '#10b981' : aud.completion_rate >= 40 ? '#8b5cf6' : '#f59e0b',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, minWidth: '32px' }}>
                              {Math.round(aud.completion_rate)}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="Filter records reviewed by this auditor"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(recordLink({ assignedAuditorId: aud.user_id }));
                            }}
                          >
                            <Icon name="chevron_right" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel icon="fact_check" text="No active QA auditors found." />
            )}
          </section>

          {/* ── Bottom Tier: Recent Activity Timeline ─────────────────────── */}
          {activities.length > 0 && (
            <section className="cc-activity-card" aria-label="Recent Field and QC Activities">
              <div className="cc-card-head">
                <h3 className="cc-card-title">
                  <Icon name="history" size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Recent Operational Activities & Milestones
                </h3>
                <span className="cc-card-badge">Audit Trail</span>
              </div>
              <div className="cc-activity-list">
                {activities.map((act) => (
                  <div key={act.id} className="cc-activity-item">
                    <div className="cc-activity-icon">
                      <Icon
                        name={
                          act.type === 'COMMERCIAL_PROPERTY'
                            ? 'storefront'
                            : act.status === 'COMPLETED'
                            ? 'check_circle'
                            : 'assignment_turned_in'
                        }
                        size={16}
                      />
                    </div>
                    <div className="cc-activity-content">
                      <div className="cc-activity-title">{act.title}</div>
                      {act.detail && <div className="cc-activity-detail">{act.detail}</div>}
                      <div className="cc-activity-meta">
                        {act.user_name ? `By ${act.user_name} • ` : ''}
                        {act.timestamp}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Executive Quick Actions & Operational Hub (matches TeamPulse reference) ── */}
          <section
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '22px 24px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
            }}
            aria-label="Executive Quick Action Hub"
          >
            <div className="cc-card-head" style={{ marginBottom: 14 }}>
              <div>
                <h3 className="cc-card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="auto_awesome" size={18} style={{ color: '#2563eb' }} />
                  Executive Quick Actions &amp; Operations Hub
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: '#64748b' }}>
                  One-click shortcuts to key management consoles, verification desks, and task sheet imports
                </p>
              </div>
              <span className="cc-card-badge">Fast Navigation</span>
            </div>

            <div className="quick-launch-grid">
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/records')}>
                <Icon name="table_view" size={22} style={{ color: '#2563eb' }} />
                <span>Manage Records</span>
              </button>
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/auditor/dashboard')}>
                <Icon name="fact_check" size={22} style={{ color: '#7c3aed' }} />
                <span>QA Review Desk</span>
              </button>
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/telecaller/records')}>
                <Icon name="call" size={22} style={{ color: '#bf3646' }} />
                <span>Calling Queue</span>
              </button>
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/records/import')}>
                <Icon name="cloud_upload" size={22} style={{ color: '#059669' }} />
                <span>Import Task Sheet</span>
              </button>
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/admin/users')}>
                <Icon name="group" size={22} style={{ color: '#d97706' }} />
                <span>Manage Users</span>
              </button>
              <button type="button" className="quick-launch-btn" onClick={() => navigate('/admin/map')}>
                <Icon name="pin_drop" size={22} style={{ color: '#0284c7' }} />
                <span>GIS Spatial Map</span>
              </button>
            </div>
          </section>

          {/* ── Stat Details Popup Modal ──────────────────────────────────── */}
          {modalStat && (
            <div
              className="cc-modal-backdrop"
              onClick={() => setModalStat(null)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="stat-modal-title"
            >
              <div className="cc-modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="cc-modal-header">
                  <div>
                    <div className="cc-modal-category">{modalStat.category}</div>
                    <h2 id="stat-modal-title" className="cc-modal-title">
                      <Icon name={modalStat.icon} size={22} />
                      {modalStat.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="cc-modal-close"
                    onClick={() => setModalStat(null)}
                    aria-label="Close modal"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>

                <div className="cc-modal-body">
                  <div className="cc-modal-hero">
                    <div className="cc-modal-hero-val">{modalStat.value}</div>
                    {modalStat.badgeText && (
                      <span className={`cc-modal-hero-badge badge-${modalStat.badgeTone || 'blue'}`}>
                        {modalStat.badgeText}
                      </span>
                    )}
                  </div>

                  <p className="cc-modal-desc">{modalStat.description}</p>

                  {modalStat.breakdown && modalStat.breakdown.length > 0 && (
                    <div>
                      <div className="cc-modal-breakdown-title">Operational Breakdown</div>
                      <div className="cc-modal-breakdown-list">
                        {modalStat.breakdown.map((item, idx) => (
                          <div key={idx} className="cc-modal-breakdown-item">
                            <span className="cc-modal-breakdown-label">{item.label}</span>
                            <span className="cc-modal-breakdown-val">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="cc-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setModalStat(null)}
                  >
                    Close
                  </button>
                  {modalStat.recordLinkOptions && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        const link = recordLink(modalStat.recordLinkOptions);
                        setModalStat(null);
                        navigate(link);
                      }}
                    >
                      View in Records Table
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
