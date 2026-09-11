import { useEffect } from 'react';
import { startSession, pingSession } from '../api';
import { getClientProfile } from '../utils/clientProfile';

const PING_INTERVAL = 60000;

/**
 * Отслеживание сессий для всех одобренных пользователей (не только Telegram).
 *
 * @param {{ userId?: number, enabled?: boolean }} options
 */
export function useSessionTracking({ userId, enabled = true }) {
  useEffect(() => {
    if (!enabled || !userId) {
      return undefined;
    }

    let sessionId = null;
    let intervalId = null;
    let isActive = true;
    const clientProfile = getClientProfile();

    const startPinging = () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(async () => {
        if (sessionId && isActive && document.visibilityState === 'visible') {
          try {
            await pingSession(sessionId);
          } catch (pingError) {
            if (pingError.response?.status === 404) {
              try {
                const newResponse = await startSession(clientProfile);
                sessionId = newResponse.data.id;
              } catch {
                if (intervalId) {
                  clearInterval(intervalId);
                  intervalId = null;
                }
              }
            }
          }
        }
      }, PING_INTERVAL);
    };

    const handleVisibilityChange = () => {
      isActive = document.visibilityState === 'visible';
      if (isActive && !intervalId && sessionId) {
        startPinging();
      }
    };

    const handleBeforeUnload = () => {
      isActive = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    void (async () => {
      try {
        const response = await startSession(clientProfile);
        sessionId = response.data.id;
        startPinging();
      } catch {
        /* ignore */
      }
    })();

    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [userId, enabled]);
}
