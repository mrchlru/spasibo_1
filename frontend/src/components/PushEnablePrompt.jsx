import React, { useCallback, useEffect, useState } from 'react';
import { FaBell } from 'react-icons/fa';
import styles from './PushEnablePrompt.module.css';
import { isMobileWelcomeSeen } from '../pwa/mobileWelcomeGuide.js';
import {
  dismissPushPromptForSession,
  enablePushWithTestPush,
  formatPushEnableError,
  isPushEnabledForUser,
  isPushPromptPlatform,
  shouldShowPushPromptThisSession,
} from '../pwa/pushUserControls.js';
import { isSpasiboAndroidApp } from '../pwa/androidNativePush.js';

/**
 * Всплывающее окно включения push при входе (Android APK и iOS PWA).
 * Показывается, пока уведомления не включены.
 */
function PushEnablePrompt({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
}) {
  const [visible, setVisible] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const refreshVisibility = useCallback(async () => {
    if (
      loading
      || !user
      || user.status !== 'approved'
      || isOnboardingVisible
      || !bootReady
      || !isPushPromptPlatform()
      || !shouldShowPushPromptThisSession()
      || !isMobileWelcomeSeen()
    ) {
      setVisible(false);
      return;
    }

    const enabled = await isPushEnabledForUser();
    setVisible(!enabled);
  }, [bootReady, isOnboardingVisible, loading, user?.id, user?.status]);

  useEffect(() => {
    refreshVisibility();
  }, [refreshVisibility]);

  useEffect(() => {
    const onPermissionChange = () => {
      refreshVisibility();
    };
    window.addEventListener('spasibo:notification-permission', onPermissionChange);
    return () => {
      window.removeEventListener('spasibo:notification-permission', onPermissionChange);
    };
  }, [refreshVisibility]);

  const handleEnable = async () => {
    setPushLoading(true);
    setStatusMessage('');
    try {
      const result = await enablePushWithTestPush();
      if (result.ok) {
        setStatusMessage(result.detail || 'Уведомления включены!');
        window.setTimeout(() => {
          setVisible(false);
        }, 1200);
        return;
      }

      if (isSpasiboAndroidApp() && result.reason === 'fcm_token_missing') {
        window.SpasiboAndroid?.showNativeToast?.(formatPushEnableError(result));
      } else if (isSpasiboAndroidApp() && result.reason !== 'permission_dismissed') {
        window.SpasiboAndroid?.openAppNotificationSettings?.();
      }
      setStatusMessage(formatPushEnableError(result));
    } finally {
      setPushLoading(false);
      refreshVisibility();
    }
  };

  const handleLater = () => {
    dismissPushPromptForSession();
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="push-prompt-title">
        <div className={styles.iconWrap}>
          <FaBell className={styles.icon} aria-hidden />
        </div>
        <h2 id="push-prompt-title" className={styles.title}>Включите уведомления</h2>
        <p className={styles.text}>
          Получайте спасибки, новости и напоминания сразу на телефон — даже когда приложение закрыто.
        </p>
        {statusMessage ? (
          <p
            className={styles.status}
            style={{ color: statusMessage.includes('включен') ? '#5ca14a' : '#c0392b' }}
          >
            {statusMessage}
          </p>
        ) : null}
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleEnable}
          disabled={pushLoading}
        >
          {pushLoading ? 'Подключаем…' : 'Включить уведомления'}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleLater}
          disabled={pushLoading}
        >
          Позже
        </button>
      </div>
    </div>
  );
}

export default PushEnablePrompt;
