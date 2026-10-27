
function renderFieldStatusBadge(status?: string | null, revisitStatus?: string | null) {
  const s = (status || '').toUpperCase();
  const rev = (revisitStatus || '').toUpperCase();
  if (s === 'COMPLETED' || rev === 'COMPLETED') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#ecfdf5', color: '#059669', whiteSpace: 'nowrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
        Completed
      </span>
    );
  }
  if (s === 'UPDATED REVISITED' || s === 'UPDATED_REVISITED' || s === 'COMPLETED_REVISITED' || rev === 'UPDATED REVISITED' || rev === 'UPDATED_REVISITED') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', whiteSpace: 'nowrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6' }} />
        Revisited
      </span>
    );
  }
  if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#64748b' }} />
        Not Interested
      </span>
    );
  }
  if (s === 'DUPLICATE') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#fffbeb', color: '#b45309', whiteSpace: 'nowrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />
        Duplicate
      </span>
    );
  }
  if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#faf5ff', color: '#7e22ce', whiteSpace: 'nowrap' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#a855f7' }} />
        Finished
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 9999, fontSize: '0.70rem', fontWeight: 700, background: '#fff7ed', color: '#d97706', whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />
      Pending
    </span>
  );
}

import { useEffect, useState } from 'react';
import type { CaptureRecord } from '../types';
import { telecallerApi, SERVER_BASE } from '../services/api';
import {
  Icon,
  EmptyPanel,
  LoadingPanel,
  Pager,
  PageShell,
  CustomSelect,
  AuthThumbnail,
  formatDate,
} from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import { TelecallerRecordModal, TELECALLER_STATUS_OPTIONS } from '../components/TelecallerRecordModal';
import { ExpandableCellText } from '../components/ExpandableCellText';
import { getLatestCommentSummary } from '../utils/telecallerHistory';

const PAGE_SIZE = 25;

export default function TelecallerRecords() {
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [assignedFilter, setAssignedFilter] = useState('all');

  const [selectedRecord, setSelectedRecord] = useState<CaptureRecord | null>(null);

  // Full-size photo viewer overlay state
  const [photoViewer, setPhotoViewer] = useState<{ url: string; name: string } | null>(null);
  const [photoViewerLoading, setPhotoViewerLoading] = useState(false);

  const openPhotoViewer = async (img: { image_url?: string; file_name?: string }) => {
    if (!img.image_url || photoViewerLoading) return;
    setPhotoViewerLoading(true);
    try {
      const normalized = img.image_url.startsWith('/api')
        ? img.image_url
        : `/api${img.image_url.startsWith('/') ? img.image_url : `/${img.image_url}`}`;
      const token = localStorage.getItem('token');
      const res = await fetch(`${SERVER_BASE}${normalized}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setPhotoViewer({ url: URL.createObjectURL(blob), name: img.file_name || 'Field photo' });
    } catch {
      setPhotoViewer(null);
    } finally {
      setPhotoViewerLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (photoViewer) URL.revokeObjectURL(photoViewer.url);
    };
  }, [photoViewer]);

  const loadRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await telecallerApi.getRecords({
        page,
        page_size: PAGE_SIZE,
        search: search.trim() || undefined,
        telecaller_status: statusFilter === 'ALL' ? undefined : statusFilter,
        filter_assigned: assignedFilter,
      });
      setRecords(res.records);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load calling queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    loadRecords();
  }, [page, search, statusFilter, assignedFilter]);

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">Calling Queue</h1>
        <span className="count-pill">{total.toLocaleString()} leads</span>
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
          Telecaller
        </span>
      </div>
    ),
    right: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadRecords()}
          title="Refresh calling queue"
        >
          <Icon name="refresh" size={14} className={loading ? 'fos-spin' : undefined} />
          Refresh
        </button>
      </div>
    ),
  }, [total, loading]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      {/* Search and Filter Toolbar */}
      <div className="toolbar records-toolbar compact-records-toolbar" style={{ marginBottom: 10 }}>
        <div className="toolbar-row toolbar-row-main" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div className="search-wrap records-search-wrap" style={{ flex: '1 1 240px' }}>
            <Icon name="search" />
            <input
              type="search"
              className="fld fld-soft"
              placeholder="Search phone number, name, UID or village..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search phone contacts"
            />
            {searchInput && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          <div className="toolbar-inline-group" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="filter-bar-group" style={{ minWidth: 160 }}>
              <span className="filter-bar-label">Call Status</span>
              <CustomSelect
                value={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setPage(1);
                }}
                ariaLabel="Filter by call status"
                options={[
                  { value: 'ALL', label: 'All Call Statuses' },
                  { value: 'PENDING', label: 'Pending Calls' },
                  { value: 'CONSTRUCTION_CONFIRMED', label: 'Construction Confirmed' },
                  { value: 'CONNECTED_FOLLOW_UP', label: 'Follow Up Needed' },
                  { value: 'NOT_REACHABLE', label: 'Ringing / Not Reachable' },
                  { value: 'WRONG_NUMBER', label: 'Wrong Number' },
                  { value: 'DISCONNECTED_BUSY', label: 'Disconnected / Busy' },
                  { value: 'NOT_INTERESTED', label: 'Not Interested' },
                ]}
              />
            </div>

            <div className="filter-bar-group" style={{ minWidth: 140 }}>
              <span className="filter-bar-label">Queue</span>
              <CustomSelect
                value={assignedFilter}
                onChange={(val) => {
                  setAssignedFilter(val);
                  setPage(1);
                }}
                ariaLabel="Filter by lead queue"
                options={[
                  { value: 'all', label: 'All Calling Leads' },
                  { value: 'my', label: 'Assigned to Me' },
                  { value: 'unassigned', label: 'Unassigned Leads' },
                ]}
              />
            </div>

            {(searchInput || statusFilter !== 'ALL' || assignedFilter !== 'all') && (
              <button
                type="button"
                className="btn btn-ghost btn-sm records-reset-btn"
                onClick={() => {
                  setSearchInput('');
                  setStatusFilter('ALL');
                  setAssignedFilter('all');
                  setPage(1);
                }}
                title="Reset filters"
              >
                <Icon name="restart_alt" size={14} /> Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="record-load-error" style={{ marginBottom: 12 }}>
          {error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadRecords()}>Retry</button>
        </div>
      )}

      {loading && <LoadingPanel text="Loading calling queue..." />}

      {!loading && !error && records.length === 0 && (
        <EmptyPanel
          icon="call"
          text="No contact leads found matching the filters. Only records with a valid Contact Number or Contractor Contact appear here."
        />
      )}

      {!loading && records.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="fos-table records-table">
              <thead>
                <tr>
                  <th style={{ width: 145, minWidth: 140, maxWidth: 155, textAlign: 'left' }}>Unique ID</th>
                  <th style={{ width: 170, minWidth: 150, maxWidth: 200, textAlign: 'left' }}>Owner / Client</th>
                  <th style={{ width: 65, minWidth: 60, maxWidth: 75, textAlign: 'left' }} className="col-photos">Photos</th>
                  <th style={{ width: 125, minWidth: 115, maxWidth: 135, textAlign: 'left' }}>Contact Number</th>
                  <th style={{ width: 150, minWidth: 140, maxWidth: 165, textAlign: 'left' }}>Contractor Contact</th>
                  <th style={{ width: 130, minWidth: 115, maxWidth: 140, textAlign: 'left' }}>Village / District</th>
                  <th style={{ width: 95, minWidth: 85, maxWidth: 105, textAlign: 'left' }}>Field Status</th>
                  <th style={{ width: 150, minWidth: 135, maxWidth: 175, textAlign: 'left' }}>Stage / Building</th>
                  <th style={{ width: 130, minWidth: 120, maxWidth: 145, textAlign: 'left' }}>Telecaller Status</th>
                  <th style={{ width: 180, minWidth: 160, maxWidth: 220, textAlign: 'left' }}>Telecaller Notes</th>
                  <th style={{ width: 120, minWidth: 110, maxWidth: 140, textAlign: 'left' }}>Updated By</th>
                  <th style={{ width: 105, minWidth: 95, maxWidth: 115, textAlign: 'left' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const nil = <span style={{ color: '#94a3b8' }}>—</span>;
                  return (
                    <tr
                      key={r.id}
                      className="rowlink"
                      onClick={() => setSelectedRecord(r)}
                      title="Click to open caller notes & details"
                    >
                      {/* 1. Unique ID */}
                      <td
                        className="rec-unique-id mono-sm col-unique-id"
                        style={{ whiteSpace: 'nowrap', textAlign: 'left', fontWeight: 700, color: '#0f172a' }}
                      >
                        {r.unique_id || `#${r.id}`}
                      </td>

                      {/* 2. Owner / Client */}
                      <td style={{ textAlign: 'left' }}>
                        {(() => {
                          const o = (r.owner_name_en || '').trim();
                          const isBad = (v: string) => !v || v.toLowerCase() === 'new' || v === r.unique_id;
                          const cleanOwner = !isBad(o)
                            ? o
                            : (!isBad((r.name || '').trim()) ? (r.name || '').trim() : '');
                          return (
                            <div className="rec-text-cell" style={{ maxWidth: 200, textAlign: 'left' }}>
                              <ExpandableCellText text={cleanOwner || null} maxChars={28} />
                              {r.building_user_name && r.building_user_name !== cleanOwner && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: '#64748b',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    marginTop: 1,
                                  }}
                                  title={`User: ${r.building_user_name}`}
                                >
                                  User: {r.building_user_name}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* 3. Photos */}
                      <td className="col-photos cell-thumb" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
                        {r.images && r.images.length > 0 ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              className="photo-thumb-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPhotoViewer(r.images![0]);
                              }}
                              title={`View photo 1 of ${r.images.length}`}
                            >
                              <AuthThumbnail
                                imageUrl={r.images[0].thumbnail_url || r.images[0].image_url}
                                alt={r.images[0].file_name || 'Captured photo'}
                                size={34}
                              />
                            </button>
                            {r.images.length > 1 && (
                              <span className="photo-count-chip">+{r.images.length - 1}</span>
                            )}
                          </div>
                        ) : (
                          nil
                        )}
                      </td>

                      {/* 4. Contact Number */}
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        {r.contact_number && r.contact_number.trim() && r.contact_number !== '-' ? (
                          <a
                            href={`tel:${r.contact_number.trim()}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              color: '#059669',
                              fontWeight: 700,
                              textDecoration: 'none',
                              fontSize: 12,
                              whiteSpace: 'nowrap',
                            }}
                            title={`Call ${r.contact_number.trim()}`}
                          >
                            <Icon name="call" size={13} />
                            <span>{r.contact_number.trim()}</span>
                          </a>
                        ) : (
                          nil
                        )}
                      </td>

                      {/* 5. Contractor Contact */}
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
                        {r.site_contractor_architect_number &&
                        r.site_contractor_architect_number.trim() &&
                        r.site_contractor_architect_number !== '-' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <a
                              href={`tel:${r.site_contractor_architect_number.trim()}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                color: '#0284c7',
                                fontWeight: 700,
                                textDecoration: 'none',
                                fontSize: 12,
                                whiteSpace: 'nowrap',
                              }}
                              title={`Call ${r.site_contractor_architect_number.trim()}`}
                            >
                              <Icon name="call" size={13} />
                              <span>{r.site_contractor_architect_number.trim()}</span>
                            </a>
                            {r.site_contractor_architect_name && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#64748b',
                                  maxWidth: 155,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={r.site_contractor_architect_name}
                              >
                                {r.site_contractor_architect_name}
                              </div>
                            )}
                          </div>
                        ) : (
                          nil
                        )}
                      </td>

                      {/* 6. Village / District */}
                      <td style={{ textAlign: 'left' }}>
                        <div
                          style={{
                            color: '#0f172a',
                            fontWeight: 600,
                            fontSize: 11.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 130,
                          }}
                          title={r.village || undefined}
                        >
                          {r.village || nil}
                        </div>
                        {r.district && (
                          <div
                            style={{
                              fontSize: 10,
                              color: '#64748b',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 130,
                            }}
                            title={r.district}
                          >
                            {r.district}
                          </div>
                        )}
                      </td>

                      {/* 7. Field Status */}
                      <td style={{ textAlign: 'left' }}>
                        {renderFieldStatusBadge(r.status, r.revisit_status)}
                      </td>

                      {/* 8. Stage / Building */}
                      <td style={{ textAlign: 'left' }}>
                        {(r.stage_of_construction || r.no_of_floors || r.built_up_area || r.expected_completion) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {r.stage_of_construction && (
                              <div
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  color: '#0f172a',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 165,
                                }}
                                title={r.stage_of_construction}
                              >
                                {r.stage_of_construction}
                              </div>
                            )}
                            {(r.no_of_floors || r.built_up_area) && (
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: '#64748b',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 165,
                                }}
                              >
                                {[r.no_of_floors, r.built_up_area].filter(Boolean).join(' • ')}
                              </div>
                            )}
                            {r.expected_completion && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#0284c7',
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                }}
                                title={`Expected completion: ${r.expected_completion}`}
                              >
                                Exp: {r.expected_completion}
                              </div>
                            )}
                          </div>
                        ) : (
                          nil
                        )}
                      </td>

                      {/* 9. Telecaller Status & Follow-up */}
                      <td style={{ textAlign: 'left' }}>
                        <div>{getStatusChip(r.telecaller_status)}</div>
                        {r.follow_up_date && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#1d4ed8',
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              padding: '1px 5px',
                              borderRadius: 4,
                              marginTop: 4,
                              whiteSpace: 'nowrap',
                            }}
                            title={`Follow-up scheduled on ${formatDate(r.follow_up_date)}`}
                          >
                            <Icon name="event" size={11} />
                            <span>{r.follow_up_date}</span>
                          </div>
                        )}
                      </td>

                      {/* 10. Telecaller Notes */}
                      <td style={{ textAlign: 'left' }}>
                        {r.telecaller_comment ? (
                          <div className="rec-text-cell" style={{ maxWidth: 220, textAlign: 'left' }}>
                            <ExpandableCellText text={getLatestCommentSummary(r.telecaller_comment)} maxChars={35} />
                          </div>
                        ) : (
                          nil
                        )}
                      </td>

                      {/* 10. Action Button */}
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setSelectedRecord(r)}
                          style={{
                            height: 26,
                            padding: '0 8px',
                            fontSize: 11,
                            borderRadius: 6,
                            background: '#bf3646',
                            borderColor: '#bf3646',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Icon name="call" size={13} />
                          Call / Note
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 11.5, color: '#64748b' }}>
              Showing {records.length} of {total.toLocaleString()} call leads
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

      {/* Pop-up modal */}
      {selectedRecord && (
        <TelecallerRecordModal
          key={selectedRecord.id}
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onUpdated={(updated) => {
            setRecords((prev) =>
              prev.map((item) => (item.id === updated.id ? updated : item))
            );
            setSelectedRecord(null);
          }}
        />
      )}

      {/* Full-size photo viewer overlay */}
      {photoViewer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(2, 6, 23, 0.88)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setPhotoViewer(null)}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              maxWidth: 860,
              marginBottom: 10,
            }}
          >
            <strong
              style={{
                color: '#f8fafc',
                fontSize: '0.9rem',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {photoViewer.name}
            </strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setPhotoViewer(null);
              }}
              aria-label="Close photo viewer"
              title="Close"
              style={{ color: '#f8fafc' }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <img
            src={photoViewer.url}
            alt={photoViewer.name}
            style={{
              maxWidth: '100%',
              maxHeight: '82vh',
              borderRadius: 10,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
              display: 'block',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </PageShell>
  );
}
