export interface TelecallerHistoryRow {
  id: string;
  date: string;
  caller: string;
  status: string;
  details: string;
  note: string;
}

export function parseCommentHistory(comment?: string | null): TelecallerHistoryRow[] {
  if (!comment || !comment.trim()) return [];

  const trimmed = comment.trim();

  // 1. Check if Markdown table format
  if (trimmed.includes('|') && /date|time|status|caller|---/i.test(trimmed)) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows: TelecallerHistoryRow[] = [];
    let isHeader = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) continue;
      // Skip delimiter row like |:---|:---|
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        isHeader = false;
        continue;
      }
      const rawCells = line.split('|').slice(1, -1);
      const cells = rawCells.map((c) => c.trim());
      if (cells.length >= 3) {
        // Skip header row if it contains Date or Time
        if (isHeader && /date|time|#/i.test(cells[0])) {
          isHeader = false;
          continue;
        }
        const dateVal = cells[0] || '—';
        const callerVal = cells[1] || '—';
        const statusVal = cells[2] || '—';
        const detailsVal = cells[3] || '—';
        let noteVal = cells.length > 4 ? cells[4] : cells.slice(3).join(' | ');
        noteVal = (noteVal || '—').replace(/<br\s*\/?>/gi, '\n');

        rows.push({
          id: `row-${rows.length + 1}-${Date.now()}`,
          date: dateVal,
          caller: callerVal,
          status: statusVal,
          details: detailsVal,
          note: noteVal,
        });
      }
    }
    if (rows.length > 0) {
      return rows;
    }
  }

  // 2. Legacy bracketed paragraph format: [Date, Time - Caller (Status | Meta)]\nNote
  const entries = trimmed.split(/\n\s*\n+/).map((e) => e.trim()).filter(Boolean);
  const rows: TelecallerHistoryRow[] = [];
  const headerPattern = /^\[(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{1,2}:\d{2}\s+[APMapm]{2})\s*-\s*([^(]+?)(?:\s*\((.*?)\))?\](.*)/s;

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const match = entry.match(headerPattern);
    if (match) {
      const dateTime = match[1]?.trim() || '—';
      const caller = match[2]?.trim() || '—';
      const metaStr = match[3]?.trim() || '';
      const note = match[4]?.trim() || '—';
      const metaParts = metaStr.split('|').map((p) => p.trim()).filter(Boolean);
      const status = metaParts[0] || 'Call Logged';
      const details = metaParts.length > 1 ? metaParts.slice(1).join(' | ') : '—';

      rows.push({
        id: `legacy-${idx + 1}-${Date.now()}`,
        date: dateTime,
        caller,
        status,
        details,
        note,
      });
    } else {
      // Check first line
      const lines = entry.split('\n');
      const firstLine = lines[0].trim();
      const rest = lines.slice(1).join('\n').trim();
      const firstLineMatch = firstLine.match(
        /^\[(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{1,2}:\d{2}\s+[APMapm]{2})\s*-\s*([^(]+?)(?:\s*\((.*?)\))?\]/
      );
      if (firstLineMatch) {
        const dateTime = firstLineMatch[1]?.trim() || '—';
        const caller = firstLineMatch[2]?.trim() || '—';
        const metaStr = firstLineMatch[3]?.trim() || '';
        const metaParts = metaStr.split('|').map((p) => p.trim()).filter(Boolean);
        const status = metaParts[0] || 'Call Logged';
        const details = metaParts.length > 1 ? metaParts.slice(1).join(' | ') : '—';

        rows.push({
          id: `legacy-${idx + 1}-${Date.now()}`,
          date: dateTime,
          caller,
          status,
          details,
          note: rest || '—',
        });
      } else {
        rows.push({
          id: `note-${idx + 1}-${Date.now()}`,
          date: '—',
          caller: 'Telecaller',
          status: 'Note',
          details: '—',
          note: entry,
        });
      }
    }
  }

  return rows;
}

export function formatHistoryToTable(rows: TelecallerHistoryRow[]): string {
  if (!rows || rows.length === 0) return '';

  const header = '| Date & Time | Caller | Call Status | Stage / Details | Notes / Discussion |\n| :--- | :--- | :--- | :--- | :--- |';
  const lines = [header];

  for (const r of rows) {
    const date = (r.date || '—').replace(/\|/g, '-').trim();
    const caller = (r.caller || '—').replace(/\|/g, '-').trim();
    const status = (r.status || '—').replace(/\|/g, '-').trim();
    const details = (r.details || '—').replace(/\|/g, '-').trim();
    const note = (r.note || '—').replace(/\|/g, '/').replace(/\n/g, '<br>').trim();
    lines.push(`| ${date} | ${caller} | ${status} | ${details} | ${note} |`);
  }

  return lines.join('\n');
}

export function getLatestCommentSummary(comment?: string | null): string {
  if (!comment || !comment.trim()) return '';
  const rows = parseCommentHistory(comment);
  if (rows.length === 0) return comment.trim();
  const latest = rows[rows.length - 1];
  const parts: string[] = [];
  if (latest.status && latest.status !== '—' && latest.status !== 'Note') {
    parts.push(`[${latest.status}]`);
  }
  if (latest.note && latest.note !== '—') {
    parts.push(latest.note);
  } else if (latest.details && latest.details !== '—') {
    parts.push(latest.details);
  }
  return parts.join(' ') || comment.trim();
}

export function getStatusBadgeStyle(status?: string): { bg: string; color: string; border: string } {
  const s = (status || '').toUpperCase();
  if (s.includes('CONFIRMED')) {
    return { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' };
  }
  if (s.includes('CONNECTED') || s.includes('FOLLOW')) {
    return { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' };
  }
  if (s.includes('BUSY') || s.includes('DISCONNECTED')) {
    return { bg: '#fffbeb', color: '#92400e', border: '#fde68a' };
  }
  if (s.includes('NOT REACHABLE') || s.includes('REACHABLE')) {
    return { bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' };
  }
  if (s.includes('WRONG')) {
    return { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
  }
  if (s.includes('NOT INTERESTED') || s.includes('REFUSED')) {
    return { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
  }
  return { bg: '#f8fafc', color: '#334155', border: '#e2e8f0' };
}
