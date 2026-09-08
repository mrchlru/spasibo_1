import { useEffect, useRef } from 'react';

/**
 * Периодически и при возврате на вкладку обновляет данные активного экрана.
 * Polling только когда document.visibilityState === 'visible'.
 *
 * @param {() => void | Promise<void>} refreshFn
 * @param {{ enabled?: boolean, intervalMs?: number }} [options]
 */
export function useLiveRefresh(refreshFn, options = {}) {
  const { enabled = true, intervalMs = 60000 } = options;
  const refreshRef = useRef(refreshFn);

  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const runRefresh = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void refreshRef.current?.();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runRefresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    const timerId = window.setInterval(runRefresh, intervalMs);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timerId);
    };
  }, [enabled, intervalMs]);
}
