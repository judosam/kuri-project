import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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

    setUploading(true);
    setError(null);
    setResult(null);

    try {
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

  return createPortal(
    <div
      className="fos-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fos-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', padding: 8, borderRadius: 8, background: '#f1f5f9', color: '#0f172a' }}>
              <Icon name="edit_note" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Bulk Edit Current Leads</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>Update existing leads in bulk via Excel</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20, overflowY: 'auto' }}>
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
                className="btn btn-ghost btn-sm"
                onClick={handleDownloadNewLeadsTemplate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#64748b' }}
                title="Download standard blank template for dispatching new leads"
              >
                <Icon name="download" size={14} />
                <span>New Leads Template</span>
              </button>
            </div>
          </div>

          {/* File Upload Section */}
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Step 2: Upload Filled Excel</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              Upload your Excel file (.xlsx) with edited values. Leads will be matched and updated by their <strong>unique_id</strong>.
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                  setError(null);
                }
              }}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Icon name="upload" size={14} />
                <span>{file ? 'Change File' : 'Choose File'}</span>
              </button>
              <span style={{ fontSize: 12, color: file ? '#0f172a' : '#94a3b8', fontWeight: file ? 600 : 400 }}>
                {file ? file.name : 'No file chosen'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!file || uploading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 120, justifyContent: 'center' }}
            >
              {uploading ? (
                <>
                  <Icon name="refresh" size={16} className="spin" />
                  <span>Updating...</span>
                </>
              ) : (
                <>
                  <Icon name="cloud_done" size={16} />
                  <span>Update Leads</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
