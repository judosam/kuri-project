import React, { useState, useRef } from 'react';
import { Icon } from './ui';
import axios from 'axios';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkEditModal({ isOpen, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated_count: number; not_found_count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDownloadTemplate = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/admin/records/bulk-edit/template', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'bulk_edit_leads_template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setError('Failed to download bulk edit template');
    }
  };

  const handleDownloadNewLeadsTemplate = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/admin/records/template', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'task_dispatch_template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setError('Failed to download new leads template');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select an Excel (.xlsx) file to upload');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);

      const resp = await axios.post('/api/admin/records/bulk-edit', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setResult({
        updated_count: resp.data.updated_count,
        not_found_count: resp.data.not_found_count,
      });

      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to bulk edit leads');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fos-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="fos-modal-card" style={{ maxWidth: 540, width: '95%' }} onClick={(e) => e.stopPropagation()}>
        <div className="fos-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', padding: 8, borderRadius: 8, background: '#f1f5f9', color: '#0f172a' }}>
              <Icon name="edit_document" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Bulk Edit Current Leads</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>Update existing leads in bulk via Excel</div>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: '#f0fdf4', color: '#15803d', fontSize: 13, marginBottom: 14 }}>
              <strong>✓ Success!</strong> {result.updated_count} lead(s) updated successfully.
              {result.not_found_count > 0 && <span> ({result.not_found_count} leads not found by Unique ID)</span>}
            </div>
          )}

          {/* Template Download Section */}
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Step 1: Download Template</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              Use the official bulk-edit template with `unique_id` to update matching records:
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDownloadTemplate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Icon name="download" size={14} />
                <span>Bulk Edit Template</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDownloadNewLeadsTemplate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Icon name="download" size={14} />
                <span>New Leads Template</span>
              </button>
            </div>
          </div>

          {/* File Picker Section */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 6 }}>
              Step 2: Upload Filled Excel (.xlsx)
            </label>
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xlsm"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                  setError(null);
                }
              }}
              style={{ display: 'none' }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #cbd5e1',
                borderRadius: 8,
                padding: '24px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                background: file ? '#f8fafc' : '#ffffff',
              }}
            >
              <Icon name="upload_file" size={28} style={{ color: "#64748b" }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginTop: 6 }}>
                {file ? file.name : 'Click to select Excel file'}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Supports .xlsx up to 25MB</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={uploading || !file}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {uploading ? (
                <>
                  <Icon name="sync" size={16} className="spin" />
                  <span>Updating Leads…</span>
                </>
              ) : (
                <span>Upload & Apply Updates</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
