import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { logsApi, usersApi } from '../services/api';
import type { ActivityEntry, ActivityLog, User } from '../types';
import {
  Icon,
  Avatar,
  EmptyPanel,
  LoadingPanel,
  PageShell,
  formatDate,
  parseUtcDate,
  CustomSelect,
  type IconName,
} from '../components/ui';
import { enName } from '../utils/english';
import { useTopHeader } from '../context/HeaderContext';

export type ActivityGroup =
  | 'ALL'
  | 'FIELD_VERIFIER'
  | 'QA_AUDIT'
  | 'TELECALLING'
  | 'ADMIN_ASSIGNMENTS'
  | 'SYSTEM_AUTH';

interface GroupTabDef {
  key: ActivityGroup;
  label: string;
  icon: IconName;
  color: string;
  bg: string;
  desc: string;
}

const GROUP_TABS: GroupTabDef[] = [
  { key: 'ALL', label: 'All Activities', icon: 'receipt_long', color: '#475569', bg: '#f1f5f9', desc: 'All platform activity' },
  { key: 'FIELD_VERIFIER', label: 'Field Verifier', icon: 'camera_alt', color: '#0284c7', bg: '#e0f2fe', desc: 'Revisits, site photos & surveys' },
  { key: 'QA_AUDIT', label: 'QA / Audit', icon: 'assignment_turned_in', color: '#7c3aed', bg: '#f5f3ff', desc: 'Audited records, QA created & reviewed' },
  { key: 'TELECALLING', label: 'Telecalling', icon: 'phone_in_talk', color: '#059669', bg: '#ecfdf5', desc: 'Phone logs, confirmations & feedback' },
  { key: 'ADMIN_ASSIGNMENTS', label: 'Admin Assignments', icon: 'group', color: '#d97706', bg: '#fef3c7', desc: 'Allocations to QA, Verifiers & Telecallers' },
  { key: 'SYSTEM_AUTH', label: 'System & Auth', icon: 'security', color: '#dc2626', bg: '#fee2e2', desc: 'Logins, credentials & system audits' },
];

export function getEntryGroup(item: ActivityEntry): ActivityGroup {
  const act = (item.action_type || '').toLowerCase();
  const tit = (item.title || '').toLowerCase();
  const typ = (item.type || '').toLowerCase();
  const role = (item.user_role || '').toUpperCase();

  // 1. Admin Assignments
  if (
    act.includes('assign') ||
    act.includes('reassign') ||
    tit.includes('routed') ||
    tit.includes('assigned') ||
    tit.includes('reassigned') ||
    tit.includes('unassigned')
  ) {
    return 'ADMIN_ASSIGNMENTS';
  }

  // 2. Telecalling
  if (
    act.includes('telecaller') ||
    role === 'TELECALLER' ||
    tit.includes('call') ||
    tit.includes('telecall') ||
    tit.includes('phone')
  ) {
    return 'TELECALLING';
  }

  // 3. QA / Audit
  if (
    act === 'record_qc' ||
    act === 'record_audit' ||
    act === 'qa_create_record' ||
    role === 'AUDITOR' ||
    tit.includes('qa') ||
    tit.includes('qc') ||
    tit.includes('audit')
  ) {
    return 'QA_AUDIT';
  }

  // 4. System & Auth
  if (
    typ === 'auth' ||
    typ === 'security' ||
    typ === 'user' ||
    act.includes('login') ||
    act.includes('logout') ||
    act.includes('password') ||
    act.includes('user') ||
    tit.includes('sign-in') ||
    tit.includes('session')
  ) {
    return 'SYSTEM_AUTH';
  }

  // 5. Field Verifier (Default for records/photos)
  return 'FIELD_VERIFIER';
}

function getGroupIcon(group: ActivityGroup): { icon: IconName; color: string; bg: string } {
  switch (group) {
    case 'FIELD_VERIFIER':
      return { icon: 'camera_alt', color: '#0284c7', bg: '#e0f2fe' };
    case 'QA_AUDIT':
      return { icon: 'assignment_turned_in', color: '#7c3aed', bg: '#f5f3ff' };
    case 'TELECALLING':
      return { icon: 'phone_in_talk', color: '#059669', bg: '#ecfdf5' };
    case 'ADMIN_ASSIGNMENTS':
      return { icon: 'group', color: '#d97706', bg: '#fef3c7' };
    case 'SYSTEM_AUTH':
      return { icon: 'security', color: '#dc2626', bg: '#fee2e2' };
    default:
      return { icon: 'receipt_long', color: '#475569', bg: '#f1f5f9' };
  }
}

function toDateKey(iso: string): string {
  const d = parseUtcDate(iso) || new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayHeading(iso: string): { key: string; label: string } {
  const d = parseUtcDate(iso) || new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'x', label: 'Unknown' };
  const now = new Date();
  const todayKey = toDateKey(now.toISOString());
  const yKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString());
  const key = toDateKey(iso);
  if (key === todayKey) return { key, label: 'Today' };
  if (key === yKey) return { key, label: 'Yesterday' };
  return { key: 'earlier', label: 'Earlier' };
}

function formatTime(iso: string): string {
  const d = parseUtcDate(iso) || new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const LIMIT = 300;

export default function Logs() {
  const navigate = useNavigate();
  const [data, setData] = useState<ActivityLog | null>(null);
  const [activeGroup, setActiveGroup] = useState<ActivityGroup>('ALL');
  const [userId, setUserId] = useState('');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [hasFetchedUsers, setHasFetchedUsers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    if (hasFetchedUsers) return;
    usersApi
      .list({ page_size: 100 })
      .then((res) => {
        setUsers(res.users || []);
        setHasFetchedUsers(true);
      })
      .catch(() => {});
  }, [hasFetchedUsers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await logsApi.list({
        user_id: userId ? Number(userId) : undefined,
        limit: LIMIT,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load, stamp]);

  const handleReset = () => {
    setActiveGroup('ALL');
    setUserId('');
    setSearch('');
    setStamp((s) => s + 1);
  };

  // Filter items by active group and text search
  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter((item) => {
      // Group filter
      if (activeGroup !== 'ALL') {
        const itemGroup = getEntryGroup(item);
        if (itemGroup !== activeGroup) return false;
      }

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const str = `${item.title} ${item.detail || ''} ${item.user_name || ''} ${item.unique_id || ''} ${item.record_name || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      return true;
    });
  }, [data, activeGroup, search]);

  // Compute Today's activity metrics per group
  const groupMetrics = useMemo(() => {
    const counts: Record<ActivityGroup, number> = {
      ALL: 0,
      FIELD_VERIFIER: 0,
      QA_AUDIT: 0,
      TELECALLING: 0,
      ADMIN_ASSIGNMENTS: 0,
      SYSTEM_AUTH: 0,
    };
    if (!data) return counts;

    const now = new Date();
    const todayKey = toDateKey(now.toISOString());

    for (const item of data.items) {
      const isToday = toDateKey(item.ts) === todayKey;
      if (isToday) {
        counts.ALL += 1;
        const g = getEntryGroup(item);
        counts[g] = (counts[g] || 0) + 1;
      }
    }
    return counts;
  }, [data]);

  // Group filtered feed into Day Buckets: Today, Yesterday, Earlier
  const dayGroups = useMemo(() => {
    const buckets: { key: string; label: string; items: ActivityEntry[] }[] = [];
    const bucketMap: Record<string, ActivityEntry[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };

    for (const item of filteredItems) {
      const h = dayHeading(item.ts);
      if (bucketMap[h.label]) {
        bucketMap[h.label].push(item);
      } else {
        bucketMap.Earlier.push(item);
      }
    }

    if (bucketMap.Today.length > 0) {
      buckets.push({ key: 'today', label: 'Today', items: bucketMap.Today });
    }
    if (bucketMap.Yesterday.length > 0) {
      buckets.push({ key: 'yesterday', label: 'Yesterday', items: bucketMap.Yesterday });
    }
    if (bucketMap.Earlier.length > 0) {
      buckets.push({ key: 'earlier', label: 'Earlier', items: bucketMap.Earlier });
    }

    return buckets;
  }, [filteredItems]);

  useTopHeader(
    {
      left: (
        <div className="topbar-page-left">
          <h1 className="topbar-page-title">Activities by Group</h1>
          <span className="count-pill">{filteredItems.length.toLocaleString()}</span>
        </div>
      ),
      right: (
        <div className="system-status-pill">
          <span className="pulse-dot" />
          <span className="status-label">Live Activity Feed</span>
        </div>
      ),
    },
    [filteredItems.length]
  );

  return (
    <PageShell>
      {/* Group Metric Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {GROUP_TABS.filter((t) => t.key !== 'ALL').map((tab) => {
          const isSelected = activeGroup === tab.key;
          const count = groupMetrics[tab.key] || 0;
          return (
            <div
              key={tab.key}
              onClick={() => setActiveGroup(isSelected ? 'ALL' : tab.key)}
              style={{
                background: isSelected ? tab.bg : '#ffffff',
                border: `1.5px solid ${isSelected ? tab.color : '#e2e8f0'}`,
                borderRadius: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: tab.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {tab.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>
                    {count}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>today</span>
                </div>
              </div>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: isSelected ? '#ffffff' : tab.bg,
                  color: tab.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={tab.icon} size={19} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter toolbar */}
      <div className="toolbar log-toolbar" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {/* Group Tabs */}
        <div className="log-toolbar-left" style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <div className="seg seg-ic" role="group" aria-label="Activity group">
            {GROUP_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`seg-btn ${activeGroup === tab.key ? 'active' : ''}`}
                onClick={() => setActiveGroup(tab.key)}
                style={
                  activeGroup === tab.key
                    ? { backgroundColor: tab.color, color: '#ffffff', borderColor: tab.color }
                    : {}
                }
              >
                <Icon name={tab.icon} size={15} />
                <span>{tab.label}</span>
                {activeGroup === 'ALL' && tab.key !== 'ALL' && groupMetrics[tab.key] > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: 'rgba(0,0,0,0.06)',
                      borderRadius: 10,
                      padding: '0 5px',
                      marginLeft: 3,
                    }}
                  >
                    {groupMetrics[tab.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search & User Filter */}
        <div className="log-toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Quick Search */}
          <div style={{ position: 'relative', width: 200 }}>
            <input
              type="text"
              className="fld fld-sm"
              placeholder="Search activities or CBE-ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 26 }}
            />
            <span style={{ position: 'absolute', left: 7, top: 7, color: '#94a3b8' }}>
              <Icon name="search" size={14} />
            </span>
          </div>

          <div className="filter-user-wrap">
            <CustomSelect
              value={userId}
              onChange={(val) => setUserId(val)}
              options={[
                { value: '', label: 'All Users' },
                ...users.map((u) => ({ value: String(u.id), label: `${u.full_name || u.email} (${u.role})` })),
              ]}
              ariaLabel="Filter by user"
            />
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setStamp((s) => s + 1)}
            title="Refresh feed"
          >
            <Icon name="refresh" size={15} />
            <span>Refresh</span>
          </button>

          {(activeGroup !== 'ALL' || userId || search) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset}>
              <Icon name="close" size={15} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingPanel text="Loading activities by group…" />}
      {!loading && filteredItems.length === 0 && (
        <EmptyPanel
          icon="receipt_long"
          text="No activity records match the selected group or filters. New field visits, audits, and assignments will appear here."
        />
      )}

      {!loading && filteredItems.length > 0 && (
        <div className="card log-card">
          <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="card-title-row">
              <Icon name="history" />
              <h2 className="h-card">
                {activeGroup === 'ALL' ? 'All Activities' : GROUP_TABS.find((t) => t.key === activeGroup)?.label}
              </h2>
            </div>
            <span className="count-pill">
              {filteredItems.length > LIMIT ? `${LIMIT}+` : filteredItems.length} entries
            </span>
          </div>

          <div className="log-list">
            {dayGroups.map((g) => (
              <div className="log-day" key={g.key}>
                <div className="log-day-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{g.label}</span>
                  <span className="log-day-count">{g.items.length}</span>
                </div>
                {g.items.map((item) => {
                  const itemGroup = getEntryGroup(item);
                  const groupCfg = getGroupIcon(itemGroup);
                  const isDeleted = item.title.toLowerCase().includes('delete');
                  const canNavigate = !!item.record_id && !isDeleted;

                  return (
                    <div
                      key={item.id}
                      className={`log-row ${canNavigate ? 'rowlink' : ''}`}
                      onClick={canNavigate ? () => navigate(`/records/${item.record_id}`) : undefined}
                      title={canNavigate ? `Open record #${item.record_id}` : undefined}
                      style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}
                    >
                      {/* Icon Badge */}
                      <span
                        className="log-ic"
                        style={{
                          background: groupCfg.bg,
                          color: groupCfg.color,
                          borderRadius: 8,
                          width: 34,
                          height: 34,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name={groupCfg.icon} size={18} />
                      </span>

                      {/* Main Details */}
                      <div className="log-main" style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="log-title-row"
                          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                        >
                          <span className="log-title" style={{ fontWeight: 650, fontSize: 13, color: '#0f172a' }}>
                            {item.title}
                          </span>

                          {/* Role Badge */}
                          {item.user_role && (
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: '#f1f5f9',
                                color: '#475569',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {item.user_role}
                            </span>
                          )}

                          {/* Action Type Badge */}
                          {item.action_type && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: groupCfg.bg,
                                color: groupCfg.color,
                                textTransform: 'uppercase',
                              }}
                            >
                              {item.action_type.replace(/_/g, ' ')}
                            </span>
                          )}

                          {/* Unique ID Badge (CBE-XXXXXX) */}
                          {item.unique_id && (
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #dbeafe',
                              }}
                            >
                              {item.unique_id}
                            </span>
                          )}

                          {item.type === 'security' && (
                            <span className="badge-chip badge-red">SECURITY ALERT</span>
                          )}
                          {isDeleted && <span className="badge-chip badge-red">DELETED</span>}
                        </div>

                        {item.detail && (
                          <div className="log-detail" style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                            {enName(item.detail)}
                          </div>
                        )}
                      </div>

                      {/* User & Time Side */}
                      <div className="log-side" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        {item.user_name ? (
                          <span className="cell-person log-person" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Avatar name={item.user_name} size="sm" />
                            <span className="pname" style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                              {item.user_name}
                            </span>
                          </span>
                        ) : null}

                        <div
                          className="log-time-box"
                          title={(parseUtcDate(item.ts) || new Date(item.ts)).toLocaleString()}
                          style={{ textAlign: 'right' }}
                        >
                          <span className="log-date mono-sm" style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                            {formatDate(item.ts)}
                          </span>
                          <span className="log-ts mono-sm" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#0f172a' }}>
                            {formatTime(item.ts)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="table-foot">
            <span className="table-foot-note">
              Grouped chronological activity · click any record row to open its full details
            </span>
          </div>
        </div>
      )}
    </PageShell>
  );
}
