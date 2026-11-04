import { useEffect, useState, useRef } from 'react';
import DailyActivityChart from '../components/DailyActivityChart';
import type { CaptureRecord, DashboardStats, User } from '../types';
import { api } from '../services/api';
import Icon from '../components/common/Icon';
import { StatCardSkeleton } from '../components/common/Skeleton';
import { useGps } from '../hooks/useGps';
import { captureRange, type CaptureRange } from '../utils/dateRange';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';

interface DashboardScreenProps {
  currentUser?: User | null;
  onOpenRecord?: (id: number) => void;
  onStartInspection?: (record: CaptureRecord) => void;
  onSelectMatrixFilter?: (filter: {
    datePreset?: 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
    status?: 'ALL' | 'NOT_COMPLETED' | 'COMPLETED';
    hasPhotosOnly?: boolean;
    viewMode?: 'records' | 'gallery';
  }) => void;
}

export default function DashboardScreen({
  currentUser,
  onOpenRecord,
  onStartInspection,
  onSelectMatrixFilter,
}: DashboardScreenProps) {
  const [dateRange, setDateRange] = useState<CaptureRange>('ALL');
  const requestSeq = useRef(0);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedTime, setSyncedTime] = useState<string>('Live');
  const gps = useGps();

  const loadData = async (isManualRefresh = false) => {
    const request = ++requestSeq.current;
    const dates = captureRange(dateRange);
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const dashRes = await api.getDashboard({ ...dates });
      if (request !== requestSeq.current) return;
      if (dashRes) setStats(dashRes);
      setSyncedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      if (request === requestSeq.current) setError(err?.message || 'Failed to load dashboard data');
    } finally {
      if (request === requestSeq.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      requestSeq.current++;
    };
  }, [dateRange]);

  const refreshDashboard = async () => {
    await loadData(true);
  };
  useForegroundRefresh(refreshDashboard);

  const statItems = [
    {
      label: 'Assigned Records',
      value: stats?.total_records ?? 0,
      icon: 'folder_open',
      accent: '#e11d48',
      accentBg: '#fff1f2',
      border: '#ffe4e6',
      badge: 'ALL QUEUE',
      badgeBg: '#fff1f2',
      badgeColor: '#9f1239',
      sub: 'Total assigned sites',
      filterPreset: { datePreset: dateRange, status: 'ALL' as const },
    },
    {
      label: 'Completed Visits',
      value: stats?.total_completed_records ?? 0,
      icon: 'task_alt',
      accent: '#059669',
      accentBg: '#ecfdf5',
      border: '#d1fae5',
      badge: 'COMPLETED',
      badgeBg: '#ecfdf5',
      badgeColor: '#065f46',
      sub: 'Inspected with photos',
      filterPreset: { datePreset: dateRange, status: 'COMPLETED' as const },
    },
    {
      label: 'Construction: Yes',
      value: stats?.construction_yes_records ?? 0,
      icon: 'construction',
      accent: '#d97706',
      accentBg: '#fffbeb',
      border: '#fef3c7',
      badge: 'ACTIVE SITES',
      badgeBg: '#fffbeb',
      badgeColor: '#92400e',
      sub: 'Building in progress',
      filterPreset: { datePreset: dateRange, status: 'ALL' as const },
    },
    {
      label: 'Mobile Numbers',
      value: stats?.mobile_numbers_collected ?? 0,
      icon: 'phone',
      accent: '#7c3aed',
      accentBg: '#f5f3ff',
      border: '#ede9fe',
      badge: 'CONTACTS',
      badgeBg: '#f5f3ff',
      badgeColor: '#5b21b6',
      sub: 'Owner / contractor phones',
      filterPreset: { datePreset: dateRange, status: 'ALL' as const },
    },
    {
      label: 'Field Added Sites',
      value: stats?.manually_added_records ?? 0,
      icon: 'add_location_alt',
      accent: '#0284c7',
      accentBg: '#f0f9ff',
      border: '#e0f2fe',
      badge: 'NEW LEADS',
      badgeBg: '#f0f9ff',
      badgeColor: '#075985',
      sub: 'Discovered on-ground',
      filterPreset: { datePreset: dateRange, status: 'ALL' as const },
    },
  ];

  /* GNSS telemetry view */
  const gpsView = (() => {
    switch (gps.state) {
      case 'ready':
        return {
          label: 'GPS READY',
          sub: gps.place
            ? `${gps.place} · ±${Math.round(gps.fix?.accuracy ?? 0)} m`
            : `±${Math.round(gps.fix?.accuracy ?? 0)} m accuracy`,
          color: '#059669',
          bg: '#ecfdf5',
          border: '#a7f3d0',
          icon: 'navigation' as const,
          pulsing: true,
        };
      case 'locating':
        return {
          label: 'ACQUIRING GPS',
          sub: 'Waiting for a satellite fix…',
          color: '#d97706',
          bg: '#fffbeb',
          border: '#fde68a',
          icon: 'gps_fixed' as const,
          pulsing: false,
        };
      case 'denied':
        return {
          label: 'GPS BLOCKED',
          sub: 'Location is off — allow it, or use HTTPS on a phone.',
          color: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
          icon: 'gps_off' as const,
          pulsing: false,
        };
      case 'unsupported':
        return {
          label: 'GPS OFF',
          sub: 'This browser has no Geolocation API.',
          color: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
          icon: 'gps_off' as const,
          pulsing: false,
        };
      default:
        return {
          label: 'NO FIX',
          sub: 'Position unavailable — retry outdoors.',
          color: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
          icon: 'gps_off' as const,
          pulsing: false,
        };
    }
  })();

  const operatorName = currentUser?.full_name?.split(' ')[0] || currentUser?.email?.split('@')[0] || 'Operator';

  return (
    <div style={{ width: '100%', maxWidth: '100%', margin: 0 }}>
      {/* ─── Compact Header Greeting ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '2px 4px' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 6 }}>
          Hello, {operatorName} 👋
        </h1>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            borderRadius: 9999,
            backgroundColor: '#ecfdf5',
            color: '#065f46',
            fontSize: '0.68rem',
            fontWeight: 700,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#059669' }} />
          <span>Live Sync</span>
        </div>
      </div>

      {/* ─── Capture Date Filter Pills ─── */}
      <section
        style={{
          background: '#ffffff',
          padding: '10px 12px',
          borderRadius: 14,
          marginBottom: 10,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
        }}
        aria-label="Dashboard capture filters"
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Capture date:</span>
          {([['ALL', 'All time'], ['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['THIS_WEEK', 'This week']] as const).map(([value, label]) => (
            <button
              type="button"
              className={`btn ${dateRange === value ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              key={value}
              onClick={() => setDateRange(value)}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                borderRadius: 8,
                fontWeight: dateRange === value ? 700 : 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.68rem', color: '#64748b', margin: '4px 0 0 0' }}>
          India time. Mobile count includes unique contact and contractor numbers.
        </p>
      </section>

      {/* ─── GNSS Telemetry Bar ─── */}
      <div className="telemetry-bar" style={{ padding: '8px 12px', marginBottom: 10, borderRadius: 14 }}>
        <div className="telemetry-left">
          <div
            className="telemetry-icon-wrap"
            style={{ backgroundColor: gpsView.bg, borderColor: gpsView.border, width: 30, height: 30 }}
          >
            <Icon name={gpsView.icon} size={16} color={gpsView.color} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="telemetry-status-row">
              <div
                className="telemetry-dot"
                style={{ backgroundColor: gpsView.color, animation: gpsView.pulsing ? undefined : 'none' }}
              />
              <span className="telemetry-status-text" style={{ color: gpsView.color }}>
                {gpsView.label}
              </span>
            </div>
            <div className="telemetry-subtext">{gpsView.sub}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {gps.state !== 'ready' && gps.state !== 'unsupported' && (
            <button
              type="button"
              onClick={gps.retry}
              className="gps-retry-btn"
              title="Get my location again"
              aria-label="Get my location again"
              style={{ width: 28, height: 28 }}
            >
              <Icon name="my_location" size={14} color={gpsView.color} />
            </button>
          )}
          <div className="sync-pill" style={{ padding: '3px 8px', fontSize: '0.65rem' }}>
            <Icon name="check" size={12} color="#059669" />
            <span>Synced {syncedTime}</span>
          </div>

          <button
            type="button"
            onClick={refreshDashboard}
            disabled={isRefreshing || loading}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '9999px',
              padding: '5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
            title="Refresh data"
          >
            <span
              style={{
                display: 'inline-flex',
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <Icon name="refresh" size={14} color={isRefreshing ? '#FF6467' : '#64748b'} />
            </span>
          </button>
        </div>
      </div>

      {/* ─── Modern Field Stat Cards Grid (Dasher / SaaS Style) ─── */}
      <div className="grid-stats">
        {loading && !stats ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          statItems.map((s) => (
            <div
              key={s.label}
              className="stat-card"
              onClick={() => {
                if (onSelectMatrixFilter && s.filterPreset) {
                  onSelectMatrixFilter(s.filterPreset);
                }
              }}
              style={{
                cursor: 'pointer',
                borderRadius: 16,
                padding: '14px 16px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (s.filterPreset && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onSelectMatrixFilter?.(s.filterPreset);
                }
              }}
              title={`View ${s.label} in Records`}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 11,
                    backgroundColor: s.accentBg,
                    border: `1px solid ${s.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={s.icon} size={18} color={s.accent} />
                </div>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 9999,
                    backgroundColor: s.badgeBg,
                    color: s.badgeColor,
                    border: `1px solid ${s.border}`,
                    letterSpacing: '0.02em',
                  }}
                >
                  {s.badge}
                </span>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '1.65rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    lineHeight: 1.15,
                    letterSpacing: '-0.025em',
                  }}
                >
                  {s.value.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#1e293b',
                    marginTop: 3,
                  }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                  {s.sub}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  marginTop: 8,
                  paddingTop: 6,
                  borderTop: '1px solid #f1f5f9',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: s.accent,
                }}
              >
                <span>View records</span>
                <Icon name="arrow_forward" size={11} color={s.accent} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            backgroundColor: '#FFF7F7',
            border: '1px solid #FFD2D2',
            color: '#A13F40',
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="error" size={16} color="#dc2626" />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadData()}>
            Retry
          </button>
        </div>
      )}

      {/* ─── Daily Activity Trend Chart ─── */}
      {!loading && stats && stats.daily_activity && (
        <div style={{ marginBottom: 14 }}>
          <DailyActivityChart dateBasis="captured" days={stats.daily_activity} />
        </div>
      )}

      {/* ─── Direct Navigation to Records Tab ─── */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: '14px 16px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
          Field Inspections & Tasks
        </div>
        <p style={{ fontSize: '0.74rem', color: '#64748b', margin: '0 0 10px 0' }}>
          Task queue, routing, maps, directions, and inspection history are in the Records tab.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{
            width: '100%',
            maxWidth: 280,
            margin: '0 auto',
            padding: '9px 16px',
            fontSize: '0.8125rem',
            fontWeight: 700,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
          onClick={() => onSelectMatrixFilter?.({ datePreset: dateRange, status: 'ALL' })}
        >
          <Icon name="fact_check" size={17} color="#ffffff" />
          <span>Open Records Tab</span>
          <Icon name="arrow_forward" size={14} color="#ffffff" />
        </button>
      </div>
    </div>
  );
}
