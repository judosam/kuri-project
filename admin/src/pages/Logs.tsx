import { useCallback, useEffect, useState } from 'react';
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

type TypeFilter = '' | 'record' | 'photo' | 'user' | 'auth' | 'security';

const TYPE_TABS: { value: TypeFilter; label: string; icon: IconName }[] = [
  { value: '', label: 'All activity', icon: 'receipt_long' },
  { value: 'record', label: 'Field records', icon: 'flag' },
  { value: 'photo', label: 'Photos', icon: 'photo_camera' },
  { value: 'user', label: 'User accounts', icon: 'person_add' },
  { value: 'auth', label: 'Sign-in / out', icon: 'login' },
  { value: 'security', label: 'Security alerts', icon: 'security' },
];

const TYPE_ICON: Record<ActivityEntry['type'], IconName> = {
  record: 'flag',
  photo: 'photo_camera',
  user: 'person_add',
  auth: 'login',
  security: 'security',
};

function getRowIcon(item: ActivityEntry): { icon: IconName; cls: string } {
  const t = item.title.toLowerCase();
  if (t.includes('delete')) {
    return { icon: 'delete', cls: 'log-delete' };
  }
  if (t.includes('update') || t.includes('edit')) {
    return { icon: 'tune', cls: 'log-edit' };
  }
  if (t.includes('download')) {
    return { icon: 'download', cls: 'log-photo' };
  }
  if (item.type === 'auth') {
    if (t.includes('out')) return { icon: 'logout', cls: 'log-auth' };
    return { icon: 'login', cls: 'log-auth' };
  }
  if (item.type === 'security' || t.includes('fail') || t.includes('wrong')) {
    return { icon: 'security', cls: 'log-security' };
  }
  return { icon: TYPE_ICON[item.type] || 'flag', cls: `log-${item.type}` };
}

const LIMIT = 300;

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
  const label = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return { key, label };
}

function formatTime(iso: string): string {
  const d = parseUtcDate(iso) || new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Logs() {
  const navigate = useNavigate();
  const [data, setData] = useState<ActivityLog | null>(null);
  const [type, setType] = useState<TypeFilter>('');
  const [userId, setUserId] = useState('');
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
        entry_type: type || undefined,
        user_id: userId ? Number(userId) : undefined,
        limit: LIMIT,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [type, userId]);

  useEffect(() => {
    load();
  }, [load, stamp]);

  const handleReset = () => {
    setType('');
    setUserId('');
    setStamp((s) => s + 1);
  };

  // Group feed into day buckets preserving order
  const groups: { key: string; label: string; items: ActivityEntry[] }[] = [];
  if (data) {
    for (const item of data.items) {
      const h = dayHeading(item.ts);
      const last = groups[groups.length - 1];
      if (last && last.key === h.key) {
        last.items.push(item);
      } else {
        groups.push({ key: h.key, label: h.label, items: [item] });
      }
    }
  }

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Activity Logs</h1>
        <span className="count-pill">{(data?.total ?? 0).toLocaleString()}</span>
      </div>
    ),
    right: (
      <div className="system-status-pill">
        <span className="pulse-dot" />
        <span className="status-label">Live Feed</span>
      </div>
    ),
  }, [data?.total]);

  return (
    <PageShell>
      {/* Filter toolbar */}
      <div className="toolbar log-toolbar">
        <div className="log-toolbar-left">
          <div className="seg seg-ic" role="group" aria-label="Activity type">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={`seg-btn ${type === tab.value ? 'active' : ''}`}
                onClick={() => setType(tab.value)}
              >
                <Icon name={tab.icon} size={15} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="log-toolbar-right">
          <div className="filter-user-wrap">
            <CustomSelect
              value={userId}
              onChange={(val) => setUserId(val)}
              options={[
                { value: '', label: 'All users' },
                ...users.map((u) => ({ value: String(u.id), label: u.full_name || u.email })),
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
          {(type || userId) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset}>
              <Icon name="close" size={15} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>



      {loading && <LoadingPanel text="Loading activity feed…" />}
      {!loading && data && data.items.length === 0 && (
        <EmptyPanel
          icon="receipt_long"
          text="No activity matches the selected filters yet. New captures and uploads will appear here."
        />
      )}

      {!loading && data && data.items.length > 0 && (
        <div className="card log-card">
          <div className="card-head">
            <div className="card-title-row">
              <Icon name="history" />
              <h2 className="h-card">System Activity</h2>
            </div>
            <span className="count-pill">
              {data.total > LIMIT ? `${LIMIT}+` : data.total}
            </span>
          </div>

          <div className="log-list">
            {groups.map((g) => (
              <div className="log-day" key={g.key}>
                <div className="log-day-head">
                  <span>{g.label}</span>
                  <span className="log-day-count">{g.items.length}</span>
                </div>
                {g.items.map((item) => {
                  const rowMeta = getRowIcon(item);
                  const isDeleted = item.title.toLowerCase().includes('delete');
                  const canNavigate = !!item.record_id && !isDeleted;
                  return (
                    <div
                      key={item.id}
                      className={`log-row ${canNavigate ? 'rowlink' : ''}`}
                      onClick={canNavigate ? () => navigate(`/records/${item.record_id}`) : undefined}
                      title={canNavigate ? 'Open record' : undefined}
                    >
                      <span className={`log-ic ${rowMeta.cls}`}>
                        <Icon name={rowMeta.icon} size={17} />
                      </span>
                      <div className="log-main">
                        <div className="log-title-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="log-title">{item.title}</span>
                          {item.type === 'security' && (
                            <span className="badge-chip badge-red">SECURITY ALERT</span>
                          )}
                          {item.type === 'auth' && (
                            <span className={`badge-chip ${item.title.toLowerCase().includes('out') ? 'badge-gray' : 'badge-green'}`}>
                              {item.title.toLowerCase().includes('out') ? 'SESSION END' : 'AUTHENTICATED'}
                            </span>
                          )}
                          {isDeleted && (
                            <span className="badge-chip badge-red">DELETED</span>
                          )}
                        </div>
                        {item.detail && <div className="log-detail">{enName(item.detail)}</div>}
                      </div>
                      <div className="log-side">
                        {item.user_name ? (
                          <span className="cell-person log-person">
                            <Avatar name={item.user_name} size="sm" />
                            <span className="pname">{item.user_name}</span>
                          </span>
                        ) : null}
                        <div
                          className="log-time-box"
                          title={(parseUtcDate(item.ts) || new Date(item.ts)).toLocaleString()}
                        >
                          <span className="log-date mono-sm">{formatDate(item.ts)}</span>
                          <span className="log-ts mono-sm">{formatTime(item.ts)}</span>
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
              Newest first · click a record or photo row to open its full record
            </span>
          </div>
        </div>
      )}
    </PageShell>
  );
}
