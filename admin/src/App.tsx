import { useState, useEffect, useContext } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from './services/api';
import type { User } from './types';
import { PORTAL_ROLES } from './types';
import { Icon, Avatar, type IconName } from './components/ui';
import { HeaderProvider, HeaderContext } from './context/HeaderContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Records from './pages/Records';
import QaDashboard from './pages/QaDashboard';
import ImportRecords from './pages/ImportRecords';
import ImportPreviousRecords from './pages/ImportPreviousRecords';
import ImportedRecordDetail from './pages/ImportedRecordDetail';
import RecordDetail from './pages/RecordDetail';
import MapPage from './pages/Map';
import Logs from './pages/Logs';
import FieldVerifierPortal from './pages/FieldVerifierPortal';
import TelecallerDashboard from './pages/TelecallerDashboard';
import TelecallerRecords from './pages/TelecallerRecords';
import { AdminMobileNav } from './components/AdminMobileNav';
import ErrorBoundary from './components/ErrorBoundary';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  match: string;
  roles: string[];
  badge?: string;
}

export const ROLE_PORTALS: NavItem[] = [
  { to: '/admin', label: 'Admin Console', icon: 'dashboard', match: '/admin', roles: ['ADMIN'], badge: 'Admin' },
  { to: '/verifier', label: 'Field Verifier App', icon: 'photo_camera', match: '/verifier', roles: ['ADMIN', 'MANAGER'], badge: '/app/' },
];

const NAV: NavItem[] = [
  // Telecaller portal
  { to: '/telecaller/dashboard', label: 'Dashboard', icon: 'dashboard', match: '/telecaller/dashboard', roles: ['TELECALLER'] },
  { to: '/telecaller/records', label: 'Calling Queue', icon: 'call', match: '/telecaller/records', roles: ['TELECALLER'] },
  // Auditor portal
  { to: '/auditor/dashboard', label: 'QC Dashboard', icon: 'dashboard', match: '/auditor/dashboard', roles: ['AUDITOR'] },
  { to: '/auditor/records', label: 'QA Queue', icon: 'fact_check', match: '/auditor/records', roles: ['AUDITOR'] },
  // Admin & Manager navigation
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', match: '/admin', roles: ['ADMIN'] },
  { to: '/admin/records', label: 'Records', icon: 'folder_open', match: '/admin/records', roles: ['ADMIN', 'MANAGER'] },
  { to: '/admin/users', label: 'Users', icon: 'group', match: '/admin/users', roles: ['ADMIN'] },
  { to: '/admin/map', label: 'Map', icon: 'pin_drop', match: '/admin/map', roles: ['ADMIN', 'MANAGER', 'AUDITOR'] },
  { to: '/admin/logs', label: 'Logs', icon: 'receipt_long', match: '/admin/logs', roles: ['ADMIN'] },
];

const STANDALONE_PAGE_ROUTES = [
  { match: '/records/import', label: 'Import Task Sheet' },
  { match: '/records/import-previous', label: 'Import Previous Records' },
];

// BrowserRouter must wrap everything so hooks like useNavigate work in Login too.
export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <HeaderProvider>
          <AppShell />
        </HeaderProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const location = useLocation();
  const isRecordDetail = location.pathname.startsWith('/records/') && location.pathname !== '/records';

  useEffect(() => {
    const path = location.pathname;
    let title = 'Kuri — Construction Lead Platform';
    if (path === '/admin' || path === '/admin/dashboard') title = 'Dashboard · Kuri';
    else if (path.startsWith('/records')) title = 'Records · Kuri';
    else if (path.startsWith('/auditor/dashboard') || path.startsWith('/audit/dashboard')) title = 'QC Dashboard · Kuri';
    else if (path.startsWith('/qa') || path.startsWith('/audit')) title = 'QA Portal · Kuri';
    else if (path.startsWith('/telecaller')) title = 'Telecaller · Kuri';
    else if (path.startsWith('/users')) title = 'Users · Kuri';
    else if (path === '/login') title = 'Sign in · Kuri';
    document.title = title;
  }, [location.pathname]);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    setAuthError(false);
    authApi
      .me()
      .then((u) => setUser(u))
      .catch(() => {
        if (localStorage.getItem('token')) setAuthError(true);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [authAttempt]);

  useEffect(() => {
    const handleAuthExpired = () => {
      localStorage.removeItem('token');
      setUser(null);
    };

    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, []);

  const handleLogin = () => {
    authApi.me().then(setUser).catch(() => {
      localStorage.removeItem('token');
      setUser(null);
    });
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem('token');
    setUser(null);
  };

  if (loading || authError) {
    return (
      <div className="fos-loading">
        <div className="brand-mark brand-mark-image-wrap">
          <img className="brand-mark-image loading-brand-logo" src="/kuri-icon.png" alt="Kuri" />
        </div>
        <p>{authError ? "Could not connect. Your login is saved." : "Connecting to PhotoCapture API…"}</p>
        {authError && <button className="btn btn-secondary" onClick={() => { setLoading(true); setAuthAttempt((n) => n + 1); }}>Retry connection</button>}
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (!PORTAL_ROLES.includes(user.role)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: 460, width: '100%', padding: 32, background: '#ffffff', borderRadius: 16, border: '1px solid var(--c-line, #e2e8f0)', boxShadow: 'var(--sh-lg)' }}>
          <div style={{ color: 'var(--c-red, #dc2626)', marginBottom: 16 }}>
            <Icon name="error" size={48} />
          </div>
          <h2 style={{ margin: '0 0 12px 0', fontSize: '1.5rem', fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>Access Denied</h2>
          <p style={{ color: 'var(--c-ink2, #434655)', marginBottom: 24, lineHeight: 1.5 }}>
            Portal privileges are required to access PhotoCapture Command Studio. Field operators can use the mobile camera app. Logged in as <strong style={{ color: 'var(--c-ink, #0f172a)' }}>{user.email}</strong> ({user.role}).
          </p>
          <button type="button" className="btn btn-primary" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fos-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${isRecordDetail ? 'fos-shell-fixed' : ''}`}>
      <Sidebar
        user={user}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onLogout={handleLogout}
        onUpdateUser={setUser}
      />
      <div className={`fos-main ${sidebarCollapsed ? 'collapsed' : ''} ${isRecordDetail ? 'fos-main-fixed' : ''}`}>
        <TopBar user={user} isCollapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        <main className={`fos-content ${isRecordDetail ? 'fos-content-fixed' : ''}`}>
          <Routes>
            {/* Direct portal landing route */}
            <Route
              path="/"
              element={
                user.role === 'ADMIN' ? (
                  <Navigate to="/admin" replace />
                ) : user.role === 'AUDITOR' ? (
                  <Navigate to="/auditor/dashboard" replace />
                ) : user.role === 'TELECALLER' ? (
                  <Navigate to="/telecaller/dashboard" replace />
                ) : (
                  <Navigate to="/verifier" replace />
                )
              }
            />

            {/* Admin Portal Routes */}
            <Route path="/admin" element={user.role === 'ADMIN' ? <Dashboard /> : <Navigate to={user.role === 'AUDITOR' ? '/auditor/dashboard' : user.role === 'TELECALLER' ? '/telecaller/dashboard' : '/verifier'} replace />} />
            <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
            <Route path="/admin/records" element={user.role === 'ADMIN' ? <Records key={`admin-${user.id}`} storageKey={`pc_admin_records_${user.id}`} canAdmin={true} canAudit={true} canRoute={true} currentUser={user} /> : <Navigate to="/" replace />} />
            <Route path="/admin/users" element={user.role === 'ADMIN' ? <Users /> : <Navigate to="/" replace />} />
            <Route path="/admin/map" element={user.role === 'ADMIN' ? <MapPage /> : <Navigate to="/" replace />} />
            <Route path="/admin/logs" element={user.role === 'ADMIN' ? <Logs /> : <Navigate to="/" replace />} />

            {/* Auditor Portal Routes */}
            <Route path="/auditor" element={<Navigate to="/auditor/dashboard" replace />} />
            <Route path="/auditor/dashboard" element={user.role === 'AUDITOR' || user.role === 'ADMIN' ? <QaDashboard /> : <Navigate to="/" replace />} />
            <Route path="/auditor/records" element={user.role === 'AUDITOR' || user.role === 'ADMIN' ? <Records key={`qa-${user.id}`} storageKey={`pc_qa_records_${user.id}`} canAdmin={false} auditOnly={true} canAudit={true} canRoute={false} pageTitle="QA Records" roleBadge="QA" currentUser={user} /> : <Navigate to="/" replace />} />
            <Route path="/audit/dashboard" element={<Navigate to="/auditor/dashboard" replace />} />
            <Route path="/audit" element={<Navigate to="/auditor/records" replace />} />

            {/* Telecaller Portal Routes */}
            <Route path="/telecaller" element={<Navigate to="/telecaller/dashboard" replace />} />
            <Route path="/telecaller/dashboard" element={user.role === 'TELECALLER' || user.role === 'ADMIN' ? <TelecallerDashboard /> : <Navigate to="/" replace />} />
            <Route path="/telecaller/records" element={user.role === 'TELECALLER' || user.role === 'ADMIN' ? <TelecallerRecords /> : <Navigate to="/" replace />} />

            {/* Field Verifier Portal Routes */}
            <Route path="/app" element={<FieldVerifierPortal />} />
            <Route path="/app/*" element={<FieldVerifierPortal />} />
            <Route path="/verifier" element={<FieldVerifierPortal />} />
            <Route path="/field-verifier" element={<Navigate to="/verifier" replace />} />

            {/* Legacy & Shared Routes */}
            <Route path="/users" element={<Navigate to="/admin/users" replace />} />
            <Route path="/settings" element={<Navigate to="/admin/users" replace />} />
            <Route path="/settings/users" element={user.role === 'ADMIN' ? <Users /> : <Navigate to="/" replace />} />
            <Route path="/records" element={user.role === 'ADMIN' ? <Navigate to="/admin/records" replace /> : user.role === 'AUDITOR' ? <Navigate to="/auditor/records" replace /> : user.role === 'TELECALLER' ? <Navigate to="/telecaller/records" replace /> : <Navigate to="/verifier" replace />} />
            <Route path="/records/import" element={user.role === 'ADMIN' ? <ImportRecords canImportHistory={user.role === 'ADMIN'} /> : <Navigate to="/" replace />} />
            <Route path="/records/import-previous" element={user.role === 'ADMIN' ? <ImportPreviousRecords /> : <Navigate to="/" replace />} />
            <Route path="/records/imported/:id" element={user.role === 'ADMIN' ? <ImportedRecordDetail /> : user.role === 'AUDITOR' ? <RecordDetail canAdmin={false} canAudit={true} /> : <RecordDetail canAdmin={false} canAudit={false} />} />
            <Route path="/records/:id" element={user.role === 'AUDITOR' ? <RecordDetail canAdmin={false} canAudit={true} /> : user.role === 'TELECALLER' ? <Navigate to="/telecaller/records" replace /> : <RecordDetail canAdmin={user.role === 'ADMIN'} canAudit={user.role === 'ADMIN'} />} />
            <Route path="/map" element={user.role === 'TELECALLER' ? <Navigate to="/telecaller/records" replace /> : <MapPage />} />
            <Route path="/logs" element={user.role === 'ADMIN' ? <Logs /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <AdminMobileNav role={user.role} />
    </div>
  );
}

function TopBar({ user }: { user: User; isCollapsed?: boolean; onToggleCollapse?: () => void }) {
  const { header } = useContext(HeaderContext);
  const location = useLocation();
  const navigate = useNavigate();
  const allNav = [...ROLE_PORTALS, ...NAV, ...STANDALONE_PAGE_ROUTES];
  const currentNav = allNav.filter((n) =>
    n.match === '/' ? location.pathname === '/' : (n.match && (location.pathname === n.match || location.pathname.startsWith(`${n.match}/`)))
  ).sort((a, b) => (b.match?.length || 0) - (a.match?.length || 0))[0];
  const pageLabel = currentNav ? currentNav.label : location.pathname.includes('/records/') ? 'Record Detail' : 'Console';
  const isImportActive = location.pathname === '/records/import';

  return (
    <header className="fos-topbar">
      <div className="topbar-left">
        {header.left || (
          <div className="topbar-page-left">
            <h1 className="topbar-page-title">{pageLabel}</h1>
          </div>
        )}
      </div>
      <div className="topbar-right">
        {user.role === 'ADMIN' && (
          <button
            type="button"
            className={`btn btn-sm ${isImportActive ? 'btn-secondary is-active' : 'btn-primary'}`}
            onClick={() => navigate('/records/import')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              fontSize: 11,
              height: 28,
              borderRadius: 6,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: isImportActive ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
            }}
            title="Import Task Sheet from Excel"
          >
            <Icon name="cloud_upload" size={14} />
            <span className="btn-label">Import Task Sheet</span>
          </button>
        )}
        {header.right || (
          <div className="system-status-pill">
            <span className="pulse-dot" />
            <span className="status-label">API Connected</span>
          </div>
        )}
      </div>
    </header>
  );
}

function Sidebar({
  user,
  isCollapsed = false,
  onToggleCollapse,
  onLogout,
  onUpdateUser,
}: {
  user: User;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onLogout: () => void;
  onUpdateUser?: (u: User) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleOpenSettings = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setShowSettings(true);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (!newPassword) {
      setError('Please enter a new password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await authApi.updateProfile({
        current_password: currentPassword,
        new_password: newPassword,
      });

      if (res.access_token) {
        localStorage.setItem('token', res.access_token);
      }
      if (onUpdateUser) {
        onUpdateUser(res.user);
      }
      setSuccess('Password changed successfully!');
      setTimeout(() => {
        setShowSettings(false);
      }, 1200);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className={`fos-side ${isCollapsed ? 'collapsed' : ''}`} data-role={user.role}>
      <div>
        <div className="fos-side-brand">
          <div className="brand-id">
            {!isCollapsed ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <img src="/kuri-icon.png" alt="Kuri" style={{ height: 32, width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }} />
                <span className="brand-sub" style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Lead Management</span>
              </div>
            ) : (
              <span className="brand-mark brand-mark-image-wrap" title="Kuri — Lead Management">
                <img className="brand-mark-image" src="/kuri-icon.png" alt="Kuri" style={{ objectFit: 'contain' }} />
              </span>
            )}
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#64748b',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <Icon name={isCollapsed ? "chevron_right" : "chevron_left"} size={16} />
          </button>
        </div>
        {/* Role label — below app subheading, above main navigation */}
        <div className="side-role-bar">
          <span className="side-role">{user.role.replace(/_/g, ' ')}</span>
        </div>

        <nav className="fos-nav">
          <div className="fos-nav-label">Main Navigation</div>
          {NAV.filter(item => item.roles.includes(user.role)).map((item) => {
            // Longest-prefix-wins: /records/import must light up ONLY
            // "Import Task Sheet", not also "Records" (NavLink's own
            // isActive prefix-matches /records and double-highlights).
            const urlMatches = (to: string) =>
              to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`);
            const matches = urlMatches(item.to);
            const longerMatchWins = NAV.some(
              (other) =>
                other.to !== item.to &&
                other.to.length > item.to.length &&
                other.roles.includes(user.role) &&
                urlMatches(other.to),
            );
            const active = matches && !longerMatchWins;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={() => (active ? 'fos-navlink active' : 'fos-navlink')}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="fos-side-foot">
        <div
          className="fos-user-card"
          onClick={handleOpenSettings}
          style={{ cursor: 'pointer' }}
          title="Account settings & change password"
        >
          <div className="fos-user-row">
            <div className="user-avatar-wrap">
              <Avatar name={user.full_name || user.email} size="md" brand />
              <span className="user-online-dot" title="Online" />
            </div>
            <div className="fos-user-meta">
              <div className="fos-user-name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{user.full_name || 'Admin'}</span>
                <Icon name="tune" size={13} style={{ opacity: 0.6 }} />
              </div>
              <div className="fos-user-sub">{user.email || user.role}</div>
            </div>
            <button
              type="button"
              className="fos-logout-icon-btn fos-logout"
              onClick={(e) => {
                e.stopPropagation();
                onLogout();
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </div>

      {showSettings &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
            onClick={() => setShowSettings(false)}
          >
          <div
            style={{
              maxWidth: 480,
              width: '100%',
              padding: 26,
              borderRadius: 16,
              background: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.05)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: 'rgba(255, 100, 103, 0.1)',
                    border: '1px solid rgba(255, 100, 103, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--c-blue, #FF6467)',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="badge" size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
                    Account Settings
                  </h3>
                  <span style={{ fontSize: '12px', color: 'var(--c-ink3, #6b7082)' }}>
                    Change your password
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: 30, height: 30, padding: 0, borderRadius: 8 }}
                onClick={() => setShowSettings(false)}
                aria-label="Close dialog"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveSettings}>
              {error && (
                <div className="alert alert-error" style={{ marginBottom: 14 }}>
                  <Icon name="error" size={16} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="alert alert-success" style={{ marginBottom: 14, background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
                  <Icon name="check_circle" size={16} />
                  <span>{success}</span>
                </div>
              )}

              <div className="field" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="field-label" htmlFor="admin-name">Full Name</label>
                  <span style={{ fontSize: '11px', color: 'var(--c-ink3, #64748b)', fontWeight: 500 }}>Read-only</span>
                </div>
                <input
                  id="admin-name"
                  className="fld"
                  value={user.full_name || 'System Admin'}
                  readOnly
                  disabled
                  tabIndex={-1}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#475569',
                    cursor: 'not-allowed',
                    borderColor: '#e2e8f0',
                  }}
                />
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="field-label" htmlFor="admin-email">Email Address</label>
                  <span style={{ fontSize: '11px', color: 'var(--c-ink3, #64748b)', fontWeight: 500 }}>Read-only</span>
                </div>
                <input
                  id="admin-email"
                  type="email"
                  className="fld"
                  value={user.email || 'admin@system.local'}
                  readOnly
                  disabled
                  tabIndex={-1}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#475569',
                    cursor: 'not-allowed',
                    borderColor: '#e2e8f0',
                  }}
                />
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-label" htmlFor="admin-curr-pass">
                  Current Password <span style={{ color: 'var(--c-red, #dc2626)' }}>*</span>
                </label>
                <input
                  id="admin-curr-pass"
                  type="password"
                  className="fld"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div className="field">
                  <label className="field-label" htmlFor="admin-new-pass">
                    New Password <span style={{ color: 'var(--c-red, #dc2626)' }}>*</span>
                  </label>
                  <input
                    id="admin-new-pass"
                    type="password"
                    className="fld"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="admin-conf-pass">
                    Confirm Password <span style={{ color: 'var(--c-red, #dc2626)' }}>*</span>
                  </label>
                  <input
                    id="admin-conf-pass"
                    type="password"
                    className="fld"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowSettings(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Icon name="refresh" size={16} className="fos-spin" />
                      Saving…
                    </>
                  ) : (
                    'Change Password'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
}
