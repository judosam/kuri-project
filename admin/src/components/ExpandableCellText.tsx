import { useState, useEffect, useRef } from 'react';
import { Icon } from './ui';

interface ExpandableCellTextProps {
  text?: string | null;
  /** Approximate character budget before the cell is considered truncated. */
  maxChars?: number;
  textColor?: string;
  moreColor?: string;
  /** Number of text lines shown while collapsed. */
  lines?: number;
  /** Place an icon toggle beside the text in dense tables. */
  compact?: boolean;
}

/**
 * Table cell text with a uniform collapsed height.
 *
 * Long values are clamped to `lines` lines and the "View more" / "View less"
 * toggle always renders on its own row at the bottom-left of the cell, so every
 * overflowing cell lines up identically instead of the toggle drifting inline
 * with the wrapped text.
 */
export function ExpandableCellText({
  text,
  maxChars = 35,
  textColor = '#0f172a',
  moreColor = '#be123c',
  lines = 1,
  compact = false,
}: ExpandableCellTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  const clean = text?.trim() ?? '';
  const likelyLong = clean.length > maxChars || clean.includes('\n');
  const effectiveLines = compact ? 1 : lines;

  // Measure the clamped text so the toggle only appears when content is really hidden.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => {
      const isOver = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 1;
      setOverflows(isOver);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clean, lines, compact, expanded]);

  // A new value in the same cell should not stay expanded.
  useEffect(() => {
    setExpanded(false);
  }, [clean]);

  if (!clean) {
    return <span className="cell-expand-empty">—</span>;
  }

  const isOverflowing = overflows || likelyLong;
  const showToggle = expanded || isOverflowing;

  return (
    <div className={`cell-expand${compact ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}`}>
      <span
        ref={textRef}
        className={`cell-expand-text${expanded ? ' is-expanded' : ' is-clamped'}`}
        style={{ color: textColor, WebkitLineClamp: expanded ? undefined : (effectiveLines > 1 ? effectiveLines : undefined) } as React.CSSProperties}
        title={expanded ? undefined : clean}
      >
        {clean}
      </span>
      {showToggle && (
        <button
          type="button"
          className="btn-read-more cell-expand-toggle"
          style={{ color: moreColor }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          aria-expanded={expanded}
          aria-label={expanded ? `Read less: ${clean}` : `Read more: ${clean}`}
          title={expanded ? 'Read less' : 'Read more'}
        >
          <span>{expanded ? 'Read less' : 'Read more'}</span>
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={12} />
        </button>
      )}
    </div>
  );
}

export default ExpandableCellText;
