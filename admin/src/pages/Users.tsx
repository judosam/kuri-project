import { useEffect, useState, useRef } from 'react';
import { authApi, usersApi } from '../services/api';
import type { User } from '../types';
import {
  Icon,
  Avatar,
  EmptyPanel,
  LoadingPanel,
  Pager,
  PageShell,
  formatDate,
  CustomSelect,
} from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import { validateEmail, validatePassword, validateText } from '../utils/validators';

const PAGE_SIZE = 15;

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', full_name: '', role: 'USER' });
  const [createErrors, setCreateErrors] = useState<{ full_name?: string; email?: string }>({});
  const [createdAccountResult, setCreatedAccountResult] = useState<{ user: User; temporary_password?: string } | null>(null);
  const [copiedNewAccountPassword, setCopiedNewAccountPassword] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleteUser) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteUser]);

  const handleDelete = async () => {
    if (!deleteUser || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await usersApi.delete(deleteUser.id);
      setDeleteUser(null);
      if (users.length === 1 && page > 1) setPage(page - 1);
      else await loadUsers();
    } catch (e: any) {
      setDeleteError(e.response?.data?.detail || 'Could not delete this user. Please try again.');
    } finally { setDeleting(false); }
  };

  // Reset password state
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetCustomPassword, setResetCustomPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetRequireChange, setResetRequireChange] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Edit role state
  const [editRoleUser, setEditRoleUser] = useState<User | null>(null);
  const [selectedNewRole, setSelectedNewRole] = useState<string>('USER');
  const [updatingRole, setUpdatingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const handleOpenRoleEdit = (u: User) => {
    setEditRoleUser(u);
    setSelectedNewRole(u.role);
    setRoleError(null);
  };

  const handleSaveRole = async () => {
    if (!editRoleUser) return;
    setUpdatingRole(true);
    setRoleError(null);
    try {
      await usersApi.update(editRoleUser.id, { role: selectedNewRole as any });
      setEditRoleUser(null);
      await loadUsers();
    } catch (err: any) {
      setRoleError(err.response?.data?.detail || 'Failed to update user role');
    } finally {
      setUpdatingRole(false);
    }
  };

  useEffect(() => {
    authApi.me().then(setCurrentUser).catch(() => {});
  }, []);

  const handleOpenReset = (u: User) => {
    setResetUser(u);
    setResetError(null);
    setResetSuccess(null);
    setResetCustomPassword('');
    setShowResetPassword(false);
    setResetRequireChange(false);
    setCopiedPassword(false);
  };

  const handleExecuteResetPassword = async () => {
    if (!resetUser) return;
    setResetError(null);

    if (resetCustomPassword.trim()) {
      const pwErr = validatePassword(resetCustomPassword.trim(), 8);
      if (pwErr) {
        setResetError(pwErr);
        return;
      }
    }

    setResetLoading(true);
    try {
      const res = await usersApi.resetPassword(
        resetUser.id,
        resetCustomPassword.trim() || undefined,
        resetRequireChange
      );
      setResetSuccess(res.temporary_password);
      loadUsers();
    } catch (err: any) {
      setResetError(err.response?.data?.detail || 'Failed to reset password.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopyPassword = () => {
    if (!resetSuccess) return;
    navigator.clipboard.writeText(resetSuccess);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2500);
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await usersApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        is_active: statusFilter === 'all' ? undefined : statusFilter === 'active',
      });
      setUsers(res.users || []);
      setTotal(res.total);
    } catch (e: any) {
      setActionError(e.response?.data?.detail || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    loadUsers();
  }, [page, search, statusFilter]);

  const handleCreate = async () => {
    setError('');
    const nameErr = validateText(newUser.full_name, 'Full name', 2, 100);
    const emailErr = validateEmail(newUser.email);
    if (nameErr || emailErr) {
      setCreateErrors({ full_name: nameErr || undefined, email: emailErr || undefined });
      return;
    }
    setCreateErrors({});
    setCreating(true);
    try {
      const res = await usersApi.create({
        ...newUser,
        email: newUser.email.trim().toLowerCase(),
        full_name: newUser.full_name.trim(),
      });
      setShowCreate(false);
      setNewUser({ email: '', full_name: '', role: 'USER' });
      if (res.temporary_password) {
        setCreatedAccountResult({ user: res, temporary_password: res.temporary_password });
      }
      loadUsers();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };


  const handleToggleActive = (user: User) => {
    setActionError(null);
    if (user.role === 'ADMIN' && user.is_active) {
      setActionError('Administrator accounts cannot be deactivated to prevent system lockout.');
      return;
    }
    if (user.is_active) {
      setConfirmUser(user);
      return;
    }
    executeToggleActive(user);
  };

  const executeToggleActive = async (user: User) => {
    try {
      if (user.is_active) {
        await usersApi.deactivate(user.id);
      } else {
        await usersApi.activate(user.id);
      }
      setConfirmUser(null);
      loadUsers();
    } catch (e: any) {
      setActionError(e.response?.data?.detail || 'Failed to update user status');
    }
  };

  const handleReset = () => {
    setSearch('');
    setSearchInput('');
    setStatusFilter('all');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = !!search || !!searchInput || statusFilter !== 'all';

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Settings <span className="settings-breadcrumb">/ Users</span></h1>
        <span className="count-pill">{total.toLocaleString()}</span>
      </div>
    ),
    right: (
      <button
        type="button"
        className={showCreate ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
        onClick={() => setShowCreate(!showCreate)}
      >
        <Icon name={showCreate ? 'close' : 'person_add'} size={15} />
        {showCreate ? 'Cancel' : '+ Create Account'}
      </button>
    ),
  }, [total, showCreate]);

  return (
    <PageShell>
      <dialog ref={deleteDialog} className="user-delete-dialog" aria-labelledby="delete-user-title"
        onCancel={(event) => { if (deleting) event.preventDefault(); else setDeleteUser(null); }}>
        <h2 id="delete-user-title">Delete user?</h2>
        <p>Permanently remove <strong>{deleteUser?.full_name}</strong> ({deleteUser?.email}) and end their sign-in sessions.</p>
        <p className="delete-user-note">Accounts with inspection records cannot be deleted. You can deactivate them to retain their history.</p>
        {deleteError && <p className="delete-user-error" role="alert">{deleteError}</p>}
        <div className="delete-user-actions">
          <button autoFocus type="button" className="btn btn-ghost" disabled={deleting} onClick={() => setDeleteUser(null)}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? 'Deleting…' : 'Delete user'}</button>
        </div>
      </dialog>

      {showCreate && (
        <div className="create-panel">
          <div className="create-panel-head">
            <Icon name="person_add" />
            <span className="h-card">Create Account</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="nu-name">
              Full Name
            </label>
            <input
              id="nu-name"
              className="fld"
              style={createErrors.full_name ? { borderColor: '#ef4444' } : undefined}
              placeholder="Full Name"
              value={newUser.full_name}
              onChange={(e) => {
                setNewUser({ ...newUser, full_name: e.target.value });
                if (createErrors.full_name) setCreateErrors((prev) => ({ ...prev, full_name: undefined }));
              }}
              aria-invalid={!!createErrors.full_name}
            />
            {createErrors.full_name && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                <Icon name="error" size={13} style={{ color: '#ef4444' }} />
                <span>{createErrors.full_name}</span>
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="nu-email">
              Email
            </label>
            <input
              id="nu-email"
              className="fld"
              style={createErrors.email ? { borderColor: '#ef4444' } : undefined}
              placeholder="Email"
              type="email"
              value={newUser.email}
              onChange={(e) => {
                setNewUser({ ...newUser, email: e.target.value });
                if (createErrors.email) setCreateErrors((prev) => ({ ...prev, email: undefined }));
              }}
              aria-invalid={!!createErrors.email}
            />
            {createErrors.email && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                <Icon name="error" size={13} style={{ color: '#ef4444' }} />
                <span>{createErrors.email}</span>
              </span>
            )}
          </div>


          <div className="field">
            <label className="field-label" htmlFor="nu-role">
              Role
            </label>
            <CustomSelect
              value={newUser.role}
              onChange={(val) => setNewUser({ ...newUser, role: val })}
              options={[
                { value: 'TELECALLER', label: 'Telecaller — verify contacts & phone confirmations' },
                { value: 'AUDITOR', label: 'Auditor — review routed records and set audit status' },
                { value: 'FIELD_VERIFIER', label: 'Field Verifier — completes inspections from the mobile app' },
                { value: 'ADMIN', label: 'Admin — full command studio access' },
                { value: 'MANAGER', label: 'Manager — view and assign records' },
                { value: 'USER', label: 'User — legacy field operator' },
              ]}
              ariaLabel="Select user role"
            />
          </div>
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 12.5,
              color: '#475569',
            }}
          >
            <Icon name="security" size={16} style={{ color: '#059669', flexShrink: 0 }} />
            <span>
              A secure 16-character temporary password will be auto-generated. The user will be required to choose a new password upon first sign-in.
            </span>
          </div>
          <div className="create-actions" style={{ flexDirection: 'column', gap: 8, gridColumn: '1 / -1' }}>
            {error && (
              <div className="alert alert-error" role="alert">
                <Icon name="error" size={16} />
                <span>{error}</span>
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={creating}
              style={{ maxWidth: 220 }}
            >
              {creating ? (
                <>
                  <Icon name="refresh" size={16} className="fos-spin" />
                  Creating…
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </div>
        </div>
      )}


      {actionError && (
        <div className="alert alert-error" style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }} role="alert">
          <Icon name="error" size={16} />
          <span style={{ flex: 1 }}>{actionError}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setActionError(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="toolbar users-toolbar">
        <div className="search-wrap">
          <Icon name="search" />
          <input
            type="text"
            className="fld fld-soft"
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search users"
          />
        </div>
        <div className="field" style={{ width: 160 }}>
          <CustomSelect
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val as 'all' | 'active' | 'inactive');
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active only' },
              { value: 'inactive', label: 'Inactive only' },
            ]}
            ariaLabel="Filter by status"
          />
        </div>
        {isFiltered && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
          >
            <Icon name="close" />
            Reset
          </button>
        )}
      </div>

      {loading && <LoadingPanel text="Loading users…" />}
      {!loading && users.length === 0 && <EmptyPanel icon="group" text="No users found." />}

      {!loading && users.length > 0 && (
        <div className="card table-card">
          <div className="card-head">
            <div className="card-title-row">
              <Icon name="group" />
              <h2 className="h-card">User Accounts</h2>
            </div>
            <span className="count-pill">{total.toLocaleString()}</span>
          </div>
          <div className="table-scroll">
            <table className="fos-table users-table">
              <colgroup>
                <col style={{ width: 60 }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 210 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>No.</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th style={{ width: 120 }}>Role</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 130 }}>Joined</th>
                  <th style={{ width: 210 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, idx) => (
                  <tr key={u.id}>
                    <td style={{ width: 60 }}>
                      <span className="row-id">{(page - 1) * PAGE_SIZE + idx + 1}</span>
                    </td>
                    <td>
                      <div className="cell-person">
                        <Avatar name={u.full_name || u.email} size="sm" />
                        <span className="pname">{u.full_name || '—'}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>
                        {u.email}
                      </span>
                    </td>
                    <td>
                      {u.role === 'ADMIN' ? (
                        <span className="role-stamp role-stamp-admin" onClick={() => handleOpenRoleEdit(u)} style={{ cursor: 'pointer' }} title="Click to change role">
                          <Icon name="verified" size={13} />
                          ADMIN
                        </span>
                      ) : u.role === 'AUDITOR' ? (
                        <span className="role-stamp role-stamp-auditor" onClick={() => handleOpenRoleEdit(u)} style={{ cursor: 'pointer' }} title="Click to change role">
                          <Icon name="fact_check" size={13} />
                          Auditor
                        </span>
                      ) : u.role === 'TELECALLER' ? (
                        <span className="role-stamp role-stamp-telecaller" onClick={() => handleOpenRoleEdit(u)} style={{ cursor: 'pointer' }} title="Click to change role">
                          <Icon name="call" size={13} />
                          Telecaller
                        </span>
                      ) : u.role === 'FIELD_VERIFIER' ? (
                        <span className="role-stamp role-stamp-verifier" onClick={() => handleOpenRoleEdit(u)} style={{ cursor: 'pointer' }} title="Click to change role">
                          <Icon name="how_to_reg" size={13} />
                          Field Verifier
                        </span>
                      ) : (
                        <span className="role-stamp role-stamp-user" onClick={() => handleOpenRoleEdit(u)} style={{ cursor: 'pointer' }} title="Click to change role">
                          <Icon name="person" size={13} />
                          {u.role === 'MANAGER' ? 'MANAGER' : 'USER'}
                        </span>
                      )}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="pill pill-green">
                          <span className="dot" />
                          Active
                        </span>
                      ) : (
                        <span className="pill pill-red">
                          <span className="dot" />
                          Inactive
                        </span>
                      )}
                      {u.must_change_password && (
                        <div style={{ marginTop: 5 }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 7px',
                              borderRadius: 9999,
                              fontSize: '0.68rem',
                              lineHeight: 1.35,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              background: '#fff7ed',
                              color: '#c2410c',
                              border: '1px solid #fed7aa',
                            }}
                            title="Temporary password issued. User must change password on next login."
                          >
                            <Icon name="key" size={11} />
                            <span>Temp Pass</span>
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="cell-date">{formatDate(u.created_at)}</span>
                    </td>
                    <td style={{ width: 300 }}>
                      {/* Icon-only cluster: Role Edit → Reset → Deactivate/Activate → Delete */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-ghost user-act-btn"
                          style={{ padding: '6px 8px' }}
                          onClick={() => handleOpenRoleEdit(u)}
                          aria-label={`Change role for ${u.full_name || u.email}`}
                          title="Change user role"
                        >
                          <Icon name="badge" size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost user-act-btn"
                          style={{ padding: '6px 8px' }}
                          onClick={() => handleOpenReset(u)}
                          aria-label={`Reset password for ${u.full_name || u.email}`}
                          title="Reset user password"
                        >
                          <Icon name="lock_reset" size={14} />
                        </button>
                        {u.is_active ? (
                          u.id === currentUser?.id ? (
                            <button
                              type="button"
                              className="btn btn-ghost user-act-btn"
                              disabled
                              style={{ opacity: 0.5, cursor: 'not-allowed', padding: '6px 8px' }}
                              aria-label="Cannot deactivate your own account"
                              title="Cannot deactivate your own account"
                            >
                              <Icon name="person_off" size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-danger user-act-btn"
                              style={{ padding: '6px 8px' }}
                              onClick={() => handleToggleActive(u)}
                              aria-label={`Deactivate ${u.full_name || u.email}`}
                              title="Deactivate user account"
                            >
                              <Icon name="person_off" size={14} />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary user-act-btn"
                            style={{ padding: '6px 8px' }}
                            onClick={() => handleToggleActive(u)}
                            aria-label={`Activate ${u.full_name || u.email}`}
                            title="Activate user account"
                          >
                            <Icon name="how_to_reg" size={14} />
                          </button>
                        )}
                        <button type="button" className="btn btn-danger user-act-btn" style={{ padding: '6px 8px' }} disabled={!currentUser || u.id === currentUser.id}
                          aria-label={`Delete ${u.full_name || u.email}`}
                          title={u.id === currentUser?.id ? 'Cannot delete your own account' : 'Delete user account'}
                          onClick={() => { setDeleteError(''); setDeleteUser(u); }}>
                          <Icon name="delete" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="table-foot-note">
              {total.toLocaleString()} account{total === 1 ? '' : 's'} registered
            </span>
            <Pager
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        </div>
      )}

      {confirmUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setConfirmUser(null)}
        >
          <div
            style={{
              maxWidth: 440,
              width: '100%',
              padding: 24,
              borderRadius: 16,
              background: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.05)',
              border: '1px solid #fee2e2',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#fef2f2',
                    border: '1px solid #fee2e2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#dc2626',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="warning" size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
                    Deactivate User
                  </h3>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: 30, height: 30, padding: 0, borderRadius: 8 }}
                onClick={() => setConfirmUser(null)}
                aria-label="Close dialog"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: 14, color: 'var(--c-ink2, #434655)', lineHeight: 1.55 }}>
              Are you sure you want to deactivate{' '}
              <strong style={{ color: 'var(--c-ink, #0f172a)' }}>
                {confirmUser.full_name || confirmUser.email}
              </strong>
              ? They will be immediately prevented from logging into the mobile app or admin dashboard.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 12px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 12.5,
                color: 'var(--c-ink3, #6b7082)',
                marginBottom: 20,
              }}
            >
              <Icon name="info" size={15} />
              <span>You can reactivate this account later from the Inactive users filter.</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmUser(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  borderColor: '#dc2626',
                  boxShadow: '0 2px 6px -1px rgba(220, 38, 38, 0.4)',
                }}
                onClick={() => executeToggleActive(confirmUser)}
              >
                Deactivate User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal (Admin cannot view current password) */}
      {resetUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => !resetLoading && setResetUser(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              maxWidth: 460,
              width: '100%',
              padding: '24px 26px',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#eff6ff',
                    border: '1px solid #dbeafe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--c-blue, #FF6467)',
                  }}
                >
                  <Icon name="lock_reset" size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                    Reset User Password
                  </h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Set a new password for {resetUser.full_name || resetUser.email}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: 30, height: 30, padding: 0, borderRadius: 8 }}
                onClick={() => setResetUser(null)}
                aria-label="Close dialog"
                disabled={resetLoading}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Privacy & Security Callout (Admin cannot see current password) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 12,
                color: '#475569',
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              <Icon name="security" size={15} style={{ color: '#059669', marginTop: 2, flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#0f172a' }}>Privacy Notice:</strong> For security, current passwords are cryptographically hashed and cannot be viewed by administrators. Enter a new replacement password below.
              </div>
            </div>

            {/* Target User Card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: '#f1f5f9',
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <Avatar name={resetUser.full_name || resetUser.email} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {resetUser.full_name || 'Unnamed User'}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {resetUser.email}
                </div>
              </div>
              <span className="badge-chip badge-blue" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                {resetUser.role}
              </span>
            </div>

            {resetSuccess ? (
              <div>
                <div
                  style={{
                    padding: '16px 18px',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: 12,
                    marginBottom: 16,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#059669', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                    <Icon name="check_circle" size={18} />
                    Temporary Password Generated!
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#065f46', lineHeight: 1.5 }}>
                    Provide this one-time credential to <strong>{resetUser.full_name || resetUser.email}</strong>. They will be forced to set a private password immediately upon their next login:
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      background: '#ffffff',
                      border: '1.5px dashed #10b981',
                      borderRadius: 10,
                      padding: '10px 16px',
                    }}
                  >
                    <code style={{ fontSize: 16, fontWeight: 800, color: '#047857', letterSpacing: 1.2 }}>
                      {resetSuccess}
                    </code>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: '3px 10px', fontSize: 12, color: '#059669', fontWeight: 700 }}
                      onClick={handleCopyPassword}
                    >
                      <Icon name={copiedPassword ? 'check_circle' : 'content_copy'} size={14} />
                      {copiedPassword ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setResetUser(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {resetError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: '#fef2f2',
                      border: '1px solid #fee2e2',
                      borderRadius: 8,
                      fontSize: 12.5,
                      color: '#dc2626',
                      marginBottom: 14,
                    }}
                  >
                    <Icon name="warning" size={15} />
                    <span>{resetError}</span>
                  </div>
                )}

                <div
                  style={{
                    padding: '14px 16px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    marginBottom: 18,
                    fontSize: 13,
                    color: '#334155',
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                    Reset Password for {resetUser.full_name || resetUser.email}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 12 }}>
                    Enter a new password below, or leave blank to automatically generate a secure 16-character temporary password.
                  </div>

                  <div className="field" style={{ marginBottom: 12 }}>
                    <label className="field-label" style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, display: 'block' }}>
                      New Password (Optional)
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        className="fld"
                        placeholder="Leave blank to auto-generate"
                        value={resetCustomPassword}
                        onChange={(e) => setResetCustomPassword(e.target.value)}
                        style={{ paddingRight: 36, width: '100%' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword(!showResetPassword)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 4,
                        }}
                        title={showResetPassword ? 'Hide password' : 'Show password'}
                      >
                        <Icon name={showResetPassword ? 'visibility_off' : 'visibility'} size={18} />
                      </button>
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={resetRequireChange}
                      onChange={(e) => setResetRequireChange(e.target.checked)}
                      style={{ accentColor: '#ea580c', width: 15, height: 15, cursor: 'pointer' }}
                    />
                    <span>Require user to change password upon sign-in</span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setResetUser(null)}
                    disabled={resetLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleExecuteResetPassword}
                    disabled={resetLoading}
                    style={{ minWidth: 175 }}
                  >
                    {resetLoading ? 'Saving…' : (resetCustomPassword.trim() ? 'Reset Password' : 'Generate Temp Password')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Newly Created Account Temporary Password Modal */}
      {createdAccountResult && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setCreatedAccountResult(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              maxWidth: 460,
              width: '100%',
              padding: '24px 26px',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#059669',
                  }}
                >
                  <Icon name="check_circle" size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                    Account Created Successfully
                  </h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    One-time temporary login credential
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: 30, height: 30, padding: 0, borderRadius: 8 }}
                onClick={() => setCreatedAccountResult(null)}
                aria-label="Close dialog"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Target User Info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: '#f1f5f9',
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <Avatar name={createdAccountResult.user.full_name || createdAccountResult.user.email} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {createdAccountResult.user.full_name || 'Unnamed User'}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {createdAccountResult.user.email}
                </div>
              </div>
              <span className="badge-chip badge-blue" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                {createdAccountResult.user.role}
              </span>
            </div>

            {/* Temporary Password Box */}
            <div
              style={{
                padding: '16px 18px',
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 12,
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#065f46', lineHeight: 1.5 }}>
                Provide this one-time credential to <strong>{createdAccountResult.user.full_name}</strong>. They will be forced to choose a private password immediately upon their first sign-in:
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  background: '#ffffff',
                  border: '1.5px dashed #10b981',
                  borderRadius: 10,
                  padding: '10px 16px',
                }}
              >
                <code style={{ fontSize: 16, fontWeight: 800, color: '#047857', letterSpacing: 1.2 }}>
                  {createdAccountResult.temporary_password}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ padding: '3px 10px', fontSize: 12, color: '#059669', fontWeight: 700 }}
                  onClick={() => {
                    if (createdAccountResult.temporary_password) {
                      navigator.clipboard.writeText(createdAccountResult.temporary_password);
                      setCopiedNewAccountPassword(true);
                      setTimeout(() => setCopiedNewAccountPassword(false), 2500);
                    }
                  }}
                >
                  <Icon name={copiedNewAccountPassword ? 'check_circle' : 'content_copy'} size={14} />
                  {copiedNewAccountPassword ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCreatedAccountResult(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Assignment Modal */}
      {editRoleUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !updatingRole && setEditRoleUser(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 480,
              width: '100%',
              padding: 24,
              background: '#ffffff',
              borderRadius: 14,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="badge" size={20} style={{ color: '#bf3646' }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                  Assign User Role
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditRoleUser(null)}
                disabled={updatingRole}
                aria-label="Close"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
              Change role privileges for <strong style={{ color: '#0f172a' }}>{editRoleUser.full_name || editRoleUser.email}</strong> ({editRoleUser.email}).
            </p>

            {roleError && (
              <div role="alert" className="alert alert-error" style={{ marginBottom: 12 }}>
                {roleError}
              </div>
            )}

            <div className="field" style={{ marginBottom: 20 }}>
              <label className="field-label" style={{ marginBottom: 6, fontWeight: 700 }}>Select Role</label>
              <CustomSelect
                value={selectedNewRole}
                onChange={(val) => setSelectedNewRole(val)}
                options={[
                  { value: 'TELECALLER', label: 'Telecaller — calling queue & contact verification' },
                  { value: 'AUDITOR', label: 'Auditor — review routed records and set audit status' },
                  { value: 'FIELD_VERIFIER', label: 'Field Verifier — completes inspections from the mobile app' },
                  { value: 'ADMIN', label: 'Admin — full command studio access' },
                  { value: 'MANAGER', label: 'Manager — view and assign records' },
                  { value: 'USER', label: 'User — legacy field operator' },
                ]}
                ariaLabel="Select new role"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditRoleUser(null)}
                disabled={updatingRole}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveRole}
                disabled={updatingRole || selectedNewRole === editRoleUser.role}
                style={{ background: '#bf3646', borderColor: '#bf3646' }}
              >
                {updatingRole ? 'Updating...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

