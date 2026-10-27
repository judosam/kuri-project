import { useState, useEffect } from 'react';
import type { TelecallerHistoryRow } from '../utils/telecallerHistory';
import {
  parseCommentHistory,
  formatHistoryToTable,
  getStatusBadgeStyle,
} from '../utils/telecallerHistory';
import { Icon } from './ui';

interface TelecallerHistoryTableProps {
  comment?: string | null;
  isEditing?: boolean;
  onChange?: (rows: TelecallerHistoryRow[], tableText: string) => void;
  maxHeight?: number | string;
}

export function TelecallerHistoryTable({
  comment,
  isEditing = false,
  onChange,
  maxHeight = 260,
}: TelecallerHistoryTableProps) {
  const [rows, setRows] = useState<TelecallerHistoryRow[]>(() => parseCommentHistory(comment));
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<TelecallerHistoryRow | null>(null);
  const [isRawView, setIsRawView] = useState(false);
  const [rawText, setRawText] = useState(() => (comment ? formatHistoryToTable(parseCommentHistory(comment)) : ''));

  useEffect(() => {
    const parsed = parseCommentHistory(comment);
    setRows(parsed);
    setRawText(formatHistoryToTable(parsed));
  }, [comment]);

  const updateRowsAndNotify = (newRows: TelecallerHistoryRow[]) => {
    setRows(newRows);
    const tbl = formatHistoryToTable(newRows);
    setRawText(tbl);
    if (onChange) {
      onChange(newRows, tbl);
    }
  };

  const handleStartEditRow = (row: TelecallerHistoryRow) => {
    setEditingRowId(row.id);
    setEditFormData({ ...row });
  };

  const handleSaveRow = () => {
    if (!editFormData) return;
    const updatedRows = rows.map((r) => (r.id === editFormData.id ? editFormData : r));
    updateRowsAndNotify(updatedRows);
    setEditingRowId(null);
    setEditFormData(null);
  };

  const handleCancelRow = () => {
    setEditingRowId(null);
    setEditFormData(null);
  };

  const handleDeleteRow = (id: string) => {
    if (!confirm('Are you sure you want to remove this log entry?')) return;
    const updatedRows = rows.filter((r) => r.id !== id);
    updateRowsAndNotify(updatedRows);
  };

  const handleAddRow = () => {
    const now = new Date();
    const tsStr = now.toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const newRow: TelecallerHistoryRow = {
      id: `new-${Date.now()}`,
      date: tsStr,
      caller: 'Telecaller',
      status: 'Connected Follow Up',
      details: 'Stage: Additional Floor Construction',
      note: 'Call notes summary...',
    };
    const updatedRows = [...rows, newRow];
    updateRowsAndNotify(updatedRows);
    setEditingRowId(newRow.id);
    setEditFormData({ ...newRow });
  };

  const handleRawTextChange = (text: string) => {
    setRawText(text);
    const parsed = parseCommentHistory(text);
    setRows(parsed);
    if (onChange) {
      onChange(parsed, text);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Table Toolbar if in Editing Mode */}
      {isEditing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontWeight: 600 }}>
            <span style={{ color: '#d97706' }}>⚠️</span>
            <span>Editing History Table ({rows.length} {rows.length === 1 ? 'row' : 'rows'})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setIsRawView(!isRawView)}
              style={{ fontSize: 10.5, height: 26, padding: '0 8px' }}
              title="Toggle Markdown Table view"
            >
              <Icon name="edit_note" size={13} />
              {isRawView ? 'Switch to Table Grid' : 'Raw Table Format'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleAddRow}
              style={{ fontSize: 10.5, height: 26, padding: '0 8px', background: '#0284c7', borderColor: '#0284c7' }}
            >
              <Icon name="add" size={13} /> Add Row
            </button>
          </div>
        </div>
      )}

      {/* Raw Table Mode */}
      {isEditing && isRawView ? (
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
            Markdown Table format (pipes <code>|</code> separate columns):
          </div>
          <textarea
            className="fld"
            rows={5}
            value={rawText}
            onChange={(e) => handleRawTextChange(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11.5, borderRadius: 6, background: '#f8fafc' }}
          />
        </div>
      ) : (
        /* Structured Table Grid */
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#ffffff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          }}
        >
          {rows.length === 0 ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: 12,
                fontStyle: 'italic',
                background: '#f8fafc',
              }}
            >
              No prior call logs or follow-up notes recorded yet.
            </div>
          ) : (
            <div style={{ maxHeight, overflowY: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#f8fafc',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#475569',
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    <th style={{ padding: '8px 10px', width: 32, textAlign: 'center' }}>#</th>
                    <th style={{ padding: '8px 10px', width: 135 }}>Date & Time</th>
                    <th style={{ padding: '8px 10px', width: 115 }}>Caller</th>
                    <th style={{ padding: '8px 10px', width: 135 }}>Call Status</th>
                    <th style={{ padding: '8px 10px', width: 140 }}>Stage / Details</th>
                    <th style={{ padding: '8px 10px' }}>Notes / Conversation Summary</th>
                    {isEditing && (
                      <th style={{ padding: '8px 10px', width: 85, textAlign: 'center' }}>Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const isRowEditing = editingRowId === row.id && editFormData;
                    const badge = getStatusBadgeStyle(row.status);

                    if (isRowEditing) {
                      return (
                        <tr
                          key={row.id}
                          style={{
                            background: '#fefce8',
                            borderBottom: '1px solid #fef08a',
                          }}
                        >
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              className="fld"
                              value={editFormData.date}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, date: e.target.value })
                              }
                              style={{ width: '100%', height: 28, fontSize: 11 }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              className="fld"
                              value={editFormData.caller}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, caller: e.target.value })
                              }
                              style={{ width: '100%', height: 28, fontSize: 11 }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              className="fld"
                              value={editFormData.status}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, status: e.target.value })
                              }
                              style={{ width: '100%', height: 28, fontSize: 11 }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              className="fld"
                              value={editFormData.details}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, details: e.target.value })
                              }
                              style={{ width: '100%', height: 28, fontSize: 11 }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <textarea
                              className="fld"
                              rows={2}
                              value={editFormData.note}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, note: e.target.value })
                              }
                              style={{ width: '100%', fontSize: 11, resize: 'vertical' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-xs"
                                onClick={handleSaveRow}
                                title="Save Row"
                                style={{ height: 24, padding: '0 6px', background: '#059669', borderColor: '#059669' }}
                              >
                                <Icon name="check" size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={handleCancelRow}
                                title="Cancel"
                                style={{ height: 24, padding: '0 6px' }}
                              >
                                <Icon name="close" size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr
                        key={row.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                        }}
                      >
                        <td
                          style={{
                            padding: '8px 10px',
                            textAlign: 'center',
                            color: '#94a3b8',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#1e293b', whiteSpace: 'nowrap', fontWeight: 500 }}>
                          {row.date}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 600 }}>
                          {row.caller}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontSize: 10.5,
                              fontWeight: 600,
                              background: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569', fontSize: 11.5 }}>
                          {row.details}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            color: '#1e293b',
                            lineHeight: 1.45,
                            wordBreak: 'break-word',
                          }}
                        >
                          {row.note}
                        </td>
                        {isEditing && (
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => handleStartEditRow(row)}
                                title="Edit this row"
                                style={{ height: 24, padding: '0 6px', color: '#0284c7' }}
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => handleDeleteRow(row.id)}
                                title="Delete this row"
                                style={{ height: 24, padding: '0 6px', color: '#dc2626' }}
                              >
                                <Icon name="delete" size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
