import React, { useState } from 'react';
import type { User } from '../types';
import { api } from '../services/api';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';

interface ProfileModalProps {
  isOpen: boolean;
  user: User | null;
  onClose: () => void;
  onLogout: () => void;
  isForced?: boolean;
  onSuccess?: () => void;
}

export default function ProfileModal({
  isOpen,
  user,
  onClose,
  onLogout,
  isForced = false,
  onSuccess,
}: ProfileModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCurrentError(null);
    setNewError(null);
    setConfirmError(null);

    let hasError = false;

    if (!currentPassword) {
      setCurrentError('Please enter your current temporary password.');
      hasError = true;
    }

    if (newPassword.length < 8) {
      setNewError('New password must be at least 8 characters long.');
      hasError = true;
    } else if (newPassword === currentPassword) {
      setNewError('New password cannot be the same as current password.');
      hasError = true;
    }

    if (!confirmPassword) {
      setConfirmError('Please confirm your new password.');
      hasError = true;
    } else if (newPassword !== confirmPassword) {
      setConfirmError('New password and confirmation do not match.');
      hasError = true;
    }

    if (hasError) {
      return;
    }


    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Notify parent state immediately so must_change_password flags are cleared
      if (onSuccess) {
        onSuccess();
      }

      // Automatically close modal after brief delay so user sees confirmation
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error('Password change error:', err);
      setError(err.message || 'Failed to update password. Please check your current password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={isForced ? 'Set New Password' : 'User Account & Security'}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {isForced ? (
          <div
            style={{
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-md)',
              padding: '0.875rem 1rem',
              color: '#92400e',
              fontSize: '0.875rem',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            <Icon name="lock_reset" size={20} color="#b45309" />
            <span>
              For your account security, you must set a permanent password before continuing.
            </span>
          </div>
        ) : (
          /* Who is signed in. Identity only — the raw role enum and the
             "Field Operator"/"operator@system" fallbacks were noise. */
          <div
            style={{
              backgroundColor: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.875rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.875rem',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #FF6467 0%, #EA4E51 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.3rem',
                fontWeight: 600,
                WebkitTextStroke: '0.5px currentColor',
                lineHeight: 1,
                boxShadow: '0 4px 10px rgba(255, 100, 103, 0.3)',
                flexShrink: 0,
              }}
            >
              {(user?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
              <span className="hdr-presence" style={{ right: -1, bottom: -1 }} title="Online" />
            </div>
            <div style={{ minWidth: 0 }}>
              {user?.full_name && (
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.9375rem',
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.full_name}
                </div>
              )}
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.email || '—'}
              </div>
            </div>
          </div>
        )}

        {/* Change password form */}
        <div>
          <div className="modal-section-head">
            <h4 className="modal-section-title">
              <Icon name="lock_reset" size={18} color="var(--primary-hover)" />
              {isForced ? 'Create Your Password' : 'Change Password'}
            </h4>
            <p className="modal-section-sub">
              {isForced
                ? 'Choose a permanent password to replace the temporary one.'
                : 'Use at least 8 characters. You stay signed in after updating.'}
            </p>
          </div>

          {error && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-sm)',
                padding: '0.625rem 0.75rem',
                color: '#b91c1c',
                fontSize: '0.8125rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <Icon name="error" size={16} color="#b91c1c" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 'var(--radius-sm)',
                padding: '0.625rem 0.75rem',
                color: '#15803d',
                fontSize: '0.8125rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <Icon name="check_circle" size={16} color="#15803d" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="current-pw">
                {isForced ? 'Temporary Password' : 'Current Password'}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="current-pw"
                  type={showCurrent ? 'text' : 'password'}
                  className="form-input"
                  style={currentError ? { borderColor: '#ef4444' } : undefined}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (currentError) setCurrentError(null);
                  }}
                  placeholder="Enter current password"
                  aria-invalid={!!currentError}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  <Icon name={showCurrent ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
              {currentError && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{currentError}</span>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-pw">
                New Password (minimum 8 characters)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="new-pw"
                  type={showNew ? 'text' : 'password'}
                  className="form-input"
                  style={newError ? { borderColor: '#ef4444' } : undefined}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (newError) setNewError(null);
                  }}
                  placeholder="Enter new password"
                  aria-invalid={!!newError}
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  <Icon name={showNew ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
              {newError && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{newError}</span>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirm-pw">
                Confirm New Password
              </label>
              <input
                id="confirm-pw"
                type="password"
                className="form-input"
                style={confirmError ? { borderColor: '#ef4444' } : undefined}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (confirmError) setConfirmError(null);
                }}
                placeholder="Re-type new password"
                aria-invalid={!!confirmError}
              />
              {confirmError && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{confirmError}</span>
                </div>
              )}
            </div>


            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ marginTop: '0.25rem', width: '100%', justifyContent: 'center' }}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                  <span>Updating Password...</span>
                </>
              ) : (
                <>
                  <Icon name="vpn_key" size={18} />
                  <span>Update Password</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Sign out — the one destructive action, alone under the form so it is
            obvious and can't be hit by accident while editing a password. */}
        <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <button
            type="button"
            className="account-signout"
            onClick={onLogout}
            title="Sign out of this device"
          >
            <Icon name="logout" size={18} color="currentColor" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
