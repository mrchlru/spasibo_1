import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaBell } from 'react-icons/fa';
import styles from './MobileWelcomeGuide.module.css';
import WelcomeVisual from './MobileWelcomeGuideVisuals.jsx';
import {
  areMobileNotificationsEnabledSync,
  buildMobileWelcomeSlides,
  getMobileWelcomePlatform,
  isMobileWelcomePlatform,
  isMobileWelcomeSeen,
  markMobileWelcomeSeen,
} from '../pwa/mobileWelcomeGuide.js';
import {
  enablePushWithTestPush,
  formatPushEnableError,
} from '../pwa/pushUserControls.js';
import { pushBlockReasonMessage } from '../pwa/pushEnvironment.js';

/**
 * Карусель «что нового» для телефонов после загрузки приложения.
 * Особый акцент — включение уведомлений с наглядными «скриншотами».
 */
function MobileWelcomeGuide({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
}) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [pushLoading, setPushLoading] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  const platform = useMemo(() => getMobileWelcomePlatform(), []);

  const slides = useMemo(
    () => buildMobileWelcomeSlides({ platform, notificationsEnabled }),
    [platform, notificationsEnabled],
  );

  const currentSlide = slides[step] ?? slides[0];
  const isLastStep = step >= slides.length - 1;
  const isNotificationSlide = Boolean(currentSlide?.isNotificationSlide)
    && currentSlide?.id !== 'notifications-ok';

  const refreshVisibility = useCallback(async () => {
    if (
      loading
      || !user
      || user.status !== 'approved'
      || isOnboardingVisible
      || !bootReady
      || !isMobileWelcomePlatform()
      || isMobileWelcomeSeen()
    ) {
      setVisible(false);
      return;
    }

    const pushOn = platform ? areMobileNotificationsEnabledSync(platform) : false;
    setNotificationsEnabled(pushOn);
    setVisible(true);
  }, [bootReady, isOnboardingVisible, loading, platform, user?.id, user?.status]);

  useEffect(() => {
    setStep((prev) => Math.min(prev, Math.max(slides.length - 1, 0)));
  }, [slides.length]);

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

  const closeGuide = useCallback(() => {
    markMobileWelcomeSeen();
    setVisible(false);
  }, []);

  const goNext = useCallback(() => {
    if (isLastStep) {
      closeGuide();
      return;
    }
    setStep((prev) => Math.min(prev + 1, slides.length - 1));
    setPushMessage('');
  }, [closeGuide, isLastStep, slides.length]);

  const handleEnablePush = async () => {
    if (!platform || pushLoading) {
      return;
    }
    setPushLoading(true);
    setPushMessage('');
    try {
      const result = await enablePushWithTestPush();
      if (result.ok) {
        setNotificationsEnabled(true);
        setPushMessage(result.detail || 'Готово! Уведомления включены.');
        if (!isLastStep) {
          setStep((prev) => Math.min(prev + 1, slides.length - 1));
        } else {
          closeGuide();
        }
        return;
      }
      if (platform === 'android-app' && result.reason === 'fcm_token_missing') {
        window.SpasiboAndroid?.showNativeToast?.(result.detail);
      } else if (platform === 'android-app' && result.reason !== 'permission_dismissed') {
        window.SpasiboAndroid?.openAppNotificationSettings?.();
      }
      setPushMessage(formatPushEnableError(result) || pushBlockReasonMessage(result.reason));
    } finally {
      setPushLoading(false);
      refreshVisibility();
    }
  };

  if (!visible || !currentSlide) {
    return null;
  }

  const primaryLabel = (() => {
    if (isNotificationSlide) {
      return pushLoading ? 'Подключаем…' : 'Включить уведомления';
    }
    if (isLastStep) {
      return 'Начать пользоваться';
    }
    return 'Дальше';
  })();

  const handlePrimary = () => {
    if (isNotificationSlide) {
      handleEnablePush();
      return;
    }
    goNext();
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="mobile-welcome-title">
      <div className={styles.sheet}>
        <div className={styles.header}>
          <button type="button" className={styles.skipBtn} onClick={closeGuide}>
            Пропустить
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.visualWrap}>
            <WelcomeVisual variant={currentSlide.visual} />
          </div>
          <h2 id="mobile-welcome-title" className={styles.title}>
            {currentSlide.title}
          </h2>
          <p className={styles.text}>{currentSlide.text}</p>
          {pushMessage ? (
            <p className={styles.text} style={{ color: pushMessage.startsWith('Готово') ? '#5ca14a' : '#c0392b' }}>
              {pushMessage}
            </p>
          ) : null}
          {isNotificationSlide && platform === 'ios-browser' ? (
            <p className={styles.text}>
              Сначала добавьте приложение на экран — потом вернитесь сюда и включите уведомления.
            </p>
          ) : null}
        </div>

        <div className={styles.footer}>
          <div className={styles.dots}>
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                className={`${styles.dot} ${index === step ? styles.dotActive : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handlePrimary}
            disabled={pushLoading}
          >
            {isNotificationSlide && !pushLoading ? (
              <>
                <FaBell style={{ marginRight: 6, verticalAlign: -2 }} />
                {primaryLabel}
              </>
            ) : (
              primaryLabel
            )}
          </button>
          {!isLastStep ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={goNext}
              disabled={pushLoading}
            >
              {isNotificationSlide ? 'Позже' : 'Пропустить шаг'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MobileWelcomeGuide;
