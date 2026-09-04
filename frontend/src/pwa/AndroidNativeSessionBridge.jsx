import { useEffect } from 'react';
import { getApiBaseUrl } from '../api.js';
import {
  clearAndroidNativeSession,
  isSpasiboAndroidApp,
  syncAndroidNativeSession,
  syncAndroidPushIfAlreadyGranted,
} from './androidNativePush.js';

/** Передаёт сессию в нативную Android-оболочку для регистрации FCM. */
function AndroidNativeSessionBridge({ user }) {
  useEffect(() => {
    if (!isSpasiboAndroidApp()) {
      return;
    }

    const apiBaseUrl = getApiBaseUrl();
    if (!user?.id || user.status !== 'approved' || !apiBaseUrl) {
      clearAndroidNativeSession();
      return;
    }

    syncAndroidNativeSession(user.id, apiBaseUrl);
    void syncAndroidPushIfAlreadyGranted();
  }, [user?.id, user?.status]);

  return null;
}

export default AndroidNativeSessionBridge;
