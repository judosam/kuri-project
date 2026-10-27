import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict


def parse_comment_to_rows(comment: Optional[str]) -> List[Dict[str, str]]:
    """
    Parses a telecaller comment string into structured table rows.
    Handles:
      1. Markdown tables (| Date & Time | Caller | ... |)
      2. Legacy bracketed paragraph logs ([26 Oct 2026, 01:19 PM - Ajithkumar M (...)])
      3. Plain text legacy notes (e.g. 'RNR', 'Wrong number')
    """
    if not comment or not comment.strip():
        return []

    comment = comment.strip()

    # 1. Check if Markdown table format
    if '|' in comment and any(k in comment.lower() for k in ['date', 'time', 'status', 'caller', '---']):
        lines = [l.strip() for l in comment.split('\n') if l.strip()]
        rows: List[Dict[str, str]] = []
        is_header = True
        for l in lines:
            if not l.startswith('|'):
                continue
            # Skip separator line like |:---|:---|
            if re.match(r'^\|[\s\-:|]+\|$', l):
                is_header = False
                continue
            cells = [c.strip() for c in l.split('|')[1:-1]]
            if len(cells) >= 3:
                # Check if header row
                if is_header and any(h in cells[0].lower() for h in ['date', 'time', '#']):
                    is_header = False
                    continue
                date_val = cells[0] if len(cells) > 0 else '—'
                caller_val = cells[1] if len(cells) > 1 else '—'
                status_val = cells[2] if len(cells) > 2 else '—'
                details_val = cells[3] if len(cells) > 3 else '—'
                note_val = cells[4] if len(cells) > 4 else (' | '.join(cells[3:]) if len(cells) > 3 else '—')
                # Unescape <br> or <br/> back to newline
                note_val = note_val.replace('<br>', '\n').replace('<br/>', '\n')
                rows.append({
                    'date': date_val or '—',
                    'caller': caller_val or '—',
                    'status': status_val or '—',
                    'details': details_val or '—',
                    'note': note_val or '—'
                })
        if rows:
            return rows

    # 2. Legacy paragraph format: [Date, Time - Caller (Status | Meta)]\nNote
    entries = re.split(r'\n\s*\n', comment)
    rows: List[Dict[str, str]] = []
    header_pattern = re.compile(
        r'^\[(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{1,2}:\d{2}\s+[APMapm]{2})\s*-\s*([^(]+?)(?:\s*\((.*?)\))?\](.*)',
        re.DOTALL
    )

    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        m = header_pattern.match(entry)
        if m:
            date_time = m.group(1).strip()
            caller = m.group(2).strip()
            meta_str = m.group(3) or ''
            rest = m.group(4).strip()
            meta_parts = [p.strip() for p in meta_str.split('|') if p.strip()]
            status = meta_parts[0] if len(meta_parts) > 0 else 'Call Logged'
            details = ' | '.join(meta_parts[1:]) if len(meta_parts) > 1 else '—'
            rows.append({
                'date': date_time,
                'caller': caller,
                'status': status,
                'details': details,
                'note': rest or '—'
            })
        else:
            lines = entry.split('\n', 1)
            first_line = lines[0].strip()
            rest = lines[1].strip() if len(lines) > 1 else ''
            m2 = re.match(
                r'^\[(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{1,2}:\d{2}\s+[APMapm]{2})\s*-\s*([^(]+?)(?:\s*\((.*?)\))?\]',
                first_line
            )
            if m2:
                date_time = m2.group(1).strip()
                caller = m2.group(2).strip()
                meta_str = m2.group(3) or ''
                meta_parts = [p.strip() for p in meta_str.split('|') if p.strip()]
                status = meta_parts[0] if len(meta_parts) > 0 else 'Call Logged'
                details = ' | '.join(meta_parts[1:]) if len(meta_parts) > 1 else '—'
                rows.append({
                    'date': date_time,
                    'caller': caller,
                    'status': status,
                    'details': details,
                    'note': rest or '—'
                })
            else:
                rows.append({
                    'date': '—',
                    'caller': 'Telecaller',
                    'status': 'Note',
                    'details': '—',
                    'note': entry
                })

    return rows


def format_rows_to_table(rows: List[Dict[str, str]]) -> str:
    """
    Serializes a list of row dicts into a standard Markdown table format.
    """
    if not rows:
        return ''

    header = '| Date & Time | Caller | Call Status | Stage / Details | Notes / Discussion |\n| :--- | :--- | :--- | :--- | :--- |'
    lines = [header]

    for r in rows:
        date = (r.get('date') or '—').replace('|', '-').strip()
        caller = (r.get('caller') or '—').replace('|', '-').strip()
        status = (r.get('status') or '—').replace('|', '-').strip()
        details = (r.get('details') or '—').replace('|', '-').strip()
        note = (r.get('note') or '—').replace('|', '/').replace('\n', '<br>').strip()
        lines.append(f'| {date} | {caller} | {status} | {details} | {note} |')

    return '\n'.join(lines)


def append_call_log_entry(
    existing_comment: Optional[str],
    caller_name: str,
    status: str,
    details: str = '—',
    note: str = '',
    timestamp_str: Optional[str] = None
) -> str:
    """
    Appends a new call log entry to the existing comment in table format.
    """
    rows = parse_comment_to_rows(existing_comment)

    if not timestamp_str:
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        timestamp_str = datetime.now(ist_tz).strftime("%d %b %Y, %I:%M %p")

    new_row = {
        'date': timestamp_str,
        'caller': caller_name or 'Telecaller',
        'status': status or 'Call Logged',
        'details': details or '—',
        'note': note.strip() if note else '—'
    }

    # Avoid duplicate exact consecutive row
    if rows and rows[-1] == new_row:
        return format_rows_to_table(rows)

    rows.append(new_row)
    return format_rows_to_table(rows)


def normalize_to_table(comment: Optional[str]) -> Optional[str]:
    """
    Normalizes any comment format to standard Markdown table format.
    """
    if not comment or not comment.strip():
        return None
    rows = parse_comment_to_rows(comment)
    if not rows:
        return None
    return format_rows_to_table(rows)
