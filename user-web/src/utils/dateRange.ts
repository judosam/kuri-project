export type CaptureRange = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
export function captureRange(range: CaptureRange, start = '', end = '') {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (range === 'ALL') return {};
  if (range === 'TODAY') start = end = today;
  if (range === 'YESTERDAY') { date.setUTCDate(date.getUTCDate() - 1); start = end = iso(date); }
  if (range === 'THIS_WEEK') { date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); start = iso(date); end = today; }
  if (range === 'THIS_MONTH') { start = `${today.slice(0, 7)}-01`; end = today; }
  return { dateFrom: start ? `${start}T00:00:00+05:30` : undefined, dateTo: end ? `${end}T23:59:59.999+05:30` : undefined };
}
