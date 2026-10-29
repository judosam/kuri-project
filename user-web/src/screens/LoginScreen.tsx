import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import Icon from '../components/common/Icon';
import { validateEmail, validatePassword } from '../utils/validators';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    // Load saved email if remembered
    const savedEmail = localStorage.getItem('photocapture_saved_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    setEmailError(emailErr);
    setPasswordError(passErr);

    if (emailErr || passErr) {
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    setLoading(true);
    try {
      await api.login(trimmedEmail, password);
      if (rememberMe) {
        localStorage.setItem('photocapture_saved_email', trimmedEmail);
      } else {
        localStorage.removeItem('photocapture_saved_email');
      }
      const me = await api.getMe();
      onLoginSuccess(me);
    } catch (err: any) {
      const msg = err?.message || 'Invalid email or password. Please check your credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ─── Pinned Coral Hero (Exact match to mobile LoginScreen) ─── */}
      <div
        style={{
          backgroundColor: '#FF6467',
          padding: '40px 20px 50px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Ambient background glow rings */}
        <div
          style={{
            position: 'absolute',
            top: -60,
            left: -60,
            width: 220,
            height: 220,
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -50,
            right: -50,
            width: 240,
            height: 240,
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            pointerEvents: 'none',
          }}
        />

        {/* Brand Logo Container */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
            marginBottom: 14,
            overflow: 'hidden',
            padding: 8,
          }}
        >
          <img
            src="/app/kuri-icon.png"
            alt="Kuri"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={(e) => {
              // Fallback to camera icon if image path fails
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>

        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: '-0.5px',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          Kuri
        </h1>
        <p
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            color: 'rgba(255, 255, 255, 0.9)',
            letterSpacing: '0.8px',
            margin: '4px 0 0 0',
            textTransform: 'uppercase',
          }}
        >
          Construction Lead Platform
        </p>
      </div>

      {/* ─── Overlapping Form Container ─── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 16px 40px 16px',
          marginTop: -24,
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: '#ffffff',
            borderRadius: 24,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
            border: '1px solid #f1f5f9',
            padding: '28px 24px',
          }}
        >
          {/* Welcome Row */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#272A31', margin: 0, letterSpacing: '-0.3px' }}>
              Welcome back
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#7B7E86', margin: '4px 0 0 0' }}>
              Sign in to continue to your field audit account.
            </p>
          </div>

          {/* Alert Error */}
          {error && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                backgroundColor: '#FFF7F7',
                border: '1px solid #FFD2D2',
                color: '#A13F40',
                fontSize: '0.8125rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: '#FFE5E5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="error" size={16} color="#dc2626" />
              </div>
              <div style={{ flex: 1, lineHeight: 1.4 }}>
                {error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Email Field */}
            <div className="field">
              <label className="form-label" htmlFor="user-email" style={{ fontSize: '0.78rem' }}>
                EMAIL ADDRESS
              </label>
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#F8F9FB',
                  borderRadius: 14,
                  border: emailError ? '1.5px solid #ef4444' : '1px solid #E5E7EC',
                  padding: '0 14px',
                  height: 54,
                  transition: 'border-color 0.2s',
                }}
              >
                <Icon name="mail" size={20} color={emailError ? '#ef4444' : '#94a3b8'} />
                <input
                  id="user-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={() => setEmailError(validateEmail(email))}
                  placeholder="operator@system.com"
                  autoComplete="email"
                  aria-invalid={!!emailError}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    height: '100%',
                    paddingLeft: 10,
                    fontSize: '0.9375rem',
                    color: '#2E3138',
                    fontWeight: 500,
                    outline: 'none',
                  }}
                />
              </div>
              {emailError && (
                <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={14} color="#ef4444" />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            {/* Password Field */}
            <div className="field">
              <label className="form-label" htmlFor="user-password" style={{ fontSize: '0.78rem' }}>
                PASSWORD
              </label>
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#F8F9FB',
                  borderRadius: 14,
                  border: passwordError ? '1.5px solid #ef4444' : '1px solid #E5E7EC',
                  padding: '0 14px',
                  height: 54,
                  transition: 'border-color 0.2s',
                }}
              >
                <Icon name="lock" size={20} color={passwordError ? '#ef4444' : '#94a3b8'} />
                <input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                  onBlur={() => setPasswordError(validatePassword(password))}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  aria-invalid={!!passwordError}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    height: '100%',
                    paddingLeft: 10,
                    fontSize: '0.9375rem',
                    color: '#2E3138',
                    fontWeight: 500,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 6,
                    display: 'flex',
                  }}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
                </button>
              </div>
              {passwordError && (
                <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={14} color="#ef4444" />
                  <span>{passwordError}</span>
                </div>
              )}
            </div>


            {/* Remember Me Option */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -2 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#64676F',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ accentColor: '#FF6467', width: 16, height: 16, borderRadius: 4 }}
                />
                <span>Remember Email</span>
              </label>
            </div>

            {/* Submit Button (Exact mobile button style) */}
            <button
              type="submit"
              disabled={loading}
              style={{
                height: 54,
                borderRadius: 14,
                backgroundColor: '#FF6467',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.95rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 16px rgba(255, 100, 103, 0.35)',
                transition: 'all 0.15s ease',
                marginTop: 6,
              }}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  <span>Signing In...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

          {/* Secure Encryption Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 24,
              color: '#8A8D94',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            <Icon name="lock" size={14} color="#94a3b8" />
            <span>Enterprise grade end-to-end encryption • TLS 1.3</span>
          </div>
        </div>
      </div>
    </div>
  );
}
