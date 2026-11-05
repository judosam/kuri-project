import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '../services/api';
import type { DashboardData, InspectorStat, QaUserStat } from '../types';
import {
  Icon,
  Avatar,
  EmptyPanel,
  LoadingPanel,
  PageShell,
  formatDateTime,
  type IconName,
} from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import './Dashboard.css';

type PresetKey =
  | 'allTime'
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'last30Days'
  | 'thisMonth'
  | 'thisYear'
  | 'custom';

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: 'allTime', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7Days', label: 'Last 7 days' },
  { key: 'last30Days', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'thisYear', label: 'This year' },
  { key: 'custom', label: 'Custom' },
];

interface StatDetailModalData {
  title: string;
  category: string;
  value: string | number;
  badgeText?: string;
  description: string;
  icon: IconName;
  breakdown?: { label: string; value: string | number }[];
  link?: { label: string; to: string };
}

const clock = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';

const formatter = new Intl.NumberFormat('en-IN');

const pct = (value: number, base: number) => (base > 0 ? Math.round((value / base) * 100) : 0);

const roleLabel = (role: string) =>
  role === 'ADMIN' ? 'Admin' : role === 'AUDITOR' ? 'Auditor' : role === 'TELECALLER' ? 'Telecaller' : 'Field verifier';

/** Small inline progress track used in the reviewer / verifier tables. */
function ProgressCell({ value, tone }: { value: number; tone: 'green' | 'orange' }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="k-progress">
      <span className="k-progress-track">
        <span className={`k-progress-fill is-${tone}`} style={{ width: `${width}%` }} />
      </span>
      <span className="k-progress-value">{Math.round(width)}%</span>
    </div>
  );
}

/** Dual line chart for the field-verification section (no chart library needed). */
function VisitsChart({ points }: { points: { label: string; completed: number; assigned: number }[] }) {
  const data = points.slice(-7);
  if (data.length === 0) {
    return <div className="k-chart-empty">No activity in this range.</div>;
  }

  const W = 560;
  const H = 190;
  const padL = 34;
  const padR = 24;
  const padT = 16;
  const padB = 26;
  const max = Math.max(1, ...data.map((p) => Math.max(p.completed, p.assigned)));
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, data.length - 1);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = (key: 'completed' | 'assigned') =>
    data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const area =
    `${data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.completed).toFixed(1)}`).join(' ')}` +
    ` L${x(data.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  return (
    <div className="k-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Completed visits and assigned tasks per day">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + t * (H - padT - padB)}
              y2={padT + t * (H - padT - padB)}
              className="k-chart-grid"
            />
            <text x={padL - 8} y={padT + t * (H - padT - padB) + 3} className="k-chart-axis" textAnchor="end">
              {Math.round(max * (1 - t))}
            </text>
          </g>
        ))}
        <path d={area} className="k-chart-area" />
        <path d={line('assigned')} className="k-chart-line is-assigned" />
        <path d={line('completed')} className="k-chart-line is-completed" />
        {data.map((p, i) => (
          <g key={p.label + i}>
            <circle cx={x(i)} cy={y(p.completed)} r="3" className="k-chart-dot" />
            <text x={x(i)} y={H - 8} className="k-chart-axis" textAnchor="middle">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function StackedBar({
  segments,
}: {
  segments: { label: string; count: number; tone: string }[];
}) {
  const total = segments.reduce((acc, s) => acc + s.count, 0);
  return (
    <div className="k-stack" aria-hidden="true">
      {total === 0 ? (
        <span className="k-stack-empty" />
      ) : (
        segments.map((s) => (
          <span
            key={s.label}
            className={`k-stack-seg is-${s.tone}`}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<PresetKey>('allTime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [district, setDistrict] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [modalStat, setModalStat] = useState<StatDetailModalData | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'qc' | 'field' | 'telecalling'>('all');

  const fetchData = (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    dashboardApi
      .get({
        preset,
        district: district || undefined,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, district]);

  const overview = data?.overview;
  const funnel = data?.funnel;
  const telecalling = data?.telecalling;
  const trends = data?.trends || [];
  const activities = data?.recent_activities || [];

  const totalRecords = overview?.total_records ?? data?.total_records ?? 0;
  const commercialCount = overview?.total_commercial_properties ?? data?.total_commercial_properties ?? 0;
  const eligibleForField = overview?.eligible_for_field ?? Math.max(0, totalRecords - commercialCount);
  const confirmedConstruction = overview?.confirmed_construction ?? data?.construction_yes_records ?? 0;
  const phonesObtained = overview?.phone_numbers_obtained ?? data?.mobile_numbers_collected ?? 0;
  const manuallyAdded = overview?.manually_added ?? data?.manually_added_records ?? 0;
  const completedVerifications = overview?.completed_verifications ?? data?.total_completed_records ?? 0;
  const pendingVerifications = overview?.pending_verifications ?? data?.pending_records ?? 0;
  const falsePositives = funnel?.false_positives_qc ?? 0;

  const qaUsers = useMemo(
    () => [...(data?.qa_user_stats ?? [])].sort((a, b) => b.total_assigned - a.total_assigned || b.qc_done - a.qc_done),
    [data?.qa_user_stats]
  );
  const operators = useMemo(
    () =>
      [...(data?.inspector_stats ?? [])]
        .filter((o) => o.role === 'USER' || o.role === 'FIELD_VERIFIER')
        .sort((a, b) => b.completed - a.completed || b.pending - a.pending),
    [data?.inspector_stats]
  );

  const totalQcReviewed = qaUsers.reduce((acc, u) => acc + u.qc_done, 0);
  const totalApproved = qaUsers.reduce((acc, u) => acc + u.approved, 0);
  const totalDisapproved = qaUsers.reduce((acc, u) => acc + u.disapproved, 0);
  const totalCommercial = qaUsers.reduce((acc, u) => acc + u.commercial, 0);
  const pendingQc = qaUsers.reduce((acc, u) => acc + u.pending, 0);
  const totalQaCreated = qaUsers.reduce((acc, u) => acc + (u.qa_created || 0), 0) || overview?.qa_new_records || 0;

  const callsCompleted = telecalling?.calls_completed ?? 0;
  const callsPending = telecalling?.calls_pending ?? 0;
  const callsConfirmed = telecalling?.construction_confirmed ?? 0;
  const followUps = telecalling?.follow_up_needed ?? 0;
  const notReachable = telecalling?.not_reachable ?? 0;
  const otherOutcomes = telecalling?.other_outcomes ?? 0;
  const totalLeads = telecalling?.total_leads ?? 0;

  const identified = funnel?.identified_sites ?? totalRecords;
  const sentToField = funnel?.sent_for_verification ?? eligibleForField;

  const districts = useMemo(
    () => (data?.distribution?.by_district ?? []).filter((d) => d.count > 0),
    [data?.distribution]
  );

  useTopHeader(
    {
      left: (
        <div className="topbar-page-left">
          <div className="k-title-block">
            <h1 className="topbar-page-title">Dashboard</h1>
            <p className="k-live-line">
              <span className="k-live-dot" aria-hidden="true" />
              Live · {formatter.format(totalRecords)} records · updated {clock(updatedAt)} IST
            </p>
          </div>
        </div>
      ),
      right: (
        <div className="k-head-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
          >
            <Icon name="refresh" size={15} className={isRefreshing ? 'fos-spin' : undefined} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/records/import')}>
            <Icon name="upload" size={16} />
            Import task sheet
          </button>
        </div>
      ),
    },
    [totalRecords, updatedAt, isRefreshing]
  );

  const recordLink = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    search.set('preset', preset);
    return `/admin/records?${search.toString()}`;
  };

  const funnelRows = [
    { role: 'QC', label: 'Identified properties', value: identified, tone: 'purple' },
    { role: 'QC', label: 'Approved for field', value: sentToField, tone: 'purple' },
    { role: 'Field', label: 'Site visited', value: completedVerifications, tone: 'orange' },
    { role: 'Field', label: 'Construction confirmed', value: confirmedConstruction, tone: 'orange' },
    { role: 'Field', label: 'Phone number obtained', value: phonesObtained, tone: 'orange' },
    { role: 'Telecalling', label: 'Called', value: callsCompleted, tone: 'blue' },
    { role: 'Telecalling', label: 'Confirmed lead', value: callsConfirmed, tone: 'blue' },
  ];
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.value));

  const attention: { count: number; text: string; tone: string; to: string }[] = [
    {
      count: pendingQc,
      text: 'records waiting for QC review',
      tone: 'purple',
      to: '/auditor/records',
    },
    {
      count: pendingVerifications,
      text: 'eligible sites not yet visited',
      tone: 'orange',
      to: recordLink({ status: 'NOT_COMPLETED' }),
    },
    {
      count: operators.filter((o) => o.total_assigned === 0).length,
      text: 'field verifier(s) with no assignments',
      tone: 'orange',
      to: '/admin/users',
    },
    {
      count: followUps,
      text: 'telecalling follow-ups scheduled',
      tone: 'blue',
      to: '/telecaller/records',
    },
    { count: callsPending, text: 'leads not called yet', tone: 'blue', to: '/telecaller/records' },
  ].filter((item) => item.count > 0);

  const verifiedLabel = `${pct(completedVerifications, eligibleForField)}% of eligible`;

  const qcStats = [
    { label: 'Reviewed', value: totalQcReviewed, note: 'All reviewers', tone: 'plain' },
    { label: 'Approved for field', value: totalApproved, note: `${pct(totalApproved, totalQcReviewed)}% of reviewed`, tone: 'green' },
    { label: 'False positives', value: falsePositives, note: 'No construction found', tone: 'red' },
    { label: 'Commercial', value: totalCommercial || commercialCount, note: 'Builders & corporate', tone: 'blue' },
    { label: 'Created by QA', value: totalQaCreated, note: 'New sites added', tone: 'indigo' },
    { label: 'Waiting for review', value: pendingQc, note: 'Pending with reviewers', tone: 'amber' },
  ];

  const fieldStats = [
    { label: 'Eligible sites', value: eligibleForField, note: 'Approved by QC', tone: 'plain' },
    { label: 'Visited', value: completedVerifications, note: verifiedLabel, tone: 'orange' },
    { label: 'Still to visit', value: pendingVerifications, note: `${pct(pendingVerifications, eligibleForField)}% of eligible`, tone: 'amber' },
    { label: 'Construction confirmed', value: confirmedConstruction, note: `${pct(confirmedConstruction, completedVerifications)}% of visited`, tone: 'green' },
    { label: 'Phones obtained', value: phonesObtained, note: `${pct(phonesObtained, completedVerifications)}% of visited`, tone: 'blue' },
    { label: 'Added on site', value: manuallyAdded, note: 'Found by verifiers', tone: 'indigo' },
  ];

  const callStats = [
    { label: 'Leads assigned', value: totalLeads, note: 'From field phones', tone: 'plain' },
    { label: 'Calls completed', value: callsCompleted, note: callsCompleted ? `${pct(callsCompleted, totalLeads)}% contact rate` : 'No calls yet', tone: 'blue' },
    { label: 'Confirmed leads', value: callsConfirmed, note: `${pct(callsConfirmed, callsCompleted)}% of calls`, tone: 'green' },
    { label: 'Follow-ups', value: followUps, note: 'Call back scheduled', tone: 'amber' },
    { label: 'Not reachable', value: notReachable, note: 'Busy / switched off', tone: 'red' },
    { label: 'Not called yet', value: callsPending, note: 'Pending calls', tone: 'neutral' },
  ];

  const callSegments = [
    { label: 'Confirmed / qualified', count: callsConfirmed, tone: 'green' },
    { label: 'Follow-up scheduled', count: followUps, tone: 'amber' },
    { label: 'Not reachable / busy', count: notReachable, tone: 'red' },
    { label: 'Not interested / other', count: otherOutcomes, tone: 'neutral' },
  ];
  const callTotal = callSegments.reduce((acc, s) => acc + s.count, 0);

  const activityTone = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('audit') || t.includes('qc') || t.includes('review') || t.includes('approv') || t.includes('disapprov'))
      return 'qc';
    if (t.includes('photo') || t.includes('inspection') || t.includes('field') || t.includes('visit')) return 'field';
    if (t.includes('call') || t.includes('tele')) return 'telecalling';
    return 'system';
  };

  const activityIcon: Record<string, IconName> = {
    qc: 'fact_check',
    field: 'photo_camera',
    telecalling: 'call',
    system: 'history',
  };

  const visibleActivities = activities.filter(
    (a) => activityFilter === 'all' || activityTone(a.type) === activityFilter
  );

  const openModal = (stat: StatDetailModalData) => setModalStat(stat);

  return (
    <PageShell>
      {loading && !data ? (
        <LoadingPanel text="Loading the command center…" />
      ) : !data ? (
        <EmptyPanel icon="bar_chart" text="No dashboard data available for this period." />
      ) : (
        <div className="k-dash">
          <div className="k-filterbar">
            <div className="k-presets" role="group" aria-label="Reporting period">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`k-preset${preset === option.key ? ' is-active' : ''}`}
                  aria-pressed={preset === option.key}
                  onClick={() => setPreset(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="k-filter-right">
              {preset === 'custom' && (
                <div className="k-date-range">
                  <input
                    type="date"
                    className="fld"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="Custom range from"
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="date"
                    className="fld"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="Custom range to"
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchData(true)}>
                    Apply
                  </button>
                </div>
              )}
              <label className="k-city">
                <span>City</span>
                <select value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="Filter by city">
                  <option value="">All cities</option>
                  {districts.map((d) => (
                    <option key={d.label} value={d.label}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="k-kpis">
            <button
              type="button"
              className="k-kpi is-total"
              onClick={() =>
                openModal({
                  title: 'Total properties',
                  category: 'Property catalog',
                  value: formatter.format(totalRecords),
                  description: 'Every property in the catalog for the selected period and city.',
                  icon: 'dataset',
                  breakdown: [
                    { label: 'Eligible for field', value: formatter.format(eligibleForField) },
                    { label: 'Commercial / builders', value: formatter.format(commercialCount) },
                    { label: 'Added on site', value: formatter.format(manuallyAdded) },
                  ],
                  link: { label: 'Open all records', to: recordLink({}) },
                })
              }
            >
              <span className="k-kpi-label">Total properties</span>
              <span className="k-kpi-value">{formatter.format(totalRecords)}</span>
              <span className="k-kpi-sub">
                {formatter.format(eligibleForField)} eligible · {formatter.format(commercialCount)} commercial
              </span>
            </button>

            <button
              type="button"
              className="k-kpi is-qc"
              onClick={() =>
                openModal({
                  title: 'QC review',
                  category: 'Desk review',
                  value: formatter.format(totalQcReviewed),
                  description: 'Properties reviewed by the QC desk before they are released to the field team.',
                  icon: 'fact_check',
                  breakdown: [
                    { label: 'Approved for field', value: formatter.format(totalApproved) },
                    { label: 'Disapproved', value: formatter.format(totalDisapproved) },
                    { label: 'Waiting for review', value: formatter.format(pendingQc) },
                  ],
                  link: { label: 'Open the QC dashboard', to: '/auditor/dashboard' },
                })
              }
            >
              <span className="k-kpi-label">QC review</span>
              <span className="k-kpi-value">{formatter.format(totalQcReviewed)}</span>
              <span className="k-kpi-sub">reviewed</span>
              <span className="k-kpi-alert is-amber">{formatter.format(pendingQc)} waiting for review</span>
            </button>

            <button
              type="button"
              className="k-kpi is-field"
              onClick={() =>
                openModal({
                  title: 'Field verification',
                  category: 'Ground team',
                  value: formatter.format(completedVerifications),
                  description: 'Site visits completed by field verifiers. The rest of the eligible queue is still open.',
                  icon: 'pin_drop',
                  breakdown: [
                    { label: 'Eligible sites', value: formatter.format(eligibleForField) },
                    { label: 'Still to visit', value: formatter.format(pendingVerifications) },
                    { label: 'Construction confirmed', value: formatter.format(confirmedConstruction) },
                  ],
                  link: { label: 'View completed records', to: recordLink({ status: 'COMPLETED' }) },
                })
              }
            >
              <span className="k-kpi-label">Field verification</span>
              <span className="k-kpi-value">{formatter.format(completedVerifications)}</span>
              <span className="k-kpi-sub">visited</span>
              <span className="k-kpi-alert is-orange">{formatter.format(pendingVerifications)} still to visit</span>
            </button>

            <button
              type="button"
              className="k-kpi is-call"
              onClick={() =>
                openModal({
                  title: 'Telecalling',
                  category: 'Call desk',
                  value: formatter.format(callsCompleted),
                  description: 'Calls completed against verified phone numbers collected by the field team.',
                  icon: 'call',
                  breakdown: [
                    { label: 'Construction confirmed', value: formatter.format(callsConfirmed) },
                    { label: 'Follow-ups needed', value: formatter.format(followUps) },
                    { label: 'Not called yet', value: formatter.format(callsPending) },
                  ],
                  link: { label: 'Open the calling queue', to: '/telecaller/records' },
                })
              }
            >
              <span className="k-kpi-label">Telecalling</span>
              <span className="k-kpi-value">{formatter.format(callsCompleted)}</span>
              <span className="k-kpi-sub">called</span>
              <span className="k-kpi-alert is-green">
                {formatter.format(callsConfirmed)} confirmed · {formatter.format(followUps)} follow-ups
              </span>
            </button>
          </div>

          <div className="k-twocol">
            <section className="k-card k-funnel" aria-label="From property to confirmed lead">
              <div className="k-card-head">
                <div>
                  <h2 className="k-card-title">From property to confirmed lead</h2>
                  <p className="k-card-sub">How records move through QC, field verification and telecalling</p>
                </div>
              </div>
              <div className="k-funnel-rows">
                {funnelRows.map((row) => (
                  <div className="k-funnel-row" key={row.label}>
                    <span className={`k-role-tag is-${row.tone}`}>{row.role}</span>
                    <span className="k-funnel-label">{row.label}</span>
                    <span className="k-funnel-track">
                      <span
                        className={`k-funnel-fill is-${row.tone}`}
                        style={{ width: `${Math.max(row.value > 0 ? 2 : 0, pct(row.value, funnelMax))}%` }}
                      />
                    </span>
                    <span className="k-funnel-value">{formatter.format(row.value)}</span>
                    <span className="k-funnel-pct">{pct(row.value, identified)}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="k-card k-attention" aria-label="Needs attention">
              <div className="k-card-head">
                <div>
                  <h2 className="k-card-title">Needs attention</h2>
                  <p className="k-card-sub">Open work across the three desks</p>
                </div>
              </div>
              {attention.length === 0 ? (
                <div className="k-attention-empty">
                  <Icon name="check_circle" size={20} />
                  Nothing waiting. Every queue is clear.
                </div>
              ) : (
                <ul className="k-attention-list">
                  {attention.map((item) => (
                    <li key={item.text}>
                      <button type="button" onClick={() => navigate(item.to)}>
                        <span className={`k-dot is-${item.tone}`} aria-hidden="true" />
                        <span className="k-attention-text">
                          <strong>{formatter.format(item.count)}</strong> {item.text}
                        </span>
                        <Icon name="chevron_right" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="k-card k-section is-qc" aria-label="QC review">
            <div className="k-section-head">
              <div className="k-section-title-wrap">
                <span className="k-section-num is-purple">1</span>
                <div>
                  <h2 className="k-section-title">QC review</h2>
                  <p className="k-section-sub">Desk review of new properties before they go to the field team</p>
                </div>
              </div>
              <div className="k-section-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/auditor/dashboard')}>
                  QC dashboard
                </button>
                <button type="button" className="btn btn-royal btn-sm" onClick={() => navigate('/auditor/records')}>
                  Open QA portal
                </button>
              </div>
            </div>

            <div className="k-strip">
              {qcStats.map((s) => (
                <div className={`k-mini is-${s.tone}`} key={s.label}>
                  <span className="k-mini-label">{s.label}</span>
                  <span className="k-mini-value">{formatter.format(s.value)}</span>
                  <span className="k-mini-note">{s.note}</span>
                </div>
              ))}
            </div>

            <div className="k-table-wrap">
              <table className="k-table">
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    <th className="num">Assigned</th>
                    <th className="num">QC done</th>
                    <th className="num">Approved</th>
                    <th className="num">Disapproved</th>
                    <th className="num">Commercial</th>
                    <th className="num">Pending</th>
                    <th className="num">QA added</th>
                    <th className="k-col-progress">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {qaUsers.length === 0 && (
                    <tr>
                      <td colSpan={9} className="k-table-empty">
                        No reviewers assigned in this period.
                      </td>
                    </tr>
                  )}
                  {qaUsers.map((user: QaUserStat) => (
                    <tr key={user.user_id}>
                      <td>
                        <div className="k-person">
                          <Avatar name={user.user_name} size="sm" />
                          <div>
                            <span className="k-person-name">{user.user_name}</span>
                            <span className="k-person-role">{roleLabel(user.role)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="num">{formatter.format(user.total_assigned)}</td>
                      <td className="num">{formatter.format(user.qc_done)}</td>
                      <td className="num is-green">{formatter.format(user.approved)}</td>
                      <td className="num is-red">{formatter.format(user.disapproved)}</td>
                      <td className="num">{formatter.format(user.commercial)}</td>
                      <td className="num">{formatter.format(user.pending)}</td>
                      <td className="num">{formatter.format(user.qa_created || 0)}</td>
                      <td className="k-col-progress">
                        <ProgressCell value={user.completion_rate} tone="green" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="k-card k-section is-field" aria-label="Field verification">
            <div className="k-section-head">
              <div className="k-section-title-wrap">
                <span className="k-section-num is-orange">2</span>
                <div>
                  <h2 className="k-section-title">Field verification</h2>
                  <p className="k-section-sub">Site visits by the field team, construction status and contacts</p>
                </div>
              </div>
              <div className="k-section-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(recordLink({ status: 'COMPLETED' }))}
                >
                  View completed records
                </button>
                <button
                  type="button"
                  className="btn btn-royal btn-sm"
                  onClick={() => navigate(recordLink({ status: 'NOT_COMPLETED' }))}
                >
                  Assign pending records
                </button>
              </div>
            </div>

            <div className="k-strip">
              {fieldStats.map((s) => (
                <div className={`k-mini is-${s.tone}`} key={s.label}>
                  <span className="k-mini-label">{s.label}</span>
                  <span className="k-mini-value">{formatter.format(s.value)}</span>
                  <span className="k-mini-note">{s.note}</span>
                </div>
              ))}
            </div>

            <div className="k-field-grid">
              <div className="k-chart-card">
                <div className="k-chart-head">
                  <h3>Visits, last {Math.min(trends.length, 7) || 7} days</h3>
                  <div className="k-legend">
                    <span>
                      <i className="k-legend-line is-completed" /> Completed
                    </span>
                    <span>
                      <i className="k-legend-line is-assigned" /> Assigned
                    </span>
                  </div>
                </div>
                <VisitsChart
                  points={trends.map((t) => ({ label: t.label, completed: t.completed, assigned: t.assigned }))}
                />
              </div>

              <div className="k-table-wrap k-field-table">
                <table className="k-table">
                  <thead>
                    <tr>
                      <th>Field verifier</th>
                      <th className="num">Assigned</th>
                      <th className="num">Pending</th>
                      <th className="num">Done</th>
                      <th className="num">Confirmed</th>
                      <th className="num">Phones</th>
                      <th className="k-col-progress">Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operators.length === 0 && (
                      <tr>
                        <td colSpan={7} className="k-table-empty">
                          No field verifiers in this period.
                        </td>
                      </tr>
                    )}
                    {operators.slice(0, 5).map((op: InspectorStat) => (
                      <tr key={op.user_id}>
                        <td>
                          <div className="k-person">
                            <Avatar name={op.user_name} size="sm" />
                            <div>
                              <span className="k-person-name">{op.user_name}</span>
                              <span className="k-person-role">{roleLabel(op.role)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="num">{formatter.format(op.total_assigned)}</td>
                        <td className="num">{formatter.format(op.pending)}</td>
                        <td className="num">{formatter.format(op.completed)}</td>
                        <td className="num is-green">{formatter.format(op.confirmed_construction ?? 0)}</td>
                        <td className="num">{formatter.format(op.phones_obtained ?? 0)}</td>
                        <td className="k-col-progress">
                          <ProgressCell value={op.completion_rate} tone="orange" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="k-card k-section is-call" aria-label="Telecalling">
            <div className="k-section-head">
              <div className="k-section-title-wrap">
                <span className="k-section-num is-blue">3</span>
                <div>
                  <h2 className="k-section-title">Telecalling</h2>
                  <p className="k-section-sub">Calls to site contacts found during field verification</p>
                </div>
              </div>
              <div className="k-section-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/telecaller/records')}>
                  View call log
                </button>
                <button type="button" className="btn btn-royal btn-sm" onClick={() => navigate('/telecaller/dashboard')}>
                  Open telecalling portal
                </button>
              </div>
            </div>

            <div className="k-strip">
              {callStats.map((s) => (
                <div className={`k-mini is-${s.tone}`} key={s.label}>
                  <span className="k-mini-label">{s.label}</span>
                  <span className="k-mini-value">{formatter.format(s.value)}</span>
                  <span className="k-mini-note">{s.note}</span>
                </div>
              ))}
            </div>

            <div className="k-call-grid">
              <div className="k-outcome-card">
                <div className="k-chart-head">
                  <h3>Call outcomes</h3>
                  <span className="k-muted">{formatter.format(callTotal)} calls logged</span>
                </div>
                <StackedBar segments={callSegments} />
                <ul className="k-outcome-list">
                  {callSegments.map((s) => (
                    <li key={s.label}>
                      <span className={`k-dot is-${s.tone}`} aria-hidden="true" />
                      <span className="k-outcome-label">{s.label}</span>
                      <span className="k-outcome-count">{formatter.format(s.count)}</span>
                      <span className="k-outcome-pct">{pct(s.count, callTotal)}%</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="k-next-card">
                <div className="k-chart-head">
                  <h3>What to do next</h3>
                </div>
                <ul className="k-attention-list is-compact">
                  <li>
                    <button type="button" onClick={() => navigate('/telecaller/records')}>
                      <span className="k-dot is-amber" aria-hidden="true" />
                      <span className="k-attention-text">
                        <strong>{formatter.format(followUps)}</strong> follow-up calls scheduled
                      </span>
                      <Icon name="chevron_right" size={16} />
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => navigate('/telecaller/records')}>
                      <span className="k-dot is-red" aria-hidden="true" />
                      <span className="k-attention-text">
                        <strong>{formatter.format(notReachable)}</strong> not reachable — retry at a different time
                      </span>
                      <Icon name="chevron_right" size={16} />
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => navigate('/telecaller/records')}>
                      <span className="k-dot is-neutral" aria-hidden="true" />
                      <span className="k-attention-text">
                        <strong>{formatter.format(callsPending)}</strong> leads not called yet
                      </span>
                      <Icon name="chevron_right" size={16} />
                    </button>
                  </li>
                  {phonesObtained > totalLeads && (
                    <li>
                      <button type="button" onClick={() => navigate('/telecaller/records')}>
                        <span className="k-dot is-blue" aria-hidden="true" />
                        <span className="k-attention-text">
                          <strong>{formatter.format(phonesObtained - totalLeads)}</strong> phone numbers not yet sent to
                          telecalling
                        </span>
                        <Icon name="chevron_right" size={16} />
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </section>

          <section className="k-card k-activity" aria-label="Recent activity">
            <div className="k-section-head is-flat">
              <h2 className="k-card-title">Recent activity</h2>
              <div className="k-activity-tabs" role="tablist" aria-label="Activity filter">
                {(
                  [
                    ['all', 'All'],
                    ['qc', 'QC'],
                    ['field', 'Field'],
                    ['telecalling', 'Telecalling'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activityFilter === key}
                    className={activityFilter === key ? 'is-active' : ''}
                    onClick={() => setActivityFilter(key)}
                  >
                    {label}
                  </button>
                ))}
                <button type="button" className="k-activity-link" onClick={() => navigate('/admin/logs')}>
                  Full audit trail
                </button>
              </div>
            </div>
            <ul className="k-activity-list">
              {visibleActivities.length === 0 && <li className="k-table-empty">No activity for this filter yet.</li>}
              {visibleActivities.slice(0, 8).map((activity) => {
                const tone = activityTone(activity.type);
                return (
                  <li key={activity.id}>
                    <span className={`k-activity-icon is-${tone}`}>
                      <Icon name={activityIcon[tone]} size={14} />
                    </span>
                    <span className="k-activity-body">
                      <span className="k-activity-title">{activity.title}</span>
                      {activity.detail && <span className="k-activity-detail">{activity.detail}</span>}
                    </span>
                    <span className="k-activity-meta">
                      {activity.user_name || 'System'} · {formatDateTime(activity.timestamp)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {modalStat && (
            <div
              className="k-modal-backdrop"
              onClick={() => setModalStat(null)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="k-stat-title"
            >
              <div className="k-modal" onClick={(e) => e.stopPropagation()}>
                <div className="k-modal-head">
                  <div>
                    <span className="k-modal-category">{modalStat.category}</span>
                    <h2 id="k-stat-title" className="k-modal-title">
                      {modalStat.title}
                    </h2>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setModalStat(null)} aria-label="Close">
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="k-modal-body">
                  <div className="k-modal-value">{modalStat.value}</div>
                  <p className="k-modal-desc">{modalStat.description}</p>
                  {modalStat.breakdown && (
                    <ul className="k-modal-list">
                      {modalStat.breakdown.map((item) => (
                        <li key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="k-modal-foot">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModalStat(null)}>
                    Close
                  </button>
                  {modalStat.link && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        const to = modalStat.link!.to;
                        setModalStat(null);
                        navigate(to);
                      }}
                    >
                      {modalStat.link.label}
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
