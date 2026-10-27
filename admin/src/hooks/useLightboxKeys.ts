import { useEffect } from 'react';

// Close lightbox on Escape, cycle on ArrowLeft/ArrowRight
export function useLightboxKeys(
  active: boolean,
  onClose: () => void,
  onPrev: () => void,
  onNext: () => void
) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose, onPrev, onNext]);
}
