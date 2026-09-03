import React, { useCallback, useEffect, useState } from 'react';
import { FaBell } from 'react-icons/fa';
import styles from './AndroidPushPrompt.module.css';
import {
  dismissAndroidPushPromptForSession,
  enableAndroidNativePush,
  isAndroidNativePushGranted,
  isSpasiboAndroidApp,
  shouldShowAndroidPushPrompt,
} from '../pwa/androidNativePush.js';

/**
 * Промпт включения push при входе в нативное Android-приложение.
 * Показывается до выдачи системного разрешения на уведомления.
 */
function AndroidPushPrompt({ user }) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshVisibility = useCallback(() => {
    const show =
      isSpasiboAndroidApp()
      && user?.status === 'approved'
      && shouldShowAndroidPushPrompt();
    setVisible(show);
  }, [user?.status]);

  useEffect(() => {
    refreshVisibility();
  }, [refreshVisibility, user?.id]);

  useEffect(() => {
    const onPermissionChange = () => {
      if (isAndroidNativePushGranted()) {
        setVisible(false);
      } else {
        refreshVisibility();
      }
    };
    window.addEventListener('spasibo:notification-permission', onPermissionChange);
    return () => {
      window.removeEventListener('spasibo:notification-permission', onPermissionChange);
    };
  }, [refreshVisibility]);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const result = await enableAndroidNativePush();
      if (result.ok) {
        setVisible(false);
        return;
      }
      if (result.reason === 'fcm_token_missing') {
        window.SpasiboAndroid?.showNativeToast?.(result.detail);
      } else if (result.reason !== 'permission_dismissed') {
        window.SpasiboAndroid?.openAppNotificationSettings?.();
      }
    } finally {
      setLoading(false);
      refreshVisibility();
    }
  };

  const handleLater = () => {
    dismissAndroidPushPromptForSession();
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.iconWrap}>
          <FaBell className={styles.icon} aria-hidden />
        </div>
        <h2 className={styles.title}>Включите уведомления</h2>
        <p className={styles.text}>
          Получайте спасибки, новости и напоминания сразу на телефон — даже когда приложение закрыто.
        </p>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleEnable}
          disabled={loading}
        >
          {loading ? 'Подключаем…' : 'Включить уведомления'}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleLater}
          disabled={loading}
        >
          Не сейчас
        </button>
      </div>
    </div>
  );
}

export default AndroidPushPrompt;
