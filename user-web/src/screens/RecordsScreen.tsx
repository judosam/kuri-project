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
import {
  clusterRecordsByProximity,
  groupRecordsByGpsProximity,
  findNearbySitesForRecord,
  parseCoordinates,
  haversineDistanceMeters,
  type SpatialCluster,
  type GpsProximityGroup,
} from '../utils/geo';
import { captureRange, type CaptureRange } from '../utils/dateRange';
import { readRecordState, saveRecordState } from '../utils/recordState';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import MarkStatusModal from '../components/MarkStatusModal';

export type DatePreset = CaptureRange;

interface RecordsScreenProps {
  onOpenRecord: (id: number) => void;
  onStartInspection: (record: CaptureRecord, nearbyMatch?: any) => void;
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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageSize] = useState(15);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const [isSearchOpen, setIsSearchOpen] = useState(() => Boolean(saved.searchText));
  const [search, setSearch] = useState(saved.search);
  const [selectedMapRecord, setSelectedMapRecord] = useState<CaptureRecord | null>(null);
  const [markStatusRecord, setMarkStatusRecord] = useState<CaptureRecord | null>(null);
  const [proximityMode, setProximityMode] = useState<'none' | '50m' | '100m' | 'village' | 'gps'>('none');
  const [collapsedClusters, setCollapsedClusters] = useState<Record<string, boolean>>({});

  const toggleClusterCollapse = (clusterId: string) => {
    setCollapsedClusters((prev) => ({
      ...prev,
      [clusterId]: !prev[clusterId],
    }));
  };

  const collapseAllClusters = () => {
    const allCollapsed: Record<string, boolean> = {};
    if (proximityMode === '50m') {
      spatial50m.clusters.forEach((c) => { allCollapsed[c.id] = true; });
      spatial50m.standalone.forEach((entry: any) => {
        const r = entry.record || entry;
        const v = (r.village || r.taluk || 'Area').trim();
        allCollapsed[`area-${v}`] = true;
      });
    } else if (proximityMode === '100m') {
      spatial100m.clusters.forEach((c) => { allCollapsed[c.id] = true; });
      spatial100m.standalone.forEach((entry: any) => {
        const r = entry.record || entry;
        const v = (r.village || r.taluk || 'Area').trim();
        allCollapsed[`area-${v}`] = true;
      });
    } else if (proximityMode === 'village') {
      displayRecords.forEach((entry: any) => {
        const r = entry.record || entry;
        const v = (r.village || r.taluk || 'Area').trim();
        allCollapsed[`area-${v}`] = true;
      });
    }
    setCollapsedClusters(allCollapsed);
  };

  const expandAllClusters = () => {
    setCollapsedClusters({});
  };

  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(() => localStorage.getItem('kuri_verifier_filters_expanded') === 'true');
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

  const spatial50m = useMemo(() => {
    return clusterRecordsByProximity(displayRecords, (e) => e.record, 50);
  }, [displayRecords]);

  const spatial100m = useMemo(() => {
    return clusterRecordsByProximity(displayRecords, (e) => e.record, 100);
  }, [displayRecords]);

  const gpsGroups = useMemo(() => {
    if (!gps.fix) return [];
    return groupRecordsByGpsProximity(displayRecords, (e) => e.record, gps.fix);
  }, [displayRecords, gps.fix]);

  const nearbyMap = useMemo(() => {
    const allRecs = displayRecords.map((e) => e.record);
    const map = new Map<number, ReturnType<typeof findNearbySitesForRecord>>();
    for (const r of allRecs) {
      map.set(r.id, findNearbySitesForRecord(r, allRecs, 100));
    }
    return map;
  }, [displayRecords]);

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
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingNextPageRef = useRef(false);

  const loadRecords = async (background = false) => {
    const request = ++recordsRequest.current;
    if (!background) {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
    }
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

      const isEnd = resultRecords.length === 0 || resultRecords.length < pageSize || (page * pageSize >= (res.total || 0));
      setHasMore(!isEnd);

      // If page > 1 returned 0 records unexpectedly (e.g. from an out-of-bounds page), reset to 1
      if (page > 1 && resultRecords.length === 0 && (records.length === 0 || (res.total || 0) > 0)) {
        setPage(1);
        return;
      }

      setRecords((prev) => {
        if (page === 1) return resultRecords;
        const seen = new Set(prev.map((r) => r.id));
        const fresh = resultRecords.filter((r) => !seen.has(r.id));
        return [...prev, ...fresh];
      });
      setTotal(res.total || 0);
    } catch (err: any) {
      if (request !== recordsRequest.current) return;
      console.error('Failed to load records:', err);
      setError(err?.message || 'Failed to load records. Please check your network connection.');
    } finally {
      if (request === recordsRequest.current) {
        setLoading(false);
        setLoadingMore(false);
        isFetchingNextPageRef.current = false;
      }
    }
  };

  useEffect(() => {
    loadRecords();
    return () => { recordsRequest.current++; };
  }, [page, statusFilter, datePreset, customStartDate, customEndDate, search, selectedVillages]);
  useForegroundRefresh(() => loadRecords(true));

  // Infinite scroll listener & observer on .app-body
  useEffect(() => {
    const body = document.querySelector('.app-body');
    if (!body) return;

    const handleInfiniteScroll = () => {
      if (!hasMore || isFetchingNextPageRef.current || loading || loadingMore) return;
      if (records.length >= total) return;
      const { scrollTop, scrollHeight, clientHeight } = body;
      if (scrollHeight - (scrollTop + clientHeight) < 320) {
        isFetchingNextPageRef.current = true;
        setPage((prev) => prev + 1);
      }
    };

    body.addEventListener('scroll', handleInfiniteScroll, { passive: true });
    return () => body.removeEventListener('scroll', handleInfiniteScroll);
  }, [hasMore, loading, loadingMore, records.length, total]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const body = document.querySelector('.app-body');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingNextPageRef.current && !loading && !loadingMore && records.length < total) {
          isFetchingNextPageRef.current = true;
          setPage((prev) => prev + 1);
        }
      },
      { root: body, rootMargin: '250px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, records.length, total]);

  useEffect(() => {
    let active = true;
    api.recordLocationOptions('', '', statusFilter).then(options => { if (active) { setLocationOptions(options); setLocationError(''); } })
      .catch(() => { if (active) setLocationError('Location filters could not load. Reopen Records to retry.'); });
    return () => { active = false; };
  }, [statusFilter]);
  useEffect(() => {
    saveRecordState(storageKey, { page: 1, statusFilter, datePreset, customStartDate, customEndDate, searchText, search, village: selectedVillages.join(','), selectedVillages, viewMode, scrollTop: scrollTop.current });
  }, [storageKey, statusFilter, datePreset, customStartDate, customEndDate, searchText, search, selectedVillages, viewMode]);
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

  const renderRecordCard = (entry: any, isClustered = false) => {
    const item = entry.record;
    const firstImage = (item.images || [])[0];
    const photoCount = item.images?.length ?? 0;
    const isComplete = statusFilter === 'NOT_COMPLETED' ? false : isRecordCompleted(item);
    const site = item.street_address || item.site_address || item.formatted_address || item.location_name;
    const nearby = nearbyMap.get(item.id) || [];
    const nearby50 = nearby.filter((n) => n.distanceMeters <= 50);

    return (
      <div
        key={item.id}
        className="record-card compact-modern-card"
        onClick={() => onOpenRecord(item.id)}
        style={{
          flexDirection: 'column',
          alignItems: 'stretch',
          padding: '8px 10px',
          borderRadius: 12,
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderLeft: isClustered ? '4px solid #6366f1' : undefined,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
          gap: 4,
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Top Header Row: Thumbnail + Title + Status + Duplicate badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div className="record-thumb-wrap" style={{ width: 34, height: 34, minWidth: 34, minHeight: 34, borderRadius: 8 }}>
            <AuthThumbnail
              imageUrl={firstImage?.image_url || (item.qc_reference_image_url ? item.qc_reference_image_url : undefined)}
              alt={item.name || 'Record thumb'}
              fallbackIcon={isComplete ? 'photo_camera' : 'assignment'}
              photoCount={photoCount}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.unique_id || item.name}
                </span>
                <span className="record-id-badge" style={{ fontSize: '0.64rem', padding: '1px 4px', borderRadius: 4, flexShrink: 0 }}>
                  {formatRecordNo(item.id)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {(() => {
                  const badge = getRecordStatusBadgeInfo(item);
                  return (
                    <span
                      className={badge.className}
                      style={{
                        fontSize: '0.65rem',
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

            {/* Line 2: Order / Survey / Duplicate / Proximity Chips */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, margin: '2px 0 1px' }}>
              {(() => {
                let distLabel: string | undefined = entry.currentDistanceFormatted;
                if (!distLabel && gps.fix) {
                  const targetCoords = parseCoordinates(item.coordinates);
                  if (targetCoords) {
                    const d = haversineDistanceMeters(gps.fix.latitude, gps.fix.longitude, targetCoords[0], targetCoords[1]);
                    distLabel = d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)} km`;
                  }
                }

                return (
                  <>
                    {(entry.stopOrder != null || item.visit_order) && !isComplete && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          padding: '1px 6px',
                          borderRadius: 4,
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          border: '1px solid #bfdbfe',
                        }}
                      >
                        <Icon name={pendingSortMode === 'order_no' ? 'format_list_numbered' : 'route'} size={10} color="#2563eb" />
                        {pendingSortMode === 'order_no'
                          ? `Order #${entry.stopOrder ?? item.visit_order}`
                          : `Nearest #${entry.stopOrder ?? item.visit_order}${distLabel ? ` • ${distLabel}` : ''}`}
                      </span>
                    )}

                    {distLabel && pendingSortMode === 'order_no' && !isComplete && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          padding: '1px 5px',
                          borderRadius: 4,
                          backgroundColor: '#e0f2fe',
                          color: '#0369a1',
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          border: '1px solid #bae6fd',
                        }}
                      >
                        <Icon name="near_me" size={10} color="#0284c7" />
                        {distLabel}
                      </span>
                    )}
                  </>
                );
              })()}

              {item.is_duplicate && (
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    color: item.duplicate_is_visited ? '#be123c' : '#b45309',
                    backgroundColor: item.duplicate_is_visited ? '#fff1f2' : '#fffbeb',
                    border: `1px solid ${item.duplicate_is_visited ? '#fecdd3' : '#fde68a'}`,
                    padding: '1.5px 6px',
                    borderRadius: 5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                  }}
                  title={item.duplicate_warning || 'Site may be already visited'}
                >
                  <Icon name="warning" size={10} color={item.duplicate_is_visited ? '#be123c' : '#b45309'} />
                  <span>{item.duplicate_is_visited ? 'Visited Match' : 'Match'}</span>
                  {item.duplicate_distance_m != null && (
                    <span style={{ opacity: 0.85 }}>({Math.round(item.duplicate_distance_m)}m)</span>
                  )}
                </span>
              )}

              {nearby50.length > 0 && !item.is_duplicate && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    color: '#4338ca',
                    backgroundColor: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    padding: '1px 5px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                  title={`${nearby50.length} sites within 50m`}
                >
                  <Icon name="hub" size={10} color="#4f46e5" />
                  {nearby50.length} &le; 50m
                </span>
              )}
            </div>

            {/* Line 3: Dedicated Location / Address row */}
            {(item.village || item.taluk || site) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 1px', fontSize: '0.71rem', color: '#64748b', fontWeight: 600 }}>
                <Icon name="location_on" size={11} color="#94a3b8" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={[item.village, item.taluk, item.district, site].filter(Boolean).join(', ')}>
                  {[item.village, item.taluk, item.district || site].filter(Boolean).join(', ')}
                </span>
              </div>
            )}

            {/* Line 4: QC Micro-Badges (VHR & Street View) */}
            {(item.qc_vhr_comment || item.qc_street_details) && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, margin: '2px 0 1px' }}>
                {item.qc_vhr_comment && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 5px',
                      borderRadius: 4,
                      backgroundColor: '#eff6ff',
                      color: '#1e40af',
                      fontSize: '0.66rem',
                      fontWeight: 600,
                      border: '1px solid #dbeafe',
                      maxWidth: 240,
                    }}
                    title={`VHR: ${item.qc_vhr_comment}`}
                  >
                    <Icon name="satellite_alt" size={10} color="#2563eb" />
                    <strong>VHR:</strong>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.qc_vhr_comment}
                    </span>
                  </span>
                )}
                {item.qc_street_details && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 5px',
                      borderRadius: 4,
                      backgroundColor: '#f0fdf4',
                      color: '#166534',
                      fontSize: '0.66rem',
                      fontWeight: 600,
                      border: '1px solid #dcfce7',
                      maxWidth: 240,
                    }}
                    title={`Street: ${item.qc_street_details}`}
                  >
                    <Icon name="streetview" size={10} color="#16a34a" />
                    <strong>Street:</strong>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.qc_street_details}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Streamlined Single-Row Action Bar */}
        {!isComplete ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 4,
              paddingTop: 5,
              borderTop: '1px solid #f1f5f9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Primary Action Button */}
            <button
              type="button"
              className="btn btn-primary"
              style={{
                flex: 1.5,
                padding: '5px 12px',
                fontSize: '0.78rem',
                fontWeight: 700,
                minHeight: 32,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderRadius: 7,
                backgroundColor: '#ea580c',
                borderColor: '#ea580c',
                color: '#ffffff',
                boxShadow: '0 2px 5px rgba(234, 88, 12, 0.35)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onStartInspection(item, nearby50[0]);
              }}
              title="Open camera and start site inspection"
            >
              <Icon name="photo_camera" size={15} color="#ffffff" />
              <span>Start Inspection</span>
            </button>

            {(item.coordinates || site) && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    minHeight: 30,
                    height: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    borderRadius: 6,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                  }}
                  onClick={() => setSelectedMapRecord(item)}
                  title="Preview Location Map"
                >
                  <Icon name="map" size={13} color="#FF6467" />
                  <span>Map</span>
                </button>
                <a
                  className="btn btn-secondary btn-sm"
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    minHeight: 30,
                    height: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    borderRadius: 6,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    color: '#0284c7',
                    textDecoration: 'none',
                  }}
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.coordinates || item.street_address || item.site_address || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Open GPS navigation in Google Maps"
                >
                  <Icon name="directions" size={13} color="#0284c7" />
                  <span>Nav</span>
                </a>
              </>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{
                flex: 0.9,
                padding: '4px 6px',
                fontSize: '0.72rem',
                fontWeight: 600,
                minHeight: 30,
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                borderRadius: 6,
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: '#475569',
              }}
              onClick={() => setMarkStatusRecord(item)}
              title="Update Status (Not Interested / Duplicate / Finished)"
            >
              <Icon name="label" size={13} color="#64748b" />
              <span>Status</span>
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 4,
              paddingTop: 4,
              borderTop: '1px solid #f8fafc',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: '#94a3b8' }}>
              <Icon name="schedule" size={11} color="#94a3b8" />
              <span>{inspectionDateLabel(item)}</span>
            </div>

            {(item.coordinates || site) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedMapRecord(item)}
                style={{
                  padding: '2px 8px',
                  fontSize: '0.68rem',
                  height: 24,
                  minHeight: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  borderRadius: 5,
                  background: '#f8fafc',
                }}
              >
                <Icon name="map" size={11} color="#FF6467" />
                <span>Map</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderVillageClusters = (standaloneRecords: any[], startIdx = 1) => {
    const groups: { [key: string]: any[] } = {};
    standaloneRecords.forEach((entry) => {
      const r = entry.record || entry;
      const vName = (r.village || r.taluk || 'Coimbatore Area').trim();
      if (!groups[vName]) groups[vName] = [];
      groups[vName].push(entry);
    });
    const sortedVillages = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

    return sortedVillages.map((vName, idx) => {
      const clusterId = `area-${vName}`;
      const isCollapsed = Boolean(collapsedClusters[clusterId]);

      return (
        <div
          key={clusterId}
          style={{
            borderRadius: 14,
            background: '#ffffff',
            border: '1.5px solid #d1fae5',
            padding: '10px 10px 8px',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.08)',
          }}
        >
          <div
            onClick={() => toggleClusterCollapse(clusterId)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: isCollapsed ? 0 : 8,
              paddingBottom: isCollapsed ? 0 : 6,
              borderBottom: isCollapsed ? 'none' : '1px solid #ecfdf5',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor: isCollapsed ? '#f1f5f9' : '#dcfce7',
                  color: isCollapsed ? '#64748b' : '#047857',
                }}
              >
                <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={15} />
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#047857' }}>
                📍 Cluster #{startIdx + idx} • {vName} Area
              </span>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#059669', background: '#dcfce7', padding: '1px 6px', borderRadius: 10 }}>
                {groups[vName].length} sites
              </span>
            </div>
            <span style={{ fontSize: '0.68rem', color: isCollapsed ? '#64748b' : '#059669', fontWeight: 600 }}>
              {isCollapsed ? 'Expand ▼' : 'Collapse ▲'}
            </span>
          </div>
          {!isCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups[vName].map((entry: any) => renderRecordCard(entry, true))}
            </div>
          )}
        </div>
      );
    });
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="field-record-workspace">
      <div className="field-record-controls" style={{ marginBottom: 8 }}>
        {/* Compact Expandable Search Input (revealed by search icon or active query) */}
        {(isSearchOpen || searchText) && (
          <div className="field-record-search" style={{ minHeight: 36, padding: '0 8px', marginBottom: 6 }}>
            <Icon name="search" size={18} color="#64748b" />
            <input
              type="search"
              name="record-search"
              autoComplete="off"
              value={searchText}
              autoFocus
              aria-label="Search records"
              style={{ minHeight: 34, fontSize: 13 }}
              onChange={event => { setSearchText(event.target.value); setPage(1); }}
              placeholder={viewMode === 'gallery' ? 'Search photos by site or UID…' : 'Search UID, survey no or location…'}
            />
            <button
              type="button"
              className="field-filter-reset"
              style={{ width: 32, height: 32 }}
              aria-label="Close search"
              title="Close search"
              onClick={() => {
                setSearchText('');
                setIsSearchOpen(false);
                setPage(1);
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        {filtersExpanded && (
        <>
        <div className="field-record-filters" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 4 }}>
          <label style={{ flex: 1, minWidth: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ height: 18, fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center' }}>Date</span>
            <select
              name="date-range"
              aria-label="Filter by date"
              value={datePreset}
              style={{
                width: '100%',
                height: 34,
                minHeight: 34,
                fontSize: 12.5,
                borderRadius: 8,
                padding: '0 8px',
                border: '1px solid var(--border-line)',
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
              onChange={event => { setDatePreset(event.target.value as DatePreset); setPage(1); }}
            >
              <option value="ALL">All time</option>
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="THIS_WEEK">This week</option>
              <option value="THIS_MONTH">This month</option>
              <option value="CUSTOM">Custom range</option>
            </select>
          </label>

          <div style={{ flex: 1.1, minWidth: 0 }}>
            <VillageMultiSelect
              selected={selectedVillages}
              onChange={(villages) => {
                setSelectedVillages(villages);
                setPage(1);
              }}
              options={villageOptions}
            />
          </div>

          {/* Search Toggle Icon Button */}
          {!isSearchOpen && !searchText && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                width: 34,
                minWidth: 34,
                height: 34,
                minHeight: 34,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                background: '#ffffff',
                border: '1px solid var(--border-line)',
                flexShrink: 0,
                boxSizing: 'border-box',
              }}
              onClick={() => setIsSearchOpen(true)}
              aria-label="Open search"
              title="Search records"
            >
              <Icon name="search" size={18} color="#64748b" />
            </button>
          )}

          {/* Reset Filters Icon Button */}
          {(selectedVillages.length > 0 || datePreset !== 'ALL' || searchText) && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                width: 34,
                minWidth: 34,
                height: 34,
                minHeight: 34,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                background: '#fff1f2',
                border: '1px solid #fecdd3',
                color: '#e11d48',
                flexShrink: 0,
                boxSizing: 'border-box',
              }}
              aria-label="Clear all filters"
              title="Clear all filters"
              onClick={() => {
                setSelectedVillages([]);
                setDatePreset('ALL');
                setCustomStartDate('');
                setCustomEndDate('');
                setSearchText('');
                setIsSearchOpen(false);
                setPage(1);
              }}
            >
              <Icon name="restart_alt" size={18} color="#e11d48" />
            </button>
          )}
        </div>

        {datePreset === 'CUSTOM' && (
          <div className="field-custom-dates" style={{ marginTop: 4, marginBottom: 4 }}>
            <label>From<input type="date" name="date-from" aria-label="From date" value={customStartDate} max={customEndDate || undefined}
              onChange={event => { setCustomStartDate(event.target.value); setPage(1); }} /></label>
            <label>To<input type="date" name="date-to" aria-label="To date" value={customEndDate} min={customStartDate || undefined}
              onChange={event => { setCustomEndDate(event.target.value); setPage(1); }} /></label>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '2px 0 4px 0' }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            Dates: {statusFilter === 'NOT_COMPLETED' ? 'Assigned' : (statusFilter === 'CLOSED' ? 'Created/Assigned' : 'Capture')} · IST
          </span>
        </div>
        </>
        )}
        {locationError && <p role="alert" className="field-filter-error" style={{ margin: '4px 0 0', fontSize: 11 }}>{locationError}</p>}
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

          {/* Proximity Grouping Selector */}
          {filtersExpanded && (
          <div className="proximity-group-bar" role="toolbar" aria-label="Proximity grouping options">
            <span className="proximity-group-label">
              <Icon name="layers" size={13} color="#64748b" />
              Group:
            </span>
            <button
              type="button"
              onClick={() => setProximityMode('none')}
              className={`proximity-group-pill${proximityMode === 'none' ? ' active' : ''}`}
            >
              Flat
            </button>
            <button
              type="button"
              onClick={() => setProximityMode('50m')}
              className={`proximity-group-pill${proximityMode === '50m' ? ' active' : ''}`}
              title="Group sites within 50 meters of each other (Adjacent Plots / Same Layout)"
            >
              <Icon name="radar" size={13} />
              50m Clusters
              {spatial50m.clusters.length > 0 && (
                <span className="cluster-badge-count">{spatial50m.clusters.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setProximityMode('100m')}
              className={`proximity-group-pill${proximityMode === '100m' ? ' active' : ''}`}
              title="Group sites within 100 meters of each other (Same Street)"
            >
              <Icon name="radar" size={13} />
              100m Clusters
              {spatial100m.clusters.length > 0 && (
                <span className="cluster-badge-count">{spatial100m.clusters.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setProximityMode('village')}
              className={`proximity-group-pill${proximityMode === 'village' ? ' active' : ''}`}
              title="Group all sites into Village Clusters"
            >
              <Icon name="radar" size={13} />
              Village Clusters
            </button>
            <button
              type="button"
              onClick={() => {
                if (!gps.fix) gps.retry();
                setProximityMode('gps');
              }}
              className={`proximity-group-pill${proximityMode === 'gps' ? ' active' : ''}`}
              title="Group by live distance from your phone GPS"
            >
              <Icon name="my_location" size={13} />
              Near Me (GPS)
            </button>
          </div>
          )}
        </>
      )}

      {statusFilter === 'NOT_COMPLETED' && (
        <>
          {routeError && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.75rem', margin: '2px 0 4px' }}>{routeError}</p>}
          {routeNotice && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                margin: '2px 0 6px',
                borderRadius: 6,
                backgroundColor: '#f1f5f9',
                border: '1px solid #e2e8f0',
                color: '#475569',
                fontSize: '0.70rem',
                lineHeight: 1.25,
              }}
            >
              <Icon name="route" size={13} color="#2563eb" />
              <span>
                <strong>Road Route ({displayRecords.length} sites)</strong> · Nearest first from GPS. Refresh if moved &gt;100m.
              </span>
            </div>
          )}
        </>
      )}
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

        <button
          type="button"
          onClick={() => {
            setFiltersExpanded((prev) => {
              const next = !prev;
              localStorage.setItem('kuri_verifier_filters_expanded', String(next));
              return next;
            });
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 9px',
            fontSize: '0.74rem',
            fontWeight: 700,
            borderRadius: 7,
            border: '1px solid #fed7aa',
            background: filtersExpanded ? '#fff7ed' : '#ffffff',
            color: '#ea580c',
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
          title={filtersExpanded ? 'Collapse filters to maximize inspection card view' : 'Expand date, village, and grouping filters'}
        >
          <Icon name={filtersExpanded ? 'expand_less' : 'tune'} size={14} color="#ea580c" />
          <span>{filtersExpanded ? 'Collapse' : 'Filters & Groups'}</span>
          {!filtersExpanded && (selectedVillages.length > 0 || datePreset !== 'ALL' || proximityMode !== 'none') && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ea580c', display: 'inline-block' }} />
          )}
        </button>
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

          {proximityMode === '50m' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  background: '#f5f3ff',
                  borderRadius: 10,
                  border: '1.5px solid #ddd6fe',
                  fontSize: '0.78rem',
                  color: '#5b21b6',
                  fontWeight: 700,
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="hub" size={15} color="#7c3aed" />
                  {spatial50m.clusters.length > 0
                    ? `${spatial50m.clusters.length} Cluster(s) within 50m (${spatial50m.totalClustered} sites)`
                    : '50m Proximity Clusters'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={expandAllClusters}
                    style={{ background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#5b21b6', cursor: 'pointer' }}
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllClusters}
                    style={{ background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#5b21b6', cursor: 'pointer' }}
                  >
                    Collapse All
                  </button>
                  <button
                    type="button"
                    onClick={() => setProximityMode('none')}
                    style={{ background: 'none', border: 'none', color: '#6d28d9', fontSize: '0.74rem', fontWeight: 800, cursor: 'pointer', padding: '0 4px' }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {spatial50m.clusters.length === 0 && (
                <div style={{ padding: '20px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
                  <Icon name="radar" size={24} color="#94a3b8" />
                  <div style={{ fontWeight: 700, marginTop: 6, color: '#334155' }}>No 50m Clusters Found</div>
                  <div style={{ fontSize: '0.74rem', marginTop: 2, color: '#64748b' }}>None of the loaded sites are within 50m of each other.</div>
                  <button
                    type="button"
                    onClick={() => setProximityMode('none')}
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 10, padding: '4px 12px', fontSize: '0.74rem' }}
                  >
                    Switch to Flat List
                  </button>
                </div>
              )}

              {spatial50m.clusters.map((cluster) => {
                const isCollapsed = Boolean(collapsedClusters[cluster.id]);
                return (
                  <div key={cluster.id} className="cluster-card-wrap cluster-50m">
                    <div
                      className="cluster-header"
                      onClick={() => toggleClusterCollapse(cluster.id)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title={isCollapsed ? 'Click to expand group' : 'Click to collapse group'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: isCollapsed ? '#f1f5f9' : '#ede9fe',
                            color: isCollapsed ? '#64748b' : '#6d28d9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={15} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cluster.label}
                          </div>
                          <div style={{ fontSize: '0.70rem', color: '#6d28d9', fontWeight: 600 }}>
                            Adjacent plots • Max span: {cluster.maxSpanMeters}m
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: isCollapsed ? '#f1f5f9' : '#ffffff',
                            color: isCollapsed ? '#64748b' : '#4c1d95',
                            border: '1px solid #ddd6fe',
                            borderRadius: 6,
                            padding: '2px 7px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cluster.records.length} plots {isCollapsed ? '▼' : '▲'}
                        </span>
                      </div>
                    </div>
                    {!isCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {cluster.records.map((entry: any) => renderRecordCard(entry, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : proximityMode === '100m' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  background: '#f0f9ff',
                  borderRadius: 10,
                  border: '1.5px solid #bae6fd',
                  fontSize: '0.78rem',
                  color: '#0369a1',
                  fontWeight: 700,
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="radar" size={15} color="#0284c7" />
                  {spatial100m.clusters.length > 0
                    ? `${spatial100m.clusters.length} Cluster(s) within 100m (${spatial100m.totalClustered} sites)`
                    : '100m Proximity Clusters'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={expandAllClusters}
                    style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#0369a1', cursor: 'pointer' }}
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllClusters}
                    style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#0369a1', cursor: 'pointer' }}
                  >
                    Collapse All
                  </button>
                  <button
                    type="button"
                    onClick={() => setProximityMode('none')}
                    style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '0.74rem', fontWeight: 800, cursor: 'pointer', padding: '0 4px' }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {spatial100m.clusters.length === 0 && (
                <div style={{ padding: '20px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
                  <Icon name="radar" size={24} color="#94a3b8" />
                  <div style={{ fontWeight: 700, marginTop: 6, color: '#334155' }}>No 100m Clusters Found</div>
                  <div style={{ fontSize: '0.74rem', marginTop: 2, color: '#64748b' }}>None of the loaded sites are within 100m of each other.</div>
                  <button
                    type="button"
                    onClick={() => setProximityMode('none')}
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 10, padding: '4px 12px', fontSize: '0.74rem' }}
                  >
                    Switch to Flat List
                  </button>
                </div>
              )}

              {spatial100m.clusters.map((cluster) => {
                const isCollapsed = Boolean(collapsedClusters[cluster.id]);
                return (
                  <div key={cluster.id} className="cluster-card-wrap cluster-100m">
                    <div
                      className="cluster-header"
                      onClick={() => toggleClusterCollapse(cluster.id)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title={isCollapsed ? 'Click to expand group' : 'Click to collapse group'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: isCollapsed ? '#f1f5f9' : '#e0f2fe',
                            color: isCollapsed ? '#64748b' : '#0284c7',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={15} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0c4a6e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cluster.label}
                          </div>
                          <div style={{ fontSize: '0.70rem', color: '#0284c7', fontWeight: 600 }}>
                            Same street • Max span: {cluster.maxSpanMeters}m
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: isCollapsed ? '#f1f5f9' : '#ffffff',
                            color: isCollapsed ? '#64748b' : '#0369a1',
                            border: '1px solid #bae6fd',
                            borderRadius: 6,
                            padding: '2px 7px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cluster.records.length} plots {isCollapsed ? '▼' : '▲'}
                        </span>
                      </div>
                    </div>
                    {!isCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {cluster.records.map((entry: any) => renderRecordCard(entry, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : proximityMode === 'village' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  background: '#f0fdf4',
                  borderRadius: 10,
                  border: '1.5px solid #bbf7d0',
                  fontSize: '0.78rem',
                  color: '#166534',
                  fontWeight: 700,
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <span>🏘️ Village Area Clusters ({displayRecords.length} sites)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={expandAllClusters}
                    style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#166534', cursor: 'pointer' }}
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllClusters}
                    style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, padding: '2px 6px', fontSize: '0.68rem', fontWeight: 700, color: '#166534', cursor: 'pointer' }}
                  >
                    Collapse All
                  </button>
                  <button
                    type="button"
                    onClick={() => setProximityMode('none')}
                    style={{ background: 'none', border: 'none', color: '#166534', fontSize: '0.74rem', fontWeight: 800, cursor: 'pointer', padding: '0 4px' }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {renderVillageClusters(displayRecords, 1)}
            </div>
          ) : proximityMode === 'gps' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!gps.fix ? (
                <div
                  style={{
                    padding: '20px 16px',
                    textAlign: 'center',
                    background: '#ffffff',
                    borderRadius: 14,
                    border: '1.5px solid #e2e8f0',
                  }}
                >
                  <Icon name="location_searching" size={32} color="#94a3b8" />
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', marginTop: 8 }}>
                    Waiting for GPS Location
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '4px 0 12px' }}>
                    Turn on location services so we can group sites by distance from you.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => gps.retry()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="my_location" size={14} />
                    <span>Retry GPS</span>
                  </button>
                </div>
              ) : gpsGroups.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  No sites to group by GPS distance.
                </div>
              ) : (
                gpsGroups.map((group) => (
                  <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: group.bg,
                        border: `1.5px solid ${group.border}`,
                        borderRadius: 8,
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name={group.icon as any} size={15} color={group.color} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: group.color }}>
                          {group.title}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          background: '#ffffff',
                          color: group.color,
                          padding: '1px 7px',
                          borderRadius: 9999,
                          border: `1px solid ${group.border}`,
                        }}
                      >
                        {group.records.length} site{group.records.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {group.records.map((r: any) => renderRecordCard(r.item, r.distanceMeters != null && r.distanceMeters <= 50))}
                  </div>
                ))
              )}
            </div>
          ) : (
            displayRecords.map((entry: any) => renderRecordCard(entry, false))
          )}
        </div>
      )}

      {/* ─── Infinite Scroll Sentinel & Realtime Loader ─── */}
      {hasMore && records.length > 0 && records.length < total && (
        <div
          ref={sentinelRef}
          style={{
            minHeight: 28,
            padding: '14px 0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {loadingMore && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                color: '#ea580c',
                fontSize: '0.8rem',
                fontWeight: 700,
                padding: '6px 14px',
                borderRadius: 20,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
              }}
            >
              <Icon name="refresh" size={16} className="spin" />
              <span>Loading more records…</span>
            </div>
          )}
        </div>
      )}
      {records.length > 0 && (!hasMore || records.length >= total) && (
        <div style={{ textAlign: 'center', padding: '14px 0 20px', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600 }}>
          Showing all {records.length} records
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
