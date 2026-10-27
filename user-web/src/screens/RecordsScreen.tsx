import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CaptureRecord, ImageData } from '../types';
import { api } from '../services/api';
import Icon from '../components/common/Icon';
import RecordRouteMetrics from '../components/common/RecordRouteMetrics';
import AuthThumbnail from '../components/common/AuthThumbnail';
import Lightbox from '../components/common/Lightbox';
import GoogleMapEmbed from '../components/common/GoogleMapEmbed';
import VillageMultiSelect, { type VillageOption } from '../components/common/VillageMultiSelect';
import { RecordCardSkeleton } from '../components/common/Skeleton';
import { formatDateTime, formatRecordNo, inspectionDateLabel, getGoogleMapsUrl, isRecordCompleted, isRecordClosed, getRecordStatusBadgeInfo, getRecentCaptureOrInspection } from '../utils/format';
import { useGps } from '../hooks/useGps';
import { useRoadRoute } from '../hooks/useRoadRoute';
import { captureRange, type CaptureRange } from '../utils/dateRange';
import { readRecordState, saveRecordState } from '../utils/recordState';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import MarkStatusModal from '../components/MarkStatusModal';

export type DatePreset = CaptureRange;

interface RecordsScreenProps {
  onOpenRecord: (id: number) => void;
  onStartInspection: (record: CaptureRecord) => void;
  storageKey?: string;
  onInitialFilterApplied?: () => void;
  initialFilter?: {
    datePreset?: DatePreset;
    status?: 'ALL' | 'NOT_COMPLETED' | 'COMPLETED' | 'CLOSED';
    hasPhotosOnly?: boolean;
    viewMode?: 'records' | 'gallery';
  } | null;
}

export default function RecordsScreen({
  onOpenRecord,
  onStartInspection,
  initialFilter,
  storageKey = 'pc_field_records',
  onInitialFilterApplied,
}: RecordsScreenProps) {
  const [saved] = useState(() => readRecordState(storageKey, {
    page: 1, statusFilter: 'NOT_COMPLETED' as 'ALL' | 'NOT_COMPLETED' | 'COMPLETED' | 'CLOSED', datePreset: 'ALL' as DatePreset,
    customStartDate: '', customEndDate: '', searchText: '', search: '', village: '', selectedVillages: [] as string[], viewMode: 'records' as 'records' | 'gallery', scrollTop: 0,
  }));
  const [selectedVillages, setSelectedVillages] = useState<string[]>(() => {
    if (Array.isArray(saved.selectedVillages) && saved.selectedVillages.length > 0) {
      return saved.selectedVillages;
    }
    if (typeof saved.village === 'string' && saved.village.trim()) {
      return saved.village.split(',').map((v: string) => v.trim()).filter(Boolean);
    }
    return [];
  });
  const [locationOptions, setLocationOptions] = useState<{ village: string[]; village_counts?: { name: string; count: number }[] }>({ village: [], village_counts: [] });
  const [locationError, setLocationError] = useState('');
  const scrollTop = useRef(initialFilter ? 0 : saved.scrollTop);
  const restoreScroll = useRef(true);
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialFilter ? 1 : saved.page);
  const [pageSize] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'NOT_COMPLETED' | 'COMPLETED' | 'CLOSED'>(
    initialFilter?.status && initialFilter.status !== 'ALL'
      ? initialFilter.status
      : (saved.statusFilter && saved.statusFilter !== 'ALL' ? saved.statusFilter : 'NOT_COMPLETED')
  );
  const [datePreset, setDatePreset] = useState<DatePreset>(
    initialFilter?.datePreset || saved.datePreset
  );
  const [customStartDate, setCustomStartDate] = useState(saved.customStartDate);
  const [customEndDate, setCustomEndDate] = useState(saved.customEndDate);
  const [searchText, setSearchText] = useState(saved.searchText);
  const [search, setSearch] = useState(saved.search);
  const [selectedMapRecord, setSelectedMapRecord] = useState<CaptureRecord | null>(null);
  const [markStatusRecord, setMarkStatusRecord] = useState<CaptureRecord | null>(null);

  const [viewMode, setViewMode] = useState<'records' | 'gallery'>(
    initialFilter?.hasPhotosOnly || initialFilter?.viewMode === 'gallery' ? 'gallery' : saved.viewMode
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [galleryImageUrls, setGalleryImageUrls] = useState<Record<number, string>>({});
  const [expandedQc, setExpandedQc] = useState<Record<string, boolean>>({});
  const toggleQc = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedQc((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const villageOptions = useMemo<VillageOption[]>(() => {
    if (locationOptions.village_counts && locationOptions.village_counts.length > 0) {
      return locationOptions.village_counts.map((vc) => ({
        name: vc.name,
        count: vc.count,
      }));
    }
    return (locationOptions.village || []).map((name) => ({ name }));
  }, [locationOptions]);

  const gps = useGps();
  const { displayRecords, pendingSortMode, handleSetSortMode, routeProvider, setRouteProvider, routeBusy, routeError, routeNotice } = useRoadRoute(
    records, gps, JSON.stringify([page, statusFilter, search, datePreset, customStartDate, customEndDate, selectedVillages]),
    statusFilter === 'NOT_COMPLETED',
    () => api.listPendingForRoute({ ...captureRange(datePreset, customStartDate, customEndDate), search: searchText.trim() || undefined, village: selectedVillages.length > 0 ? selectedVillages : undefined }),
  );

  // Sync initialFilter if changed from parent (e.g. clicking dashboard matrix card)
  useEffect(() => {
    if (initialFilter) {
      if (initialFilter.status) {
        setStatusFilter(initialFilter.status === 'ALL' ? 'NOT_COMPLETED' : initialFilter.status);
      }
      if (initialFilter.datePreset) setDatePreset(initialFilter.datePreset);
      if (initialFilter.hasPhotosOnly || initialFilter.viewMode === 'gallery') {
        setViewMode('gallery');
      }
      setPage(1);
      onInitialFilterApplied?.();
    }
  }, [initialFilter]);

  // Extract all individual captured photos for Gallery mode
  const allGalleryPhotos = useMemo(() => {
    const items: Array<{ image: ImageData; record: CaptureRecord }> = [];
    records.forEach((rec) => {
      (rec.images || []).forEach((img) => {
        items.push({ image: img, record: rec });
      });
    });
    return items;
  }, [records]);

  // Preload photo thumbnails into Object URLs when in gallery view
  useEffect(() => {
    if (viewMode !== 'gallery') return;
    let active = true;
    const loadThumbs = async () => {
      const urls: Record<number, string> = { ...galleryImageUrls };
      const unCached = allGalleryPhotos.filter((p) => p.image.image_url && !urls[p.image.id]);
      if (!unCached.length) return;
      await Promise.all(
        unCached.slice(0, 40).map(async (p) => {
          try {
            const dataUri = await api.fetchImageAsDataUri(p.image.image_url!);
            urls[p.image.id] = dataUri;
          } catch {
            // ignore
          }
        })
      );
      if (active) setGalleryImageUrls(urls);
    };
    loadThumbs();
    return () => {
      active = false;
    };
  }, [allGalleryPhotos, viewMode]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim() !== search) { setSearch(searchText.trim()); setPage(1); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, search]);

  const recordsRequest = useRef(0);
  const loadRecords = async (background = false) => {
    const request = ++recordsRequest.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      if (datePreset === 'CUSTOM' && customStartDate && customEndDate && customStartDate > customEndDate) throw new Error('From date must be before the To date.');
      const { dateFrom, dateTo } = captureRange(datePreset, customStartDate, customEndDate);
      const res = await api.listRecords({
        page,
        pageSize,
        status: statusFilter,
        search: search || undefined,
        dateFrom,
        dateTo,
        dateField: statusFilter === 'NOT_COMPLETED' ? 'assigned_at' : (statusFilter === 'CLOSED' ? 'created_at' : 'captured_at'),
        sortBy: statusFilter === 'NOT_COMPLETED' ? 'assigned_at' : (statusFilter === 'CLOSED' ? 'created_at' : 'captured_at'),
        village: selectedVillages.length > 0 ? selectedVillages : undefined,
        sortOrder: 'desc',
      });
      if (request !== recordsRequest.current) return;
      let resultRecords = res.records || [];
      if (initialFilter?.hasPhotosOnly) {
        resultRecords = resultRecords.filter((r) => (r.images && r.images.length > 0) || isRecordCompleted(r));
      }
      if (statusFilter === 'COMPLETED') {
        resultRecords = [...resultRecords].sort((a, b) => {
          const timeA = getRecentCaptureOrInspection(a).date?.getTime() || 0;
          const timeB = getRecentCaptureOrInspection(b).date?.getTime() || 0;
          if (timeA !== timeB) return timeB - timeA;
          return b.id - a.id;
        });
      }
      setRecords(resultRecords);
      setTotal(res.total || 0);
      if (page > 1 && page > Math.max(1, Math.ceil(res.total / pageSize))) setPage(Math.max(1, Math.ceil(res.total / pageSize)));
    } catch (err: any) {
      if (request !== recordsRequest.current) return;
      console.error('Failed to load records:', err);
      setError(err?.message || 'Failed to load records. Please check your network connection.');
    } finally {
      if (request === recordsRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
    return () => { recordsRequest.current++; };
  }, [page, statusFilter, datePreset, customStartDate, customEndDate, search, selectedVillages]);
  useForegroundRefresh(() => loadRecords(true));

  useEffect(() => {
    let active = true;
    api.recordLocationOptions('', '', statusFilter).then(options => { if (active) { setLocationOptions(options); setLocationError(''); } })
      .catch(() => { if (active) setLocationError('Location filters could not load. Reopen Records to retry.'); });
    return () => { active = false; };
  }, [statusFilter]);
  useEffect(() => {
    saveRecordState(storageKey, { page, statusFilter, datePreset, customStartDate, customEndDate, searchText, search, village: selectedVillages.join(','), selectedVillages, viewMode, scrollTop: scrollTop.current });
  }, [storageKey, page, statusFilter, datePreset, customStartDate, customEndDate, searchText, search, selectedVillages, viewMode]);
  useEffect(() => {
    const body = document.querySelector('.app-body');
    const saveScroll = () => { if (!restoreScroll.current && body) { scrollTop.current = body.scrollTop; saveRecordState(storageKey, { ...readRecordState(storageKey, saved), scrollTop: body.scrollTop }); } };
    body?.addEventListener('scroll', saveScroll, { passive: true });
    return () => body?.removeEventListener('scroll', saveScroll);
  }, [storageKey]);
  useEffect(() => {
    if (loading || !restoreScroll.current) return;
    const frame = requestAnimationFrame(() => { const body = document.querySelector('.app-body'); if (body) body.scrollTop = scrollTop.current; restoreScroll.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [loading]);


  useEffect(() => {
    if (selectedMapRecord) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [selectedMapRecord]);

  const handleOpenMapLocation = (coords?: string, address?: string) => {
    const url = getGoogleMapsUrl(coords, address);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenDirections = (coords?: string, address?: string) => {
    const dest = coords ? coords.trim() : address || '';
    if (!dest) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="field-record-workspace">
      <div className="field-record-controls">
        <div className="field-record-search">
          <Icon name="search" size={20} />
          <input type="search" name="record-search" autoComplete="off" value={searchText} aria-label="Search records"
            onChange={event => setSearchText(event.target.value)}
            placeholder={viewMode === 'gallery' ? 'Search photos by site or UID…' : 'Search UID, survey no or location…'} />
          {(selectedVillages.length > 0 || datePreset !== 'ALL' || searchText) && <button type="button" className="field-filter-reset" aria-label="Clear filters" title="Clear filters"
            onClick={() => { setSelectedVillages([]); setDatePreset('ALL'); setCustomStartDate(''); setCustomEndDate(''); setSearchText(''); setPage(1); }}><Icon name="restart_alt" size={18} /></button>}
        </div>
        <div className="field-record-filters">
          <label>Date<select name="date-range" aria-label="Filter by date" value={datePreset} onChange={event => { setDatePreset(event.target.value as DatePreset); setPage(1); }}>
            <option value="ALL">All time</option><option value="TODAY">Today</option><option value="YESTERDAY">Yesterday</option><option value="THIS_WEEK">This week</option><option value="THIS_MONTH">This month</option><option value="CUSTOM">Custom range</option>
          </select></label>
          <VillageMultiSelect
            selected={selectedVillages}
            onChange={(villages) => {
              setSelectedVillages(villages);
              setPage(1);
            }}
            options={villageOptions}
          />
        </div>
        {datePreset === 'CUSTOM' && <div className="field-custom-dates">
          <label>From<input type="date" name="date-from" aria-label="From date" value={customStartDate} max={customEndDate || undefined}
            onChange={event => { setCustomStartDate(event.target.value); setPage(1); }} /></label>
          <label>To<input type="date" name="date-to" aria-label="To date" value={customEndDate} min={customStartDate || undefined}
            onChange={event => { setCustomEndDate(event.target.value); setPage(1); }} /></label>
        </div>}
        <p className="field-date-hint">Dates: {statusFilter === 'NOT_COMPLETED' ? 'Assigned' : (statusFilter === 'CLOSED' ? 'Created/Assigned' : 'Capture')} · India time</p>
        {locationError && <p role="alert" className="field-filter-error">{locationError}</p>}
      </div>

      {/* ─── Segmented Filter Tabs (Coral #FF6467) — records only, photos have no status ─── */}
      {viewMode === 'records' && (
        <>
          <div className="feed-filter" role="tablist" aria-label="Filter records">
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'NOT_COMPLETED'}
              onClick={() => {
                setStatusFilter('NOT_COMPLETED');
                setPage(1);
              }}
              className={`feed-filter-btn${statusFilter === 'NOT_COMPLETED' ? ' active' : ''}`}
            >
              Pending
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'COMPLETED'}
              onClick={() => {
                setStatusFilter('COMPLETED');
                setPage(1);
              }}
              className={`feed-filter-btn${statusFilter === 'COMPLETED' ? ' active' : ''}`}
            >
              Completed
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'CLOSED'}
              onClick={() => {
                setStatusFilter('CLOSED');
                setPage(1);
              }}
              className={`feed-filter-btn${statusFilter === 'CLOSED' ? ' active' : ''}`}
            >
              Closed
            </button>
          </div>

          {/* ─── Route & Order No sub-filter: White bg, orange icon, black text like map button ─── */}
          {statusFilter === 'NOT_COMPLETED' && (
            <div
              className="feed-subfilter"
              role="tablist"
              aria-label="Sort pending tasks"
            >
              <button
                type="button"
                role="tab"
                aria-selected={pendingSortMode === 'route'}
                onClick={() => handleSetSortMode('route')}
                disabled={routeBusy || loading || records.length === 0}
                className={`feed-subfilter-btn${pendingSortMode === 'route' ? ' active' : ''}`}
              >
                <Icon name="route" size={16} color={pendingSortMode === 'route' ? '#FF6467' : '#94a3b8'} />
                <span>{routeBusy ? 'Calculating…' : 'Route'}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pendingSortMode === 'order_no'}
                onClick={() => handleSetSortMode('order_no')}
                className={`feed-subfilter-btn${pendingSortMode === 'order_no' ? ' active' : ''}`}
              >
                <Icon name="format_list_numbered" size={16} color={pendingSortMode === 'order_no' ? '#FF6467' : '#94a3b8'} />
                <span>Order No</span>
              </button>

              {/* Compact Route Provider Dropdown */}
              <div
                className={`feed-subfilter-provider${pendingSortMode === 'route' ? ' active' : ''}`}
                title="Routing Provider: OpenRouteService (Self-Hosted / ORS) or Google Maps"
              >
                <Icon name="alt_route" size={14} color={pendingSortMode === 'route' ? '#FF6467' : '#64748b'} />
                <span className="feed-subfilter-provider-label">Prov:</span>
                <select
                  value={routeProvider}
                  onChange={(e) => setRouteProvider(e.target.value as 'ors' | 'gmap')}
                  disabled={routeBusy}
                  aria-label="Route Provider"
                  className="feed-subfilter-select"
                >
                  <option value="ors">ORS</option>
                  <option value="gmap">Google Maps</option>
                </select>
              </div>
            </div>
          )}
        </>
      )}

      {statusFilter === 'NOT_COMPLETED' && <>
        {routeError && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{routeError}</p>}
        {routeNotice && <p role="status" style={{ color: '#64748b', fontSize: '0.75rem' }}>{routeNotice} Includes all pending records matching these filters.</p>}
      </>}
      {/* ─── Records / Photos Count Bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          padding: '0 4px',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.78rem', color: '#0f172a', fontWeight: 700 }}>
            Showing {displayRecords.length} of {pendingSortMode === 'route' ? displayRecords.length : total} records
          </span>

          {loading && (
            <span style={{ fontSize: '0.75rem', color: '#FF6467', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, borderTopColor: '#FF6467' }} />
              Updating...
            </span>
          )}
        </div>
      </div>

      {/* ─── Gallery View Mode ─── */}
      {viewMode === 'gallery' ? (
        <div>
          {loading && allGalleryPhotos.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
              <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3, borderTopColor: '#FF6467' }} />
              <div style={{ marginTop: 12, fontSize: '0.85rem', fontWeight: 600 }}>Loading photo gallery…</div>
            </div>
          ) : allGalleryPhotos.length === 0 ? (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid var(--border-line)',
                borderRadius: 16,
                padding: '48px 16px',
                textAlign: 'center',
              }}
            >
              <Icon name="no_photography" size={42} color="#94a3b8" />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginTop: 10 }}>
                No photos found
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '4px 0 0 0' }}>
                No captured photos match the selected filter ({datePreset.replace('_', ' ')}). Try selecting "All Time".
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {allGalleryPhotos.map((item, idx) => {
                const src = galleryImageUrls[item.image.id] || api.getAuthenticatedImageUrl(item.image.image_url);
                return (
                  <div
                    key={`${item.record.id}-${item.image.id}`}
                    style={{
                      position: 'relative',
                      borderRadius: 14,
                      overflow: 'hidden',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      aspectRatio: '1 / 1',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    }}
                    onClick={() => setLightboxIndex(idx)}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={item.image.file_name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: '#FF6467' }} />
                      </div>
                    )}

                    {/* Top Record Tag */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        right: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          backgroundColor: 'rgba(15, 23, 42, 0.78)',
                          backdropFilter: 'blur(4px)',
                          color: '#ffffff',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 6,
                          maxWidth: '90%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.record.unique_id || formatRecordNo(item.record.id)}
                      </span>
                    </div>

                    {/* Bottom Metadata Bar */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: '4px 6px',
                        background: 'linear-gradient(to top, rgba(15, 23, 42, 0.85), transparent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        color: '#ffffff',
                        fontSize: '0.625rem',
                        fontWeight: 600,
                        pointerEvents: 'none',
                      }}
                    >
                      <span>{formatDateTime(item.image.captured_at)}</span>
                      {item.image.location_accuracy > 0 && (
                        <span>±{Math.round(item.image.location_accuracy)}m</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ─── Records List ─── */}
          {error && records.length === 0 ? (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #fee2e2',
                borderRadius: 16,
                padding: '36px 16px',
                textAlign: 'center',
              }}
            >
              <Icon name="cloud_off" size={40} color="#dc2626" />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginTop: 10 }}>
                Failed to load records
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '6px 0 16px 0' }}>
                {error}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadRecords()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="refresh" size={16} />
                <span>Retry</span>
              </button>
            </div>
          ) : loading && records.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <RecordCardSkeleton />
              <RecordCardSkeleton />
              <RecordCardSkeleton />
              <RecordCardSkeleton />
            </div>
          ) : records.length === 0 ? (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid var(--border-line)',
                borderRadius: 16,
                padding: '48px 16px',
                textAlign: 'center',
              }}
            >
              <Icon name="search_off" size={40} color="#94a3b8" />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginTop: 10 }}>
                No records found
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '4px 0 0 0' }}>
                Try adjusting your search query or filter selection.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                opacity: loading ? 0.6 : 1,
                transition: 'opacity 0.2s ease',
                pointerEvents: loading ? 'none' : 'auto',
              }}
            >
          {displayRecords.map((entry) => {
            const item = entry.record;
            const firstImage = (item.images || [])[0];
            const photoCount = item.images?.length ?? 0;
            const isComplete = statusFilter === 'NOT_COMPLETED' ? false : isRecordCompleted(item);
            const site = item.street_address || item.site_address || item.formatted_address || item.location_name;

            return (
              <div
                key={item.id}
                className="record-card"
                onClick={() => onOpenRecord(item.id)}
                style={{
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  padding: '6px 10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div className="record-thumb-wrap" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36 }}>
                    <AuthThumbnail
                      imageUrl={firstImage?.image_url || (item.qc_reference_image_url ? item.qc_reference_image_url : undefined)}
                      alt={item.name || 'Record thumb'}
                      fallbackIcon={isComplete ? 'photo_camera' : 'assignment'}
                      photoCount={photoCount}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span className="record-id-badge" style={{ fontSize: '0.66rem', padding: '1px 5px', borderRadius: 4 }}>{formatRecordNo(item.id)}</span>
                        {(() => {
                          const badge = getRecordStatusBadgeInfo(item);
                          return (
                            <span
                              className={badge.className}
                              style={{
                                fontSize: '0.66rem',
                                padding: '1px 6px',
                                borderRadius: 4,
                                backgroundColor: badge.bg,
                                color: badge.color,
                                fontWeight: 700,
                              }}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Compact Order, Survey & Unique ID */}
                    {(entry.stopOrder != null || item.visit_order || item.survey_no || (item.unique_id && item.unique_id !== item.name)) && (
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, margin: '1px 0 2px' }}>
                        {(entry.stopOrder != null || item.visit_order) && !isComplete && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                              padding: '1px 5px',
                              borderRadius: 4,
                              backgroundColor: '#eff6ff',
                              color: '#1d4ed8',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              border: '1px solid #bfdbfe',
                            }}
                          >
                            <Icon name={pendingSortMode === 'order_no' ? 'format_list_numbered' : 'route'} size={11} color="#2563eb" />
                            {pendingSortMode === 'order_no' ? `Order #${entry.stopOrder ?? item.visit_order}` : `Nearest #${entry.stopOrder ?? item.visit_order}`}
                          </span>
                        )}
                        {item.survey_no && (
                          <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
                            Survey: {item.survey_no}
                          </span>
                        )}
                        {item.unique_id && item.unique_id !== item.name && (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#FF6467', backgroundColor: '#FFF1F2', padding: '1px 5px', borderRadius: 4 }}>
                            {item.unique_id}
                          </span>
                        )}
                        {item.qc_reference_image_url && (
                          <span
                            style={{
                              fontSize: '0.66rem',
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: '#e0f2fe',
                              color: '#0369a1',
                              border: '1px solid #bae6fd',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                            }}
                            title="QC Reference Image Attached"
                          >
                            <Icon name="image" size={11} color="#0284c7" />
                            QC Ref
                          </span>
                        )}
                      </div>
                    )}

                    {statusFilter === 'NOT_COMPLETED' && !isComplete && <RecordRouteMetrics entry={entry} calculating={routeBusy} />}

                    {(item.village || item.taluk || item.district) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#475569', fontWeight: 600, margin: '1px 0' }}>
                        <Icon name="holiday_village" size={12} color="#64748b" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[item.village, item.taluk, item.district].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}

                    {/* QC Information (VHR Imagery & Street View) - Modern compact badges */}
                    {(item.qc_vhr_comment || item.qc_street_details) && (
                      <div className="record-qc-box">
                        {item.qc_vhr_comment && (() => {
                          const isExp = !!expandedQc[`${item.id}-vhr`];
                          const comment = item.qc_vhr_comment;
                          const isLong = comment.length > 28 || comment.includes('\n');
                          return (
                            <div className={`qc-badge-row ${isExp ? 'is-expanded' : ''}`}>
                              <span className="qc-badge-tag qc-tag-vhr" title="QC Comments (VHR Imagery)">
                                <Icon name="satellite_alt" size={11} />
                                <span>VHR</span>
                              </span>
                              <span className="qc-badge-text" title={isLong ? comment : undefined}>
                                {comment}
                              </span>
                              {isLong && (
                                <button
                                  type="button"
                                  className="qc-toggle-btn"
                                  onClick={(e) => toggleQc(`${item.id}-vhr`, e)}
                                  title={isExp ? 'Show less' : 'Read full QC comment'}
                                >
                                  {isExp ? 'Less' : 'More'}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {item.qc_street_details && (() => {
                          const isExp = !!expandedQc[`${item.id}-street`];
                          const comment = item.qc_street_details;
                          const isLong = comment.length > 28 || comment.includes('\n');
                          return (
                            <div className={`qc-badge-row ${isExp ? 'is-expanded' : ''}`}>
                              <span className="qc-badge-tag qc-tag-street" title="QC Additional Details (Street View)">
                                <Icon name="streetview" size={11} />
                                <span>Street</span>
                              </span>
                              <span className="qc-badge-text" title={isLong ? comment : undefined}>
                                {comment}
                              </span>
                              {isLong && (
                                <button
                                  type="button"
                                  className="qc-toggle-btn"
                                  onClick={(e) => toggleQc(`${item.id}-street`, e)}
                                  title={isExp ? 'Show less' : 'Read full Street View details'}
                                >
                                  {isExp ? 'Less' : 'More'}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: '#94a3b8', margin: '1px 0' }}>
                      <Icon name="schedule" size={11} color="#94a3b8" />
                      <span>{inspectionDateLabel(item)}</span>
                    </div>
                  </div>
                </div>

                {/* Direct Action Bar for pending tasks or location previews */}
                {!isComplete ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginTop: 5,
                      paddingTop: 5,
                      borderTop: '1px solid #f1f5f9',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1.4, padding: '4px 8px', fontSize: '0.74rem', minHeight: 30, height: 30, whiteSpace: 'nowrap' }}
                      onClick={() => onStartInspection(item)}
                    >
                      <Icon name="photo_camera" size={14} />
                      <span>Start Inspection</span>
                    </button>

                    {(item.coordinates || site) && (
                      <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 0.8, padding: '4px 6px', fontSize: '0.74rem', minHeight: 30, height: 30, justifyContent: 'center', whiteSpace: 'nowrap' }}
                        onClick={() => setSelectedMapRecord(item)}
                        title="Preview Location Map"
                      >
                        <Icon name="map" size={14} color="#FF6467" />
                        <span>Map</span>
                      </button>
                      {(item.coordinates || item.street_address || item.site_address) && (
                        <a
                          className="btn btn-secondary btn-sm"
                          style={{ flex: 0.9, padding: '4px 6px', fontSize: '0.74rem', minHeight: 30, height: 30, textAlign: 'center', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.coordinates || item.street_address || item.site_address || '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Icon name="directions" size={14} color="#64748b" />
                          <span>Directions</span>
                        </a>
                      )}
                      </>
                    )}

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 7px', fontSize: '0.74rem', minHeight: 30, height: 30, justifyContent: 'center' }}
                      onClick={() => setMarkStatusRecord(item)}
                      title="Mark Status (Not Interested / Duplicate / Finished)"
                    >
                      <Icon name="label" size={14} color="#64748b" />
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginTop: 4,
                      paddingTop: 5,
                      borderTop: '1px solid #f8fafc',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(item.coordinates || site) && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedMapRecord(item)}
                          style={{ flex: 1, justifyContent: 'center', fontSize: '0.74rem', minHeight: 30, height: 30, padding: '4px 8px' }}
                        >
                          <Icon name="map" size={14} color="#FF6467" />
                          <span>View Site Map</span>
                        </button>
                        <a
                          className="btn btn-secondary btn-sm"
                          style={{ flex: 1, justifyContent: 'center', fontSize: '0.74rem', minHeight: 30, height: 30, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.coordinates || site || '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Icon name="directions" size={14} color="#64748b" />
                          <span>Directions</span>
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setMarkStatusRecord(item)}
                      style={{ justifyContent: 'center', fontSize: '0.74rem', minHeight: 30, height: 30, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      title="Mark or Change Status"
                    >
                      <Icon name="label" size={14} color="#64748b" />
                      <span>Status</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Pagination Controls ─── */}
      {totalPages > 1 && pendingSortMode !== 'route' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginTop: 20,
            padding: '12px 0',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <Icon name="chevron_left" size={16} />
            <span>Previous</span>
          </button>

          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#475569' }}>
            Page {page} of {totalPages}
          </span>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            <span>Next</span>
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      )}
    </>
  )}

      {/* ─── Location Map Modal / Bottom Sheet ─── */}
      {selectedMapRecord && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setSelectedMapRecord(null)}
        >
          <div
            className="bottom-sheet-anim"
            style={{
              backgroundColor: '#ffffff',
              width: '100%',
              maxWidth: 580,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              boxShadow: '0 -12px 36px rgba(15, 23, 42, 0.25)',
              maxHeight: '85dvh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px 0', flexShrink: 0 }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1' }} />
            </div>

            {/* Modal Header */}
            <div
              style={{
                padding: '6px 18px 12px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #f1f5f9',
                gap: 12,
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedMapRecord.name || `Record #${selectedMapRecord.id}`}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedMapRecord.site_address || selectedMapRecord.formatted_address || selectedMapRecord.coordinates || 'Site Geolocation'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedMapRecord(null)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 999,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title="Close"
              >
                <Icon name="close" size={18} color="#64748b" />
              </button>
            </div>

            {/* Scrollable Modal Content */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Embedded Google Map */}
              <GoogleMapEmbed
                coordinates={selectedMapRecord.coordinates}
                address={selectedMapRecord.site_address || selectedMapRecord.formatted_address}
                title={selectedMapRecord.name}
                height={220}
                zoom={15}
              />

              {/* QC Assessment Summary */}
              {(selectedMapRecord.qc_vhr_comment || selectedMapRecord.qc_street_details) && (
                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#f8fafc',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    fontSize: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {selectedMapRecord.qc_vhr_comment && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <span style={{ fontWeight: 700, color: '#0284c7', flexShrink: 0, fontSize: '0.72rem' }}>
                        QC Comments (VHR Imagery):
                      </span>
                      <span style={{ color: '#1e293b', wordBreak: 'break-word' }}>{selectedMapRecord.qc_vhr_comment}</span>
                    </div>
                  )}
                  {selectedMapRecord.qc_street_details && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <span style={{ fontWeight: 700, color: '#059669', flexShrink: 0, fontSize: '0.72rem' }}>
                        QC Additional Details (Street View):
                      </span>
                      <span style={{ color: '#1e293b', wordBreak: 'break-word' }}>{selectedMapRecord.qc_street_details}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pinned Bottom Actions Footer */}
            <div
              style={{
                padding: '12px 16px',
                paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 12px))',
                borderTop: '1px solid #f1f5f9',
                backgroundColor: '#ffffff',
                display: 'flex',
                gap: 10,
                flexShrink: 0,
                boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.03)',
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  flex: 1,
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: '0.875rem',
                }}
                onClick={() => {
                  const rec = selectedMapRecord;
                  const site = rec.site_address || rec.formatted_address || '';
                  setSelectedMapRecord(null);
                  handleOpenMapLocation(rec.coordinates, site);
                }}
              >
                <Icon name="map" size={18} />
                <span>Open in Google Maps</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  minHeight: 44,
                  padding: '0 20px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                }}
                onClick={() => setSelectedMapRecord(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ─── Fullscreen Photo Lightbox for Gallery View ─── */}
      {lightboxIndex !== null && allGalleryPhotos[lightboxIndex] && (
        <Lightbox
          images={allGalleryPhotos.map((p) => p.image)}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSelectIndex={(newIdx) => setLightboxIndex(newIdx)}
          imageUrls={galleryImageUrls}
        />
      )}

      {/* ─── Mark Status Modal ─── */}
      {markStatusRecord && (
        <MarkStatusModal
          record={markStatusRecord}
          isOpen={!!markStatusRecord}
          onClose={() => setMarkStatusRecord(null)}
          onSuccess={(updated) => {
            setMarkStatusRecord(null);
            if (statusFilter === 'NOT_COMPLETED' && isRecordClosed(updated)) {
              setRecords((prev) => prev.filter((r) => r.id !== updated.id));
              setTotal((prev) => Math.max(0, prev - 1));
            } else if (statusFilter === 'CLOSED' && !isRecordClosed(updated)) {
              setRecords((prev) => prev.filter((r) => r.id !== updated.id));
              setTotal((prev) => Math.max(0, prev - 1));
            } else {
              setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            }
          }}
        />
      )}
    </div>
  );
}
