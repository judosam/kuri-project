import { useState } from 'react';
import './DailyActivityChart.css';

export interface ActivityDay { date: string; completed: number; pending: number; construction_yes: number }
export default function DailyActivityChart({ days = [], dateBasis = 'captured' }: { days?: ActivityDay[]; dateBasis?: 'captured' | 'assigned' }) {
  const [mode, setMode] = useState<'inspections' | 'construction'>('inspections');
  const value = (day: ActivityDay) => mode === 'construction' ? day.construction_yes : day.completed + day.pending;
  const maximum = Math.max(1, ...days.map(value));
  const total = days.reduce((sum, day) => sum + value(day), 0);
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return <section className="daily-chart" aria-label="Day-wise activity">
    <div className="daily-chart-head">
      <div><h2>Day-wise activity</h2><p>By {dateBasis === 'assigned' ? 'assigned' : 'capture'} date, India time{days.length ? ` · ${dateLabel(days[0].date)} – ${dateLabel(days[days.length-1].date)}` : ''}</p></div>
      <div className="daily-chart-switch" role="group" aria-label="Chart metric">
        <button type="button" aria-pressed={mode === 'inspections'} onClick={() => setMode('inspections')}>Inspections</button>
        <button type="button" aria-pressed={mode === 'construction'} onClick={() => setMode('construction')}>Construction: Yes</button>
      </div>
    </div>
    <div className="daily-chart-summary"><strong>{total.toLocaleString()}</strong><span>{mode === 'construction' ? 'records with construction' : dateBasis === 'assigned' ? 'assigned records' : 'record captures'} in chart period</span>
      <div className="daily-chart-legend">{mode === 'inspections' ? <><span><i className="daily-done" />Completed</span><span><i className="daily-pending" />Pending</span></> : <span><i className="daily-construction" />Construction: Yes</span>}</div>
    </div>
    {days.length > 0 ? <div className="daily-chart-scroll"><div className="daily-chart-plot" style={{ minWidth: Math.max(280, days.length * 48) }}>
      <div className="daily-chart-grid" aria-hidden="true"><span>{maximum}</span><span>{Math.round(maximum / 2)}</span><span>0</span></div>
      <div className="daily-chart-columns">{days.map(day => <div key={day.date} className="daily-chart-column" aria-label={`${day.date}: ${day.completed} completed, ${day.pending} pending, ${day.construction_yes} construction yes`}>
        <div className="daily-chart-bar-area"><div className="daily-chart-stack" style={{ height: `${value(day) / maximum * 100}%` }} title={`${dateLabel(day.date)}: ${value(day)}`}>
          <span className="daily-chart-value">{value(day)}</span>
          {mode === 'construction' ? <div className="daily-construction" style={{ flex: 1 }} /> : <><div className="daily-pending" style={{ flex: day.pending }} /><div className="daily-done" style={{ flex: day.completed }} /></>}
        </div></div>
        <span className="daily-chart-date">{dateLabel(day.date)}</span>
      </div>)}</div>
    </div></div> : <p className="daily-chart-empty">No dates in this range.</p>}
    {total === 0 && days.length > 0 && <p className="daily-chart-empty">No matching records in this period.</p>}
    <p className="daily-chart-foot">All time shows the latest 7 days. Selected date ranges show up to 31 days.</p>
  </section>;
}
