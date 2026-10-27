import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
  className?: string;
}

export default function Skeleton({
  width = '100%',
  height = '20px',
  borderRadius = '8px',
  style,
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-pulse ${className}`}
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: '#e2e8f0',
        ...style,
      }}
    />
  );
}

export function RecordCardSkeleton() {
  return (
    <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <Skeleton width="56px" height="56px" borderRadius="14px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skeleton width="60%" height="18px" />
            <Skeleton width="70px" height="18px" borderRadius="999px" />
          </div>
          <Skeleton width="40%" height="12px" />
          <Skeleton width="80%" height="14px" />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
        <Skeleton width="100px" height="14px" />
        <Skeleton width="60px" height="14px" />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="stat-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <Skeleton width="45%" height="14px" />
        <Skeleton width="34px" height="34px" borderRadius="10px" />
      </div>
      <Skeleton width="60%" height="28px" style={{ marginBottom: '10px' }} />
      <Skeleton width="80%" height="12px" />
    </div>
  );
}
