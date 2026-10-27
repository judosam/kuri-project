import { useState, useEffect } from 'react';
import { PageShell, Icon } from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import { usersApi } from '../services/api';
import type { User } from '../types';

export default function FieldVerifierPortal() {
  const [copied, setCopied] = useState(false);
  const [verifiers, setVerifiers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Determine the Field Verifier app URL (routes to /app/ on current origin)
  const verifierAppUrl = `${window.location.origin}/app/`;

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Field Verifier Portal</h1>
        <span className="count-pill">Mobile PWA</span>
      </div>
    ),
  });

  useEffect(() => {
    usersApi
      .list({ page_size: 100 })
      .then((res) => {
        setVerifiers((res.users || []).filter((u) => u.role === 'FIELD_VERIFIER' || u.role === 'USER'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(verifierAppUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PageShell>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Main Launcher Banner */}
        <div
          className="card"
          style={{
            padding: 32,
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
            borderRadius: 16,
            border: '1px solid #334155',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 500px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(255, 100, 103, 0.2)',
                    border: '1px solid rgba(255, 100, 103, 0.4)',
                    color: '#ff8a8d',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <Icon name="photo_camera" size={14} /> Field Inspection Web App
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Live at /app/</span>
              </div>

              <h2 style={{ fontSize: '1.65rem', fontWeight: 700, margin: '0 0 10px 0', color: '#ffffff' }}>
                Field Verifier Inspection App
              </h2>
              <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 20px 0' }}>
                Dedicated Progressive Web App (PWA) designed for on-site field officers. Supports GPS coordinate locking, live camera capture with burned-in HUD watermark, site detail verification, and offline inspection queuing.
              </p>

              {/* URL & Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <a
                  href={verifierAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 20px',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    borderRadius: 10,
                    textDecoration: 'none',
                    backgroundColor: '#FF6467',
                    borderColor: '#FF6467',
                    color: '#ffffff',
                  }}
                >
                  <Icon name="open_in_new" size={17} />
                  Open Field Verifier App
                </a>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 18px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#ffffff',
                  }}
                >
                  <Icon name={copied ? 'check_circle' : 'content_copy'} size={16} />
                  {copied ? 'Link Copied!' : 'Copy Mobile App Link'}
                </button>
              </div>

              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Direct URL:</span>
                <code style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'rgba(0, 0, 0, 0.3)', color: '#38bdf8' }}>
                  {verifierAppUrl}
                </code>
              </div>
            </div>

            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: 16,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                textAlign: 'center',
                padding: 16,
              }}
            >
              <Icon name="photo_camera" size={44} style={{ color: '#FF6467' }} />
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>PWA Mobile App</span>
            </div>
          </div>
        </div>

        {/* 2-Column: Active Verifiers & Workflow Guide */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          {/* Active Verifiers */}
          <div className="card" style={{ padding: 24, borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="group" size={20} style={{ color: '#4f46e5' }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Active Field Verifiers</h3>
              </div>
              <span className="count-pill">{verifiers.length} Verifiers</span>
            </div>

            {loading ? (
              <p style={{ color: '#64748b', fontSize: 13 }}>Loading verifiers…</p>
            ) : verifiers.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: 13 }}>No users with FIELD_VERIFIER role yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {verifiers.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>
                        {v.full_name || v.email}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{v.email}</div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: '#e0e7ff',
                        color: '#4338ca',
                        fontWeight: 600,
                      }}
                    >
                      Field Verifier
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification Workflow Steps */}
          <div className="card" style={{ padding: 24, borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Icon name="assignment_turned_in" size={20} style={{ color: '#059669' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Field Verification Process</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: '#ecfdf5',
                    color: '#059669',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  1
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>Open Mobile App & Login</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Access /app/ using verifier credentials (e.g. Prabhu or Abilash).
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: '#ecfdf5',
                    color: '#059669',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  2
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>GPS Site Alignment</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Enable device location. The app computes distance variance from planned coordinates in real-time.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: '#ecfdf5',
                    color: '#059669',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  3
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>Capture Watermarked Photos</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Take front, site, and structural photos with automated timestamp and coordinate HUD overlay.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: '#ecfdf5',
                    color: '#059669',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  4
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>Submit Field Record</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Complete builder contact, construction status, and submit for Auditor QC assessment.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
