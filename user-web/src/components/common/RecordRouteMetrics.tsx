import type { PendingRouteItem } from '../../utils/geo';
import Icon from './Icon';

export default function RecordRouteMetrics({ entry, calculating = false }: {
  entry: PendingRouteItem;
  calculating?: boolean;
}) {
  if (calculating) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#64748b', margin: '2px 0' }}>
        <Icon name="route" size={13} color="#2563eb" />
        <span>Calculating route…</span>
      </div>
    );
  }
  if (entry.routeUnavailableReason) {
    return (
      <div style={{ fontSize: '0.68rem', color: '#94a3b8', margin: '2px 0' }}>
        {entry.routeUnavailableReason}
      </div>
    );
  }
  if (!entry.currentDistanceFormatted) {
    return null;
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '2px 0 4px', flexWrap: 'wrap' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 5,
        backgroundColor: '#f0fdf4',
        border: '1px solid #bbf7d0',
        color: '#15803d',
        fontSize: '0.72rem',
        fontWeight: 700,
      }}>
        <Icon name="two_wheeler" size={13} color="#16a34a" />
        {entry.currentDistanceFormatted} • {entry.currentDurationFormatted || ''}
      </span>
    </div>
  );
}
