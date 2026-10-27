import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export interface VillageOption {
  name: string;
  count?: number;
}

interface VillageMultiSelectProps {
  selected: string[];
  onChange: (villages: string[]) => void;
  options: VillageOption[];
  disabled?: boolean;
}

export default function VillageMultiSelect({
  selected,
  onChange,
  options,
  disabled = false,
}: VillageMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>(selected);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync draft when opened
  useEffect(() => {
    if (isOpen) {
      setDraft(selected);
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, selected]);

  const normalizedOptions = useMemo(() => {
    const map = new Map<string, VillageOption>();
    for (const opt of options) {
      const norm = opt.name.replace(/\s+/g, ' ').trim();
      if (!norm) continue;
      if (map.has(norm)) {
        const existing = map.get(norm)!;
        existing.count = (existing.count || 0) + (opt.count || 0);
      } else {
        map.set(norm, { name: norm, count: opt.count });
      }
    }
    return Array.from(map.values());
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return normalizedOptions;
    const q = search.toLowerCase().trim();
    return normalizedOptions.filter((o) => o.name.toLowerCase().includes(q));
  }, [normalizedOptions, search]);

  const toggleVillage = (name: string) => {
    setDraft((prev) =>
      prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]
    );
  };

  const handleSelectAll = () => {
    const allNames = filteredOptions.map((o) => o.name);
    setDraft((prev) => Array.from(new Set([...prev, ...allNames])));
  };

  const handleClearAll = () => {
    if (search.trim()) {
      const visibleNames = new Set(filteredOptions.map((o) => o.name));
      setDraft((prev) => prev.filter((name) => !visibleNames.has(name)));
    } else {
      setDraft([]);
    }
  };

  const handleApply = () => {
    onChange(draft);
    setIsOpen(false);
  };

  const totalTasksInSelection = useMemo(() => {
    if (!selected.length) return 0;
    const selSet = new Set(selected);
    return normalizedOptions.filter((o) => selSet.has(o.name)).reduce((sum, o) => sum + (o.count || 0), 0);
  }, [selected, normalizedOptions]);

  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return 'All villages';
    if (selected.length === 1) {
      const match = normalizedOptions.find((o) => o.name === selected[0]);
      return match?.count != null ? `${selected[0]} (${match.count})` : selected[0];
    }
    return `${selected.length} villages (${totalTasksInSelection})`;
  }, [selected, normalizedOptions, totalTasksInSelection]);

  return (
    <div className="village-select-wrapper" style={{ minWidth: 0, width: '100%' }}>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 12,
          color: '#475569',
          fontWeight: 600,
          minWidth: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Village</span>
          {selected.length > 0 && (
            <span
              style={{
                fontSize: '0.68rem',
                color: '#FF6467',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              title="Reset village selection"
            >
              Clear
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          className="village-select-trigger"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          style={{
            width: '100%',
            minWidth: 0,
            height: 34,
            padding: '0 8px 0 10px',
            border: selected.length > 0 ? '1.5px solid #FF6467' : '1px solid var(--border-line)',
            borderRadius: 10,
            color: selected.length > 0 ? '#0f172a' : '#64748b',
            background: selected.length > 0 ? '#fff1f2' : '#ffffff',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: selected.length > 0 ? 700 : 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'left',
            boxShadow: 'none',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {triggerLabel}
          </span>
          <Icon name="expand_more" size={16} color={selected.length > 0 ? '#FF6467' : '#64748b'} />
        </button>
      </label>

      {/* Modern Bottom Sheet / Modal Dialog */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="village-modal-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              zIndex: 99999,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
            onClick={() => setIsOpen(false)}
          >
            <div
              className="village-modal-panel"
              style={{
                width: '100%',
                maxWidth: 480,
                maxHeight: '85vh',
                backgroundColor: '#ffffff',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.25)',
                animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                style={{
                  padding: '14px 16px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                    Filter by Village
                  </h3>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                    Select one or more villages to view records
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748b',
                  }}
                  aria-label="Close"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              {/* Search Bar */}
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #f8fafc' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: '0 10px',
                    height: 36,
                  }}
                >
                  <Icon name="search" size={16} color="#94a3b8" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    placeholder="Search village name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      flex: 1,
                      border: 'none',
                      background: 'transparent',
                      font: 'inherit',
                      fontSize: '0.84rem',
                      outline: 'none',
                      color: '#0f172a',
                    }}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>

                {/* Quick Selection Helpers */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 8,
                    fontSize: '0.74rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Select all
                    </button>
                    <span style={{ color: '#cbd5e1' }}>|</span>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Clear
                    </button>
                  </div>

                  <span
                    style={{
                      backgroundColor: draft.length > 0 ? '#eff6ff' : '#f1f5f9',
                      color: draft.length > 0 ? '#1d4ed8' : '#64748b',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontWeight: 700,
                      fontSize: '0.7rem',
                    }}
                  >
                    {draft.length} selected
                  </span>
                </div>
              </div>

              {/* Village Items List */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '6px 16px',
                  maxHeight: '45vh',
                }}
              >
                {filteredOptions.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
                    {search.trim() ? `No villages matching "${search}"` : 'No villages found for this filter'}
                  </div>
                ) : (
                  filteredOptions.map((v) => {
                    const isChecked = draft.includes(v.name);
                    return (
                      <div
                        key={v.name}
                        onClick={() => toggleVillage(v.name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: 8,
                          marginBottom: 2,
                          backgroundColor: isChecked ? '#fff1f2' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background 0.12s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleVillage(v.name)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 17,
                              height: 17,
                              accentColor: '#FF6467',
                              cursor: 'pointer',
                            }}
                          />
                          <span
                            style={{
                              fontSize: '0.84rem',
                              fontWeight: isChecked ? 700 : 500,
                              color: isChecked ? '#991b1b' : '#0f172a',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {v.name}
                          </span>
                        </div>

                        {v.count != null && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 10,
                              backgroundColor: isChecked ? '#fecdd3' : '#f1f5f9',
                              color: isChecked ? '#9f1239' : '#475569',
                              marginLeft: 8,
                              flexShrink: 0,
                            }}
                          >
                            {v.count}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer Actions */}
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid #f1f5f9',
                  display: 'flex',
                  gap: 10,
                  backgroundColor: '#ffffff',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsOpen(false)}
                  style={{ flex: 1, height: 38, fontSize: '0.82rem', justifyContent: 'center' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApply}
                  style={{
                    flex: 1.5,
                    height: 38,
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    justifyContent: 'center',
                    backgroundColor: '#FF6467',
                  }}
                >
                  Apply {draft.length > 0 ? `(${draft.length})` : 'All'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
