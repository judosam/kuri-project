import { useEffect, useState } from 'react';
import type { AuditStatus, CaptureRecord } from '../types';
import { recordsApi } from '../services/api';
import { formatDateTime } from './ui';
export default function AdminDecisionPanel({ record, onSaved }: { record: CaptureRecord; onSaved: (record: CaptureRecord) => void }) {
  const [decision, setDecision] = useState<AuditStatus>(record.audit_status || 'PENDING');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { setDecision(record.audit_status || 'PENDING'); setNotice(''); }, [record.id, record.audit_status]);
  const save = async () => {
    setBusy(true); setNotice('');
    try { onSaved(await recordsApi.audit(record.id, decision, null)); setNotice('Admin decision saved.'); }
    catch { setNotice('Could not save the decision. Please retry.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-decision-panel" aria-label="Admin decision"><h3>Admin decision</h3>
    <p>QC: {record.qc_completed_at || [record.qc_vhr_comment, record.qc_street_details, record.qc_builder_contact].some(value => !!value?.trim()) ? 'Done' : 'Pending'}{record.qc_by_name ? ` · ${record.qc_by_name}` : ''}{record.qc_completed_at ? ` · ${formatDateTime(record.qc_completed_at)}` : ''}</p>
    <label className="field-label" htmlFor="admin-final-decision">Audit Decision</label>
    <select id="admin-final-decision" className="fld" value={decision} onChange={event => setDecision(event.target.value as AuditStatus)}>
      <option value="PENDING">Pending</option><option value="APPROVAL">Approval</option><option value="DISAPPROVAL">Disapproval</option><option value="COMMERCIAL_PROPERTY">Commercial Property</option><option value="RE_AUDITED">Re Audited</option>
    </select>
    <div className="admin-decision-actions"><span role="status">{notice}</span><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save decision'}</button></div>
  </section>;
}
