import { useState, type FormEvent } from 'react';
import { authApi } from '../services/api';
import { PORTAL_ROLES } from '../types';
import { Icon } from '../components/ui';
import { validateEmail, validatePassword } from '../utils/validators';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState(() => localStorage.getItem('remember_email') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem('remember_email'));
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const mailErr = validateEmail(email);
    const passErr = validatePassword(password);
    setEmailError(mailErr);
    setPasswordError(passErr);

    if (mailErr || passErr) {
      return;
    }

    setLoading(true);

    try {
      const res = await authApi.login({ email: email.trim().toLowerCase(), password });
      localStorage.setItem('token', res.access_token);
      const me = await authApi.me();
      // Portal gate — must match App.tsx (PORTAL_ROLES). Field workers
      // (USER / FIELD_VERIFIER) use the mobile app at /app instead.
      if (!PORTAL_ROLES.includes(me.role)) {
        localStorage.removeItem('token');
        setError('Access Denied: This account uses the mobile field app. The Admin Web Portal is for Admin, Manager, Record Assigner, and Auditor roles.');
        return;
      }
      if (rememberMe) {
        localStorage.setItem('remember_email', email.trim().toLowerCase());
      } else {
        localStorage.removeItem('remember_email');
      }
      onLogin();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setError('Invalid email or password');
      } else if (!err?.response) {
        setError('Cannot reach the server. Make sure the backend is running on port 8000.');
      } else {
        setError(err?.response?.data?.detail || 'Unable to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };


  return (
    <main className="auth-page auth-page-admin">
      <div className="auth-decor auth-decor-one" aria-hidden="true" />
      <div className="auth-decor auth-decor-two" aria-hidden="true" />

      <section className="auth-shell">
        {/* Top Right Corner Badge */}
        <div className="auth-corner-badge">
          <span className="auth-corner-dot" />
          Field Audit Portal
        </div>

        <div className="auth-panel">
          {/* Brand Header */}
          <div className="auth-logo-row">
            <img className="auth-logo" src="/kuri-logo.png" alt="Kuri" style={{ height: 44, width: 'auto', background: 'transparent', padding: 0 }} />
            <div className="auth-brand-identity">
              <span className="auth-brand-title">Kuri</span>
              <span className="auth-brand-sub">Construction Lead Platform</span>
            </div>
          </div>

          {/* Heading */}
          <div className="auth-heading">
            <h1>Welcome back</h1>
            <p>Sign in to manage field geotags, audits, and records.</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="auth-alert" role="alert">
              <span className="auth-alert-icon"><Icon name="error" size={17} /></span>
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field" htmlFor="login-email">
              <span className="auth-label">Email</span>
              <span className="auth-input-wrap" style={emailError ? { borderColor: '#ef4444' } : undefined}>
                <Icon name="badge" size={18} />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={() => setEmailError(validateEmail(email))}
                  placeholder="Enter your email"
                  autoComplete="email"
                  aria-invalid={!!emailError}
                  autoFocus
                  disabled={loading}
                />
              </span>
              {emailError && (
                <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} style={{ color: '#ef4444' }} />
                  <span>{emailError}</span>
                </span>
              )}
            </label>

            <label className="auth-field" htmlFor="login-password">
              <span className="auth-label">Password</span>
              <span className="auth-input-wrap" style={passwordError ? { borderColor: '#ef4444' } : undefined}>
                <Icon name="lock" size={18} />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                    if (passwordError) setPasswordError(null);
                  }}
                  onBlur={() => setPasswordError(validatePassword(password))}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  aria-invalid={!!passwordError}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="auth-icon-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </span>
              {passwordError && (
                <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} style={{ color: '#ef4444' }} />
                  <span>{passwordError}</span>
                </span>
              )}
            </label>



            <label className="auth-check">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
              />
              <span>Remember Me</span>
            </label>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <><Icon name="refresh" size={17} className="fos-spin" /> Signing in…</>
              ) : (
                <><Icon name="login" size={18} /> Sign In</>
              )}
            </button>
          </form>

          <div className="auth-secure">
            <Icon name="verified" size={16} />
            <span>Protected &amp; Secure</span>
          </div>

          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid #e2e8f0',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
              Role Portals &amp; Links
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>Admin Console</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>Route: <code>/admin</code></div>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, color: '#7c3aed' }}>Auditor Desk (QC)</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>Route: <code>/audit</code></div>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: '#1d4ed8' }}>Field Verifier App</span>
                  <Icon name="open_in_new" size={12} style={{ color: '#1d4ed8' }} />
                </div>
                <a
                  href="/app/"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#2563eb', fontSize: 11, textDecoration: 'none' }}
                >
                  Open /app/ (Mobile PWA)
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
