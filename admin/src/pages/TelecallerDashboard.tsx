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

export default function TelecallerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<TelecallerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<CaptureRecord | null>(null);

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

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Telecaller Command Center</h1>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 6,
            background: '#fee2e2',
            color: '#bf3646',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          Calling Operations
        </span>
      </div>
    ),
    right: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/telecaller/records')}
          style={{
            background: '#bf3646',
            borderColor: '#bf3646',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 14px',
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            border: 'none',
            boxShadow: '0 2px 4px rgba(191, 54, 70, 0.2)',
          }}
          title="Open telecaller calling queue"
        >
          <Icon name="call" size={15} />
          <span>Calling Queue</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadData()}
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
          <Icon name="refresh" size={15} className={loading ? 'fos-spin' : undefined} />
          <span>Refresh</span>
        </button>
      </div>
    ),
  });

  if (loading) {
    return (
      <PageShell>
        <LoadingPanel text="Loading telecaller dashboard metrics..." />
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

  const { metrics, recent_calls } = data;

  const cards = [
    {
      label: 'Total Leads with Phone',
      value: metrics.total_eligible,
      icon: 'call',
      color: '#0284c7',
      bg: '#f0f9ff',
      border: '#e0f2fe',
      badge: 'Eligible Leads',
      badgeColor: '#0369a1',
      badgeBg: '#f0f9ff',
      badgeBorder: '#e0f2fe',
      sub: 'Owner & contractor contacts',
      filter: 'ALL',
    },
    {
      label: 'Pending Calls',
      value: metrics.pending_calls,
      icon: 'schedule',
      color: '#d97706',
      bg: '#fffbeb',
      border: '#fef3c7',
      badge: 'To Call',
      badgeColor: '#92400e',
      badgeBg: '#fffbeb',
      badgeBorder: '#fef3c7',
      sub: 'Awaiting telecaller outreach',
      filter: 'PENDING',
    },
    {
      label: 'Construction Confirmed',
      value: metrics.construction_confirmed,
      icon: 'check_circle',
      color: '#059669',
      bg: '#ecfdf5',
      border: '#d1fae5',
      badge: 'Verified',
      badgeColor: '#065f46',
      badgeBg: '#ecfdf5',
      badgeBorder: '#d1fae5',
      sub: 'Confirmed building progress',
      filter: 'CONSTRUCTION_CONFIRMED',
    },
    {
      label: 'Follow Up Needed',
      value: metrics.connected_follow_up,
      icon: 'phone_in_talk',
      color: '#2563eb',
      bg: '#eff6ff',
      border: '#dbeafe',
      badge: 'Callbacks',
      badgeColor: '#1e40af',
      badgeBg: '#eff6ff',
      badgeBorder: '#dbeafe',
      sub: 'Connected, callback required',
      filter: 'CONNECTED_FOLLOW_UP',
    },
    {
      label: 'Not Reachable',
      value: metrics.not_reachable,
      icon: 'phone_missed',
      color: '#e11d48',
      bg: '#fff1f2',
      border: '#ffe4e6',
      badge: 'Retry',
      badgeColor: '#9f1239',
      badgeBg: '#fff1f2',
      badgeBorder: '#ffe4e6',
      sub: 'Switched off / unanswered',
      filter: 'NOT_REACHABLE',
    },
    {
      label: 'Calls Today',
      value: metrics.called_today,
      icon: 'today',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ede9fe',
      badge: 'Daily Velocity',
      badgeColor: '#5b21b6',
      badgeBg: '#f5f3ff',
      badgeBorder: '#ede9fe',
      sub: 'Interactions logged today',
      filter: 'TODAY',
    },
  ];

  const getStatusChip = (st?: string | null) => {
    if (!st || st === 'PENDING') {
      return (
        <span className="telecaller-chip telecaller-status-pending">
          <Icon name="schedule" size={12} /> Pending
        </span>
      );
    }
    const opt = TELECALLER_STATUS_OPTIONS.find((o) => o.value === st);
    if (st === 'CONSTRUCTION_CONFIRMED') {
      return (
        <span className="telecaller-chip telecaller-status-confirmed">
          <Icon name="check_circle" size={12} /> Confirmed
        </span>
      );
    }
    if (st === 'CONNECTED_FOLLOW_UP') {
      return (
        <span className="telecaller-chip telecaller-status-followup">
          <Icon name="call" size={12} /> Follow Up
        </span>
      );
    }
    if (st === 'NOT_REACHABLE') {
      return (
        <span className="telecaller-chip telecaller-status-unreachable">
          <Icon name="block" size={12} /> Unreachable
        </span>
      );
    }
    if (st === 'WRONG_NUMBER') {
      return (
        <span className="telecaller-chip telecaller-status-wrong">
          <Icon name="block" size={12} /> Wrong No
        </span>
      );
    }
    return (
      <span className="telecaller-chip telecaller-status-pending">
        {opt?.label || st}
      </span>
    );
  };

  const totalCalled = metrics.total_eligible - metrics.pending_calls;
  const contactRate = metrics.total_eligible > 0 ? Math.round((totalCalled / metrics.total_eligible) * 100) : 0;
  const confirmedRate = totalCalled > 0 ? Math.round((metrics.construction_confirmed / totalCalled) * 100) : 0;

  return (
    <PageShell>
      <div style={{ width: '100%', maxWidth: '100%', margin: 0, padding: '4px 0 32px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Top Header Hero Card */}
        <header
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 700,
                color: '#9f1239',
                background: '#fff1f2',
                border: '1px solid #fecdd3',
                padding: '3px 9px',
                borderRadius: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                width: 'fit-content',
              }}
            >
              <Icon name="call" size={13} style={{ color: '#e11d48' }} />
              Telecaller Operations Desk • Live Calling Engine
            </span>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0 0', letterSpacing: '-0.025em' }}>
              Telecalling Command Center
            </h2>
            <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="schedule" size={14} />
              Review verified property leads, confirm ongoing construction, and register owner follow-ups.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 600,
                color: '#475569',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              {metrics.total_eligible.toLocaleString()} Verified Contacts
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/telecaller/records')}
              style={{
                background: '#bf3646',
                borderColor: '#bf3646',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                padding: '0 15px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                color: '#fff',
                border: 'none',
                boxShadow: '0 2px 4px rgba(191, 54, 70, 0.2)',
              }}
              title="Open Calling Queue"
            >
              <Icon name="arrow_forward" size={15} />
              <span>Calling Queue</span>
            </button>
          </div>
        </header>

        {/* Metric Cards Grid (100% Full-Width) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 16,
          }}
        >
          {cards.map((c) => (
            <div
              key={c.label}
              className="card clickable-stat"
              onClick={() => navigate(`/telecaller/records?status=${c.filter}`)}
              style={{
                padding: '18px 20px',
                borderRadius: 16,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease',
              }}
              title={`View ${c.label} in Calling Queue`}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: c.bg,
                    color: c.color,
                    border: `1px solid ${c.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={c.icon as any} size={20} />
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 9999,
                    background: c.badgeBg,
                    color: c.badgeColor,
                    border: `1px solid ${c.badgeBorder}`,
                    letterSpacing: '0.01em',
                  }}
                >
                  {c.badge}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, letterSpacing: '-0.03em' }}>
                  {c.value.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginTop: 4 }}>
                  {c.label}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>{c.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Middle Tier: Calling Performance Funnel & Outcome Distribution */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
          {/* Left Column: Calling Conversion Funnel */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '22px 24px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: '0 0 3px 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="trending_up" size={19} style={{ color: '#059669' }} />
                  Calling Outreach &amp; Conversion Funnel
                </h3>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                  Coverage of verified contact numbers and construction confirmation yield
                </p>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#065f46',
                  background: '#ecfdf5',
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: '1px solid #a7f3d0',
                }}
              >
                {contactRate}% Contacted
              </span>
            </div>

            {/* Funnel Progress Bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  <span>1. Verified Contacts in Queue</span>
                  <strong>{metrics.total_eligible.toLocaleString()} (100%)</strong>
                </div>
                <div style={{ width: '100%', height: 7, background: '#f1f5f9', borderRadius: 9999, overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: '100%', background: '#0284c7', borderRadius: 9999 }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  <span>2. Calls Completed</span>
                  <strong>{totalCalled.toLocaleString()} ({contactRate}%)</strong>
                </div>
                <div style={{ width: '100%', height: 7, background: '#f1f5f9', borderRadius: 9999, overflow: 'hidden' }}>
                  <div style={{ width: `${contactRate}%`, height: '100%', background: '#2563eb', borderRadius: 9999 }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  <span>3. Construction Confirmed by Owner/Contractor</span>
                  <strong style={{ color: '#059669' }}>{metrics.construction_confirmed.toLocaleString()} ({confirmedRate}% of called)</strong>
                </div>
                <div style={{ width: '100%', height: 7, background: '#f1f5f9', borderRadius: 9999, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (metrics.construction_confirmed / (metrics.total_eligible || 1)) * 100)}%`, height: '100%', background: '#059669', borderRadius: 9999 }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, borderTop: '1px solid #f1f5f9', paddingTop: 14, fontSize: 12, color: '#475569' }}>
              <div>
                <span style={{ color: '#64748b' }}>Pending Queue:</span>{' '}
                <strong style={{ color: '#d97706' }}>{metrics.pending_calls.toLocaleString()} leads</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Logged Today:</span>{' '}
                <strong style={{ color: '#7c3aed' }}>{metrics.called_today.toLocaleString()} calls</strong>
              </div>
            </div>
          </div>

          {/* Right Column: Call Disposition Summary */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '22px 24px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 3px 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="pie_chart" size={19} style={{ color: '#2563eb' }} />
                Call Outcome Dispositions
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                Summary of lead responses and callback requirements
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #d1fae5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="check_circle" size={16} style={{ color: '#059669' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#065f46' }}>Construction Confirmed</span>
                </div>
                <strong style={{ fontSize: 14, color: '#065f46' }}>{metrics.construction_confirmed}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid #dbeafe' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="phone_in_talk" size={16} style={{ color: '#2563eb' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e40af' }}>Follow Up Required</span>
                </div>
                <strong style={{ fontSize: 14, color: '#1e40af' }}>{metrics.connected_follow_up}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fff1f2', border: '1px solid #ffe4e6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="phone_missed" size={16} style={{ color: '#e11d48' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#9f1239' }}>Not Reachable / Busy</span>
                </div>
                <strong style={{ fontSize: 14, color: '#9f1239' }}>{metrics.not_reachable}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Launch Action Banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%)',
            border: '1px solid #fecaca',
            borderRadius: 16,
            padding: '18px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            boxShadow: '0 1px 3px rgba(191, 54, 70, 0.04)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#991b1b' }}>
              Ready to make calls?
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#7f1d1d' }}>
              Review pending leads with verified field inspection data, confirm construction activity, and update caller notes in real-time.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/telecaller/records')}
            style={{
              background: '#bf3646',
              borderColor: '#bf3646',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 38,
              padding: '0 18px',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 9,
              boxShadow: '0 2px 6px rgba(191, 54, 70, 0.25)',
            }}
          >
            <Icon name="call" size={16} />
            Open Calling Queue ({metrics.pending_calls} Pending)
          </button>
        </div>

        {/* Recently Logged Calls Table */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              paddingBottom: 10,
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="history" size={20} style={{ color: '#bf3646' }} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                Recently Logged Calls
              </h3>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate('/telecaller/records')}
              style={{ fontSize: 12, fontWeight: 600, color: '#bf3646' }}
            >
              View all leads →
            </button>
          </div>

          {recent_calls.length === 0 ? (
            <EmptyPanel icon="call" text="No calls have been logged yet. Open the Calling Queue to start verifying leads." />
          ) : (
            <div className="table-scroll">
              <table className="fos-table records-table">
                <thead>
                  <tr>
                    <th style={{ width: 150, minWidth: 145, maxWidth: 160, textAlign: 'left' }}>Unique ID</th>
                    <th style={{ width: 180, minWidth: 160, maxWidth: 220, textAlign: 'left' }}>Owner / Client</th>
                    <th style={{ width: 140, minWidth: 130, maxWidth: 150, textAlign: 'left' }}>Contact Number</th>
                    <th style={{ width: 140, minWidth: 130, maxWidth: 150, textAlign: 'left' }}>Call Status</th>
                    <th style={{ width: 220, minWidth: 180, maxWidth: 260, textAlign: 'left' }}>Comments</th>
                    <th style={{ width: 150, minWidth: 140, maxWidth: 160, textAlign: 'left' }}>Called At</th>
                    <th style={{ width: 90, minWidth: 80, maxWidth: 100, textAlign: 'left' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_calls.map((r) => {
                    const o = (r.owner_name_en || '').trim();
                    const isBad = (v: string) => !v || v.toLowerCase() === 'new' || v === r.unique_id;
                    const cleanOwner = !isBad(o) ? o : (!isBad((r.name || '').trim()) ? (r.name || '').trim() : '');
                    return (
                      <tr
                        key={r.id}
                        className="rowlink"
                        onClick={() => setActiveRecord(r)}
                      >
                        <td
                          className="rec-unique-id mono-sm col-unique-id"
                          style={{ whiteSpace: 'nowrap', textAlign: 'left', fontWeight: 700, color: '#0f172a' }}
                        >
                          {r.unique_id || `#${r.id}`}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <div className="rec-text-cell" style={{ maxWidth: 200, textAlign: 'left' }}>
                            <ExpandableCellText text={cleanOwner || null} maxChars={28} />
                          </div>
                        </td>
                        <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#059669' }}>
                            {r.contact_number || r.site_contractor_architect_number || '—'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'left' }}>{getStatusChip(r.telecaller_status)}</td>
                        <td style={{ textAlign: 'left' }}>
                          {r.telecaller_comment ? (
                            <div className="rec-text-cell" style={{ maxWidth: 220, textAlign: 'left' }}>
                              <ExpandableCellText text={r.telecaller_comment} maxChars={35} />
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {r.telecaller_called_at ? formatDateTime(r.telecaller_called_at) : '—'}
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setActiveRecord(r)}
                            style={{ height: 28, padding: '0 10px', fontSize: 11, borderRadius: 7 }}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
