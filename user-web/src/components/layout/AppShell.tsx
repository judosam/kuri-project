import React from 'react';
import type { ScreenName, User } from '../../types';
import Icon from '../common/Icon';
import PwaInstallBanner from '../common/PwaInstallBanner';

interface AppShellProps {
  activeScreen: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  currentUser: User | null;
  onLogout: () => void;
  onOpenProfile: () => void;
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  /** Open the on-site manual capture flow (camera → form). */
  onAddRecord?: () => void;
  children: React.ReactNode;
}

export default function AppShell({
  activeScreen,
  onNavigate,
  currentUser,
  onLogout,
  onOpenProfile,
  title,
  subtitle,
  showBack = false,
  onBack,
  headerRight,
  onAddRecord,
  children,
}: AppShellProps) {
  const isDashboardActive = activeScreen === 'dashboard';
  const isRecordsActive = activeScreen === 'records' || activeScreen === 'detail';
  // Hidden while filling the inspection form: tapping Add mid-form discards
  // the captured photos, so the affordance only exists where nothing is in progress.
  const canAddRecord = !!onAddRecord && ['dashboard', 'records', 'detail'].includes(activeScreen);

  return (
    <div className="app-layout">
      {/* ─── Desktop Sidebar (min-width: 1024px) ─── */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div style={{ padding: '20px 18px', borderBottom: '1px solid var(--border-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: 'transparent',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'none',
              }}
            >
              <img
                src="/app/kuri-icon.png"
                alt="Kuri"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em', color: '#0f172a' }}>
                Kuri
              </div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, letterSpacing: '0.5px' }}>
                LEAD MANAGEMENT
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav style={{ padding: '16px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            className={`btn ${isDashboardActive ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onNavigate('dashboard')}
            style={{
              justifyContent: 'flex-start',
              padding: '12px 14px',
              borderRadius: 12,
              backgroundColor: isDashboardActive ? 'var(--primary)' : 'transparent',
              color: isDashboardActive ? '#ffffff' : '#475569',
            }}
          >
            <Icon name="dashboard" size={20} color={isDashboardActive ? '#ffffff' : '#64748b'} />
            <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>Dashboard</span>
          </button>

          <button
            type="button"
            className={`btn ${isRecordsActive ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onNavigate('records')}
            style={{
              justifyContent: 'flex-start',
              padding: '12px 14px',
              borderRadius: 12,
              backgroundColor: isRecordsActive ? '#FF6467' : 'transparent',
              color: isRecordsActive ? '#ffffff' : '#475569',
            }}
          >
            <Icon name="folder_open" size={20} color={isRecordsActive ? '#ffffff' : '#64748b'} />
            <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>Records</span>
          </button>

          {canAddRecord && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onAddRecord}
              style={{ justifyContent: 'flex-start', padding: '12px 14px', borderRadius: 12 }}
            >
              <Icon name="add_a_photo" size={20} color="#ffffff" />
              <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>Add Record</span>
            </button>
          )}
        </nav>

        {/* User Profile Card */}
        <div style={{ padding: '14px', borderTop: '1px solid var(--border-line)', backgroundColor: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  WebkitTextStroke: '0.5px currentColor',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(234, 88, 12, 0.3)',
                  flexShrink: 0,
                }}
              >
                {(currentUser?.full_name || currentUser?.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentUser?.full_name || 'Field Operator'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentUser?.email || ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
              title="Account Settings"
            >
              <Icon name="tune" size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="btn btn-secondary btn-sm"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 6 }}
          >
            <Icon name="logout" size={15} color="#dc2626" />
            <span style={{ color: '#dc2626' }}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ─── Main Viewport ─── */}
      <main className="app-viewport">
        {/* Modern Mobile / Web Header */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {showBack && onBack ? (
              <>
                <button
                  type="button"
                  onClick={onBack}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: 'var(--primary)',
                    border: '1px solid var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'var(--primary-contrast)',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                  title="Go Back"
                >
                  <Icon name="arrow_back" size={20} color="#ffffff" />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '1rem',
                      fontWeight: 800,
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      letterSpacing: '-0.3px',
                    }}
                  >
                    {title}
                  </div>
                  {subtitle && (
                    <div
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: '#64748b',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {subtitle}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <img
                src="/app/brand-logo.png"
                alt="Kuri"
                style={{ height: 26, width: 'auto', maxWidth: 140, objectFit: 'contain', flexShrink: 0 }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            )}
          </div>

          {/* Right Header Actions matching Stitch template */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {headerRight}

            {/* GPS Active Pill */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 9999,
                backgroundColor: '#eff6ff',
                color: '#006c4a',
                fontSize: '0.6875rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                border: '1px solid #cce5ff',
              }}
              title="GPS Active"
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#006c4a',
                  display: 'inline-block',
                }}
              />
              <span>GPS Active</span>
            </div>

            {/* Cloud Sync Status Icon */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: '#eff4ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#006398',
              }}
              title="Sync Status: Online"
            >
              <Icon name="cloud_done" size={17} color="#006398" />
            </div>

            {/* User Profile Avatar */}
            <button
              type="button"
              onClick={onOpenProfile}
              className="hdr-avatar-btn"
              title="User Account & Security"
              aria-label="Open user account and security settings"
            >
              {(currentUser?.full_name || currentUser?.email || 'U').charAt(0).toUpperCase()}
              <span className="hdr-presence" title="Online" />
            </button>
          </div>
        </header>

        {/* PWA Install & Offline Status Banner */}
        <PwaInstallBanner />

        {/* Scrollable Page Body */}
        <div className="app-body">
          {children}
        </div>

        {/* ─── Bottom Navigation Dock ─── */}
        <nav className="bottom-nav">
          {/* Tab 1: Dashboard */}
          <button
            type="button"
            className={`nav-item ${isDashboardActive ? 'active' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >
            <Icon
              name="dashboard"
              size={20}
              color={isDashboardActive ? '#FF6467' : '#64748b'}
            />
            <span style={{ color: isDashboardActive ? '#FF6467' : '#64748b', fontWeight: isDashboardActive ? 700 : 500 }}>Dashboard</span>
          </button>

          {/* Center Action: Capture Photo */}
          {canAddRecord && (
            <button
              type="button"
              className="nav-center-action"
              onClick={onAddRecord}
              aria-label="Add record: capture photo and inspect"
              title="Capture Photo"
            >
              <div className="nav-center-action-btn">
                <Icon name="photo_camera" size={22} color="#ffffff" />
              </div>
              <span className="nav-center-label">Capture</span>
            </button>
          )}

          {/* Tab 2: Records */}
          <button
            type="button"
            className={`nav-item ${isRecordsActive ? 'active' : ''}`}
            onClick={() => onNavigate('records')}
          >
            <Icon
              name="fact_check"
              size={20}
              color={isRecordsActive ? '#FF6467' : '#64748b'}
            />
            <span style={{ color: isRecordsActive ? '#FF6467' : '#64748b', fontWeight: isRecordsActive ? 700 : 500 }}>Records</span>
          </button>
        </nav>
      </main>
    </div>
  );
}
