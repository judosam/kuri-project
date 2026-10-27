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
        <h1 className="topbar-page-title">Telecaller Dashboard</h1>
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
          Overview
        </span>
      </div>
    ),
    right: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadData()}
          title="Refresh dashboard metrics"
        >
          <Icon name="refresh" size={14} className={loading ? 'fos-spin' : undefined} />
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/telecaller/records')}
          style={{
            background: '#bf3646',
            borderColor: '#bf3646',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Icon name="call" size={14} />
          Calling Queue
        </button>
      </div>
    ),
  });

  if (loading) {
    return (
      <PageShell>
        <LoadingPanel text="Loading telecaller dashboard..." />
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
      color: '#475569',
      bg: '#f1f5f9',
      sub: 'Eligible with phone numbers',
    },
    {
      label: 'Pending Calls',
      value: metrics.pending_calls,
      icon: 'schedule',
      color: '#d97706',
      bg: '#fffbeb',
      sub: 'Awaiting telecaller call',
    },
    {
      label: 'Construction Confirmed',
      value: metrics.construction_confirmed,
      icon: 'check_circle',
      color: '#059669',
      bg: '#ecfdf5',
      sub: 'Confirmed by phone',
    },
    {
      label: 'Follow Up Needed',
      value: metrics.connected_follow_up,
      icon: 'call',
      color: '#1d4ed8',
      bg: '#eff6ff',
      sub: 'Connected, callback required',
    },
    {
      label: 'Not Reachable',
      value: metrics.not_reachable,
      icon: 'block',
      color: '#c2410c',
      bg: '#fff7ed',
      sub: 'Ringing / Switched off',
    },
    {
      label: 'Called Today',
      value: metrics.called_today,
      icon: 'schedule',
      color: '#7c3aed',
      bg: '#f5f3ff',
      sub: 'Calls logged today',
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

  return (
    <PageShell>
      {/* Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {c.label}
              </span>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: c.bg,
                  color: c.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={c.icon as any} size={16} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                {c.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{c.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Launch Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%)',
          border: '1px solid #fecaca',
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#991b1b' }}>
            Ready to make calls?
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#7f1d1d' }}>
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
            gap: 6,
            height: 34,
            padding: '0 16px',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Icon name="call" size={15} />
          Open Calling Queue ({metrics.pending_calls} Pending)
        </button>
      </div>

      {/* Recent Calls Logged */}
      <div className="card" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="history" size={18} style={{ color: '#bf3646' }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              Recently Logged Calls
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/telecaller/records')}
            style={{ fontSize: 11 }}
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
                          style={{ height: 24, padding: '0 8px', fontSize: 10.5 }}
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
    </PageShell>
  );
}
