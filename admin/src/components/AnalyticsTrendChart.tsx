import { useState } from 'react';
import type { DashboardTrendPoint } from '../types';

interface AnalyticsTrendChartProps {
  trends?: DashboardTrendPoint[];
  title?: string;
  subtitle?: string;
  calloutValue?: string;
}

// Generate smooth cubic bezier SVG path from points
function getSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

export default function AnalyticsTrendChart({
  trends = [],
  title = 'Operational Velocity & Inspection Volume',
  subtitle = 'Daily field verification completions vs dispatched workload assignments (Asia/Kolkata)',
  calloutValue,
}: AnalyticsTrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!trends || trends.length === 0) {
    return (
      <div className="card trend-chart-card empty-chart">
        <p>No activity trends recorded for this period.</p>
      </div>
    );
  }

  // Chart Dimensions
  const width = 800;
  const height = 240;
  const padLeft = 45;
  const padRight = 25;
  const padTop = 25;
  const padBottom = 35;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  // Max value calculation strictly from operational metrics (completed visits and assigned tasks)
  const maxVal = Math.max(
    10,
    ...trends.map((t) => Math.max(t.completed || 0, t.assigned || 0))
  );
  // Round up to nice number
  const yMax = Math.ceil(maxVal * 1.15);

  const totalCompleted = trends.reduce((sum, t) => sum + (t.completed || 0), 0);
  const totalAssigned = trends.reduce((sum, t) => sum + (t.assigned || 0), 0);

  // Compute points
  const stepX = innerW / Math.max(1, trends.length - 1);
  const pointsCompleted = trends.map((t, idx) => ({
    x: padLeft + idx * stepX,
    y: padTop + innerH - (t.completed / yMax) * innerH,
  }));
  const pointsAssigned = trends.map((t, idx) => ({
    x: padLeft + idx * stepX,
    y: padTop + innerH - (t.assigned / yMax) * innerH,
  }));

  const pathCompleted = getSmoothPath(pointsCompleted);
  const areaCompleted = `${pathCompleted} L ${pointsCompleted[pointsCompleted.length - 1].x} ${padTop + innerH} L ${pointsCompleted[0].x} ${padTop + innerH} Z`;

  const pathAssigned = getSmoothPath(pointsAssigned);
  const areaAssigned = `${pathAssigned} L ${pointsAssigned[pointsAssigned.length - 1].x} ${padTop + innerH} L ${pointsAssigned[0].x} ${padTop + innerH} Z`;

  // Y-axis grid ticks
  const yTicks = [0, Math.round(yMax / 3), Math.round((yMax * 2) / 3), yMax];

  const activePoint = hoverIndex !== null ? trends[hoverIndex] : null;

  return (
    <div className="card trend-chart-card">
      <div className="trend-chart-header">
        <div>
          <div className="trend-chart-callout">
            <span className="trend-callout-number">{calloutValue || totalCompleted.toLocaleString()}</span>
            <span className="trend-callout-label">verifications completed</span>
          </div>
          <h3 className="trend-chart-title">{title}</h3>
          <p className="trend-chart-subtitle">{subtitle}</p>
        </div>

        <div className="trend-chart-legend">
          <div className="trend-legend-item">
            <span className="legend-line line-green" />
            <span>Completed ({totalCompleted})</span>
          </div>
          <div className="trend-legend-item">
            <span className="legend-line line-blue" />
            <span>Assigned ({totalAssigned})</span>
          </div>
        </div>
      </div>

      <div className="trend-chart-svg-container" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="trend-chart-svg"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="grad-green" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
              <stop offset="85%" stopColor="#10b981" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="grad-blue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.30" />
              <stop offset="85%" stopColor="#2563eb" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {yTicks.map((tickVal) => {
            const y = padTop + innerH - (tickVal / yMax) * innerH;
            return (
              <g key={tickVal} className="trend-grid-row">
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + innerW}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="inherit"
                  fontWeight="500"
                >
                  {tickVal}
                </text>
              </g>
            );
          })}

          {/* Shaded Areas */}
          <path d={areaAssigned} fill="url(#grad-blue)" />
          <path d={areaCompleted} fill="url(#grad-green)" />

          {/* Smooth Curves */}
          <path
            d={pathAssigned}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={pathCompleted}
            fill="none"
            stroke="#10b981"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {pointsCompleted.map((pt, i) => (
            <circle
              key={`comp-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={hoverIndex === i ? 5 : 3}
              fill="#ffffff"
              stroke="#10b981"
              strokeWidth="2.2"
              style={{ transition: 'all 0.15s ease' }}
            />
          ))}

          {pointsAssigned.map((pt, i) => (
            <circle
              key={`assign-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={hoverIndex === i ? 5 : 3}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth="2.2"
              style={{ transition: 'all 0.15s ease' }}
            />
          ))}

          {/* Hover Overlay Columns */}
          {trends.map((t, i) => {
            const x = padLeft + i * stepX;
            return (
              <rect
                key={`hit-${t.date}`}
                x={x - stepX / 2}
                y={padTop}
                width={stepX}
                height={innerH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverIndex(i)}
              />
            );
          })}

          {/* Hover Vertical Line */}
          {hoverIndex !== null && (
            <line
              x1={padLeft + hoverIndex * stepX}
              y1={padTop}
              x2={padLeft + hoverIndex * stepX}
              y2={padTop + innerH}
              stroke="#64748b"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}

          {/* X-axis Labels */}
          {trends.map((t, idx) => {
            const x = padLeft + idx * stepX;
            const isHovered = hoverIndex === idx;
            return (
              <text
                key={t.date}
                x={x}
                y={padTop + innerH + 18}
                textAnchor="middle"
                fill={isHovered ? '#0f172a' : '#64748b'}
                fontSize="10.5"
                fontWeight={isHovered ? '700' : '500'}
                fontFamily="inherit"
              >
                {t.label}
              </text>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {hoverIndex !== null && activePoint && (
          <div
            className="trend-chart-tooltip"
            style={{
              position: 'absolute',
              left: `${((padLeft + hoverIndex * stepX) / width) * 100}%`,
              top: 10,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div className="tooltip-date">{activePoint.label}</div>
            <div className="tooltip-row text-green">
              <span>Completed Visits:</span>
              <strong>{activePoint.completed}</strong>
            </div>
            <div className="tooltip-row text-blue">
              <span>Assigned Tasks:</span>
              <strong>{activePoint.assigned}</strong>
            </div>
            {activePoint.confirmed !== undefined && (
              <div className="tooltip-row" style={{ color: '#059669' }}>
                <span>Confirmed Construction:</span>
                <strong>{activePoint.confirmed}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
