import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaAndroid, FaDownload } from 'react-icons/fa';
import styles from './AndroidInstallSheet.module.css';
import { isMobileWelcomeSeen } from '../pwa/mobileWelcomeGuide.js';
import { openExternalLink } from '../utils/openExternalLink.js';
import {
  dismissAndroidInstallPrompt,
  getAndroidInstallPromptCopy,
  getAndroidInstallPromptMode,
  isPrimaryAdminUser,
  normalizeAndroidRelease,
  shouldShowAndroidInstallPrompt,
} from '../pwa/androidInstallPrompt.js';

const SWIPE_CLOSE_THRESHOLD_PX = 56;
const SCROLL_REOPEN_THRESHOLD_PX = 12;

/**
 * Нижний слайдер установки (браузер) или обновления (APK) на Android.
 * Смахивание вниз — сворачивает/скрывает; прокрутка страницы вверх — снова показывает.
 */
export function AndroidInstallSheet({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
  androidRelease,
  hasBottomNav = false,
}) {
  const release = useMemo(() => normalizeAndroidRelease(androidRelease), [androidRelease]);
  const promptMode = getAndroidInstallPromptMode();
  const copy = useMemo(
    () => getAndroidInstallPromptCopy(release, promptMode),
    [release, promptMode],
  );
  const isPrimaryAdmin = isPrimaryAdminUser(user);
  const [eligible, setEligible] = useState(false);
  const [sheetState, setSheetState] = useState('expanded');
  const sheetStateRef = useRef(sheetState);
  const dragStartYRef = useRef(0);
  const dragDeltaRef = useRef(0);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    sheetStateRef.current = sheetState;
  }, [sheetState]);

  const refreshEligibility = useCallback(() => {
    const ok = Boolean(
      !loading
      && user
      && user.status === 'approved'
      && !isOnboardingVisible
      && bootReady
      && isMobileWelcomeSeen()
      && shouldShowAndroidInstallPrompt(release, { isPrimaryAdmin }),
    );
    setEligible(ok);
    if (!ok) {
      setSheetState('hidden');
    }
  }, [
    bootReady,
    isOnboardingVisible,
    isPrimaryAdmin,
    loading,
    release.apk_url,
    release.enabled,
    release.version_code,
    user?.id,
    user?.status,
  ]);

  useEffect(() => {
    refreshEligibility();
  }, [refreshEligibility]);

  useEffect(() => {
    if (!eligible || !promptMode) {
      return undefined;
    }
    setSheetState('expanded');
    lastScrollYRef.current = window.scrollY;

    const onScroll = () => {
      const currentY = window.scrollY;
      if (
        sheetStateRef.current === 'hidden'
        && currentY + SCROLL_REOPEN_THRESHOLD_PX < lastScrollYRef.current
      ) {
        setSheetState('peek');
      }
      lastScrollYRef.current = currentY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [eligible, promptMode, release.version_code]);

  const handleDownload = () => {
    openExternalLink(release.apk_url);
  };

  const handleDismiss = () => {
    dismissAndroidInstallPrompt(release);
    setSheetState('hidden');
    setEligible(false);
  };

  const handleTouchStart = (event) => {
    dragStartYRef.current = event.touches[0]?.clientY ?? 0;
    dragDeltaRef.current = 0;
  };

  const handleTouchMove = (event) => {
    const currentY = event.touches[0]?.clientY ?? dragStartYRef.current;
    dragDeltaRef.current = Math.max(0, currentY - dragStartYRef.current);
  };

  const handleTouchEnd = () => {
    if (dragDeltaRef.current < SWIPE_CLOSE_THRESHOLD_PX) {
      return;
    }
    if (sheetStateRef.current === 'expanded') {
      setSheetState('peek');
      return;
    }
    if (sheetStateRef.current === 'peek') {
      handleDismiss();
    }
  };

  const handlePeekOpen = () => {
    if (sheetStateRef.current === 'peek') {
      setSheetState('expanded');
    }
  };

  if (!eligible || sheetState === 'hidden') {
    return null;
  }

  const sheetClassName = [
    styles.sheet,
    sheetState === 'peek' ? styles.sheetPeek : '',
    hasBottomNav ? styles.sheetAboveNav : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {sheetState === 'expanded' ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Свернуть подсказку"
          onClick={() => setSheetState('peek')}
        />
      ) : null}
      <section
        className={sheetClassName}
        role="dialog"
        aria-modal={sheetState === 'expanded'}
        aria-labelledby="android-install-title"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          className={styles.handleArea}
          aria-label={sheetState === 'peek' ? 'Развернуть подсказку' : 'Свернуть подсказку'}
          onClick={handlePeekOpen}
        >
          <span className={styles.handle} aria-hidden="true" />
        </button>

        <div className={styles.content}>
          <div className={styles.iconWrap} aria-hidden="true">
            <FaAndroid size={28} />
          </div>
          <div className={styles.textBlock}>
            <h2 id="android-install-title" className={styles.title}>
              {copy.title}
            </h2>
            {sheetState === 'expanded' ? (
              <>
                <p className={styles.text}>{copy.description}</p>
                {release.release_notes ? (
                  <p className={styles.notes}>{release.release_notes}</p>
                ) : null}
                <p className={styles.version}>
                  Версия {release.version_name}
                </p>
                {isPrimaryAdmin && !release.enabled ? (
                  <p className={styles.testBadge}>Только для теста (ещё не включено для всех)</p>
                ) : null}
              </>
            ) : (
              <p className={styles.peekHint}>Нажмите, чтобы открыть</p>
            )}
          </div>
        </div>

        {sheetState === 'expanded' ? (
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={handleDownload}>
              <FaDownload aria-hidden="true" />
              {copy.actionLabel}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setSheetState('peek')}>
              Позже
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

export default AndroidInstallSheet;
