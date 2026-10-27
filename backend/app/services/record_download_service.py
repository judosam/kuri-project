"""Portable full-record archive: readable report, exact data, and photo files."""
import html
import io
import json
import zipfile
from pathlib import Path

from app.services.local_storage_service import LocalStorageService
from app.services.google_drive_service import GoogleDriveService


def build_record_archive(record, detail: dict) -> bytes:
    storage = LocalStorageService()
    output = io.BytesIO()
    photo_sections = []
    warnings = []
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for photo in record.images:
            filename = f'photos/Record_{record.id}_Photo_{photo.photo_order}_{photo.id}.jpg'
            key = photo.google_drive_file_id
            path = storage.get_file_path(key) if not key.startswith(('pending:', 'simulated-')) else None
            path = path or storage.get_file_path(f'{record.user_id}/{record.id}/{photo.file_name}')
            content = Path(path).read_bytes() if path else None
            if content is None and not any(x in key for x in ('/', '\\', ':')) and not key.startswith('simulated-'):
                try:
                    drive = GoogleDriveService()
                    if drive.service:
                        content = drive.service.files().get_media(fileId=key).execute()
                except Exception:
                    pass
            if content is not None:
                archive.writestr(filename, content)
                photo_sections.append(f'<figure><img src="{filename}" alt="Photo {photo.photo_order}"><figcaption>Photo {photo.photo_order} · {html.escape(getattr(photo, "source", "camera"))} · {html.escape(str(photo.captured_at))} UTC</figcaption></figure>')
            else:
                warnings.append(f'Photo {photo.photo_order}: file unavailable')
        detail['download_warnings'] = warnings
        archive.writestr('record.json', json.dumps(detail, ensure_ascii=False, indent=2))
        rows = ''.join(f'<tr><th>{html.escape(key.replace("_", " ").title())}</th><td>{html.escape(str(value)) if value is not None else "—"}</td></tr>' for key, value in detail.items() if key not in ('images', 'download_warnings'))
        metadata = html.escape(json.dumps(detail.get('images', []), ensure_ascii=False, indent=2))
        report = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Record {record.id}</title>
<style>body{{font:16px system-ui;margin:32px auto;max-width:1100px;padding:0 20px;color:#172033}}table{{border-collapse:collapse;width:100%}}th,td{{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}}th{{width:32%}}img{{max-width:100%;max-height:750px}}figure{{margin:24px 0}}pre{{white-space:pre-wrap}}@media print{{button{{display:none}}}}</style>
<h1>{html.escape(record.name)} · Record {record.id}</h1><button onclick="window.print()">Print / Save as PDF</button>
<table>{rows}</table><h2>Photos</h2>{''.join(photo_sections) or '<p>No available photos.</p>'}
<p>{html.escape('; '.join(warnings))}</p><h2>Photo metadata</h2><pre>{metadata}</pre></html>'''
        archive.writestr('record.html', report)
    return output.getvalue()
