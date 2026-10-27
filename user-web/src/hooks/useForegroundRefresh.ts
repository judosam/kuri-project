import { useEffect, useRef } from 'react';

/** Refresh read-only screens on return and every 30 seconds while visible. */
export function useForegroundRefresh(refresh: () => void | Promise<void>) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let running = false;
    let lastStarted = 0;
    const run = async () => {
      if (document.visibilityState !== 'visible' || running || Date.now() - lastStarted < 1000) return;
      running = true;
      lastStarted = Date.now();
      try { await latest.current(); } catch { /* Screens retain their existing error handling. */ }
      finally { running = false; }
    };
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', run);
    const timer = window.setInterval(run, 30000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
