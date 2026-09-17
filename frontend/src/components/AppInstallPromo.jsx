import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FaBell, FaDesktop, FaDownload, FaMobileAlt } from 'react-icons/fa';
import styles from './AppInstallPromo.module.css';
import WelcomeVisual from './MobileWelcomeGuideVisuals.jsx';
import { isMobileWelcomeSeen } from '../pwa/mobileWelcomeGuide.js';
import {
  APP_INSTALL_PROMO_SHOW_DELAY_MS,
  bindPwaInstallPromptCapture,
  buildAppInstallQrImageUrl,
  getAppInstallPromoPlatform,
  getAppInstallPromoShareUrl,
  hasDeferredPwaInstallPrompt,
  isDesktopPushAlreadyEnabled,
  promptDeferredPwaInstall,
  shouldShowAppInstallPromo,
  isInstallPromoAudienceAllowed,
  isInstallPromoRestrictedAudience,
} from '../pwa/appInstallPromo.js';
import {
  canShowInstallPromoForAccount,
  hydrateInstallPromoAccountState,
  markInstallPromoDoneOnAccount,
  snoozeInstallPromoOnAccount,
  subscribeInstallPromoAccountState,
} from '../pwa/installPromoAccountState.js';
import {
  getEntryPromoRotationSnapshot,
  markEntryPromoPresented,
  reportInstallSoftPromoStatus,
  subscribeEntryPromoRotation,
} from '../pwa/entryPromoRotation.js';
import {
  enablePushWithTestPush,
  formatPushEnableError,
} from '../pwa/pushUserControls.js';
import { pushBlockReasonMessage } from '../pwa/pushEnvironment.js';

/**
 * На ПК приветственная карусель не показывается — для промо считаем гейт пройденным.
 */
function _isWelcomeGatePassed() {
  return isMobileWelcomeSeen() || getAppInstallPromoPlatform() === 'desktop';
}

function _getAccountCanShowSnapshot() {
  return canShowInstallPromoForAccount();
}

/**
 * Мягкое промо: QR на ПК, инструкция «На экран Домой» на iOS Safari.
 */
function AppInstallPromo({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
  installPromo = null,
  hasBottomNav = false,
}) {
  const platform = useMemo(() => getAppInstallPromoPlatform(), []);
  const shareUrl = useMemo(() => getAppInstallPromoShareUrl(), []);
  const qrUrl = useMemo(() => buildAppInstallQrImageUrl(shareUrl), [shareUrl]);
  const accountCanShow = useSyncExternalStore(
    subscribeInstallPromoAccountState,
    _getAccountCanShowSnapshot,
    () => true,
  );
  const rotation = useSyncExternalStore(
    subscribeEntryPromoRotation,
    getEntryPromoRotationSnapshot,
    () => ({ slot: null, isReady: false }),
  );
  const impressionSentRef = useRef(false);
  const [shownThisSession, setShownThisSession] = useState(false);
  const [welcomePassed, setWelcomePassed] = useState(() => _isWelcomeGatePassed());

  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('promote');
  const [pushLoading, setPushLoading] = useState(false);
  const [installLoading, setInstallLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [pwaInstallAvailable, setPwaInstallAvailable] = useState(false);

  const buildShowOptions = useCallback(() => ({
    isAdmin: Boolean(user?.is_admin),
    userId: user?.id ?? null,
    accountCanShow: isInstallPromoRestrictedAudience(installPromo)
      || shownThisSession
      || accountCanShow,
  }), [accountCanShow, installPromo, shownThisSession, user?.id, user?.is_admin]);

  const baseEligible = useMemo(() => Boolean(
    !loading
    && user
    && user.status === 'approved'
    && !isOnboardingVisible
    && bootReady
    && welcomePassed
    && shouldShowAppInstallPromo(platform, installPromo, buildShowOptions()),
  ), [
    bootReady,
    buildShowOptions,
    installPromo,
    isOnboardingVisible,
    loading,
    platform,
    user,
    welcomePassed,
  ]);

  const softReady = Boolean(bootReady && !loading);

  useEffect(() => {
    reportInstallSoftPromoStatus({
      ready: softReady,
      eligible: baseEligible,
    });
  }, [baseEligible, softReady]);

  const refreshVisibility = useCallback(() => {
    const canShow = Boolean(
      baseEligible
      && rotation.isReady
      && rotation.slot === 'install',
    );
    setVisible(canShow);
    if (!canShow) {
      setMode('promote');
      setStatusMessage('');
    }
  }, [baseEligible, rotation.isReady, rotation.slot]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }
    void hydrateInstallPromoAccountState();
    return undefined;
  }, [user?.id]);

  useEffect(() => {
    bindPwaInstallPromptCapture();
    setPwaInstallAvailable(hasDeferredPwaInstallPrompt());
    const onPwaAvailable = () => setPwaInstallAvailable(true);
    window.addEventListener('spasibo:pwa-install-available', onPwaAvailable);
    return () => {
      window.removeEventListener('spasibo:pwa-install-available', onPwaAvailable);
    };
  }, []);

  useEffect(() => {
    if (
      !baseEligible
      || !rotation.isReady
      || rotation.slot !== 'install'
    ) {
      setVisible(false);
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      refreshVisibility();
    }, APP_INSTALL_PROMO_SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    baseEligible,
    refreshVisibility,
    rotation.isReady,
    rotation.slot,
  ]);

  useEffect(() => {
    const onWelcomeSeen = () => {
      setWelcomePassed(true);
      window.setTimeout(() => refreshVisibility(), APP_INSTALL_PROMO_SHOW_DELAY_MS);
    };
    const onPromoDone = () => refreshVisibility();
    window.addEventListener('spasibo:mobile-welcome-seen', onWelcomeSeen);
    window.addEventListener('spasibo:app-install-promo-done', onPromoDone);
    window.addEventListener('spasibo:app-install-promo-snoozed', onPromoDone);
    window.addEventListener('spasibo:notification-permission', onPromoDone);
    return () => {
      window.removeEventListener('spasibo:mobile-welcome-seen', onWelcomeSeen);
      window.removeEventListener('spasibo:app-install-promo-done', onPromoDone);
      window.removeEventListener('spasibo:app-install-promo-snoozed', onPromoDone);
      window.removeEventListener('spasibo:notification-permission', onPromoDone);
    };
  }, [refreshVisibility]);

  useEffect(() => {
    if (!visible || isInstallPromoRestrictedAudience(installPromo)) {
      return undefined;
    }
    setShownThisSession(true);
    markEntryPromoPresented('install');
    if (impressionSentRef.current) {
      return undefined;
    }
    impressionSentRef.current = true;
    void snoozeInstallPromoOnAccount();
    return undefined;
  }, [installPromo, visible]);

  useEffect(() => {
    if (!visible || platform !== 'desktop') {
      return undefined;
    }
    if (
      isInstallPromoRestrictedAudience(installPromo)
      && isInstallPromoAudienceAllowed(installPromo, {
        isAdmin: Boolean(user?.is_admin),
        userId: user?.id ?? null,
      })
    ) {
      return undefined;
    }
    let cancelled = false;
    isDesktopPushAlreadyEnabled().then((enabled) => {
      if (!cancelled && enabled) {
        void markInstallPromoDoneOnAccount('desktop_push');
        setVisible(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [installPromo, platform, user?.id, user?.is_admin, visible]);

  const handleLater = () => {
    void snoozeInstallPromoOnAccount();
    setVisible(false);
  };

  const handleStayOnDesktop = () => {
    setMode('desktop-stay');
    setStatusMessage('');
  };

  const handleBackToQr = () => {
    setMode('promote');
    setStatusMessage('');
  };

  const handleEnablePush = async () => {
    if (pushLoading) {
      return;
    }
    setPushLoading(true);
    setStatusMessage('');
    try {
      const result = await enablePushWithTestPush();
      if (result.ok) {
        void markInstallPromoDoneOnAccount('desktop_push');
        setStatusMessage(result.detail || 'Уведомления включены!');
        window.setTimeout(() => setVisible(false), 1100);
        return;
      }
      setStatusMessage(formatPushEnableError(result) || pushBlockReasonMessage(result.reason));
    } finally {
      setPushLoading(false);
    }
  };

  const handleInstallPwa = async () => {
    if (installLoading) {
      return;
    }
    setInstallLoading(true);
    setStatusMessage('');
    try {
      const result = await promptDeferredPwaInstall();
      if (result.ok) {
        void markInstallPromoDoneOnAccount('pwa_installed');
        setStatusMessage('Приложение добавлено — можно открывать с панели задач.');
        window.setTimeout(() => setVisible(false), 1100);
        return;
      }
      if (result.reason === 'unavailable') {
        setStatusMessage('Установка из браузера сейчас недоступна. Можно включить уведомления ниже.');
        setPwaInstallAvailable(false);
        return;
      }
      setStatusMessage('Установка отменена. Можно попробовать позже или включить уведомления.');
    } finally {
      setInstallLoading(false);
      setPwaInstallAvailable(hasDeferredPwaInstallPrompt());
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatusMessage('Ссылка скопирована — откройте её на телефоне.');
    } catch {
      setStatusMessage(shareUrl);
    }
  };

  if (!visible || !platform || platform === 'android-browser') {
    return null;
  }

  const isDesktop = platform === 'desktop';
  const sheetClassName = [
    styles.sheet,
    isDesktop ? styles.sheetDesktop : '',
    hasBottomNav ? styles.sheetAboveNav : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.overlay} role="presentation">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Закрыть подсказку"
        onClick={handleLater}
      />
      <section
        className={sheetClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-install-promo-title"
      >
        <div className={styles.handle} aria-hidden="true" />

        {isDesktop && mode === 'promote' ? (
          <DesktopQrView
            qrUrl={qrUrl}
            shareUrl={shareUrl}
            statusMessage={statusMessage}
            onStay={handleStayOnDesktop}
            onLater={handleLater}
            onCopyLink={handleCopyLink}
          />
        ) : null}

        {isDesktop && mode === 'desktop-stay' ? (
          <DesktopStayView
            statusMessage={statusMessage}
            pushLoading={pushLoading}
            installLoading={installLoading}
            pwaInstallAvailable={pwaInstallAvailable}
            onEnablePush={handleEnablePush}
            onInstallPwa={handleInstallPwa}
            onBack={handleBackToQr}
            onLater={handleLater}
          />
        ) : null}

        {platform === 'ios-browser' ? (
          <IosInstallView
            statusMessage={statusMessage}
            onLater={handleLater}
          />
        ) : null}
      </section>
    </div>
  );
}

/**
 * Десктоп: QR для перехода на телефон.
 */
function DesktopQrView({
  qrUrl,
  shareUrl,
  statusMessage,
  onStay,
  onLater,
  onCopyLink,
}) {
  return (
    <div className={styles.content}>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>
          <FaMobileAlt aria-hidden="true" />
          Удобнее с телефона
        </span>
      </div>
      <h2 id="app-install-promo-title" className={styles.title}>
        Откройте «Спасибо» на телефоне
      </h2>
      <p className={styles.text}>
        Наведите камеру на QR — приложение откроется в браузере телефона. Дальше подскажем, как установить.
      </p>
      <div className={styles.qrWrap}>
        <img
          className={styles.qrImage}
          src={qrUrl}
          alt="QR-код со ссылкой на приложение Спасибо"
          width={200}
          height={200}
        />
      </div>
      <button type="button" className={styles.linkBtn} onClick={onCopyLink}>
        Или скопировать ссылку
      </button>
      <p className={styles.urlHint}>{shareUrl}</p>
      {statusMessage ? <p className={styles.status}>{statusMessage}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={onStay}>
          <FaDesktop aria-hidden="true" />
          Хочу остаться на компьютере
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onLater}>
          Позже
        </button>
      </div>
    </div>
  );
}

/**
 * Десктоп: уведомления и опциональная установка PWA.
 */
function DesktopStayView({
  statusMessage,
  pushLoading,
  installLoading,
  pwaInstallAvailable,
  onEnablePush,
  onInstallPwa,
  onBack,
  onLater,
}) {
  return (
    <div className={styles.content}>
      <div className={styles.iconWrap} aria-hidden="true">
        <FaBell size={26} />
      </div>
      <h2 id="app-install-promo-title" className={styles.title}>
        Остаётесь на компьютере?
      </h2>
      <p className={styles.text}>
        Включите уведомления в браузере — так вы не пропустите спасибки и новости, даже когда вкладка свёрнута.
      </p>
      {statusMessage ? <p className={styles.status}>{statusMessage}</p> : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onEnablePush}
          disabled={pushLoading || installLoading}
        >
          <FaBell aria-hidden="true" />
          {pushLoading ? 'Подключаем…' : 'Включить уведомления'}
        </button>
        {pwaInstallAvailable ? (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onInstallPwa}
            disabled={pushLoading || installLoading}
          >
            <FaDownload aria-hidden="true" />
            {installLoading ? 'Устанавливаем…' : 'Установить как приложение'}
          </button>
        ) : null}
        <button type="button" className={styles.ghostBtn} onClick={onBack} disabled={pushLoading}>
          Назад к QR-коду
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onLater} disabled={pushLoading}>
          Позже
        </button>
      </div>
    </div>
  );
}

/**
 * iOS Safari: инструкция «На экран Домой».
 */
function IosInstallView({ statusMessage, onLater }) {
  return (
    <div className={styles.content}>
      <div className={styles.visualWrap}>
        <WelcomeVisual variant="ios-home" />
      </div>
      <h2 id="app-install-promo-title" className={styles.title}>
        Добавьте «Спасибо» на экран Домой
      </h2>
      <p className={styles.text}>
        В Safari нажмите «Поделиться», затем «На экран Домой». Так приложение откроется как обычная иконка, а уведомления заработают полностью.
      </p>
      <ol className={styles.steps}>
        <li>Откройте меню «Поделиться» внизу Safari</li>
        <li>Пролистайте и выберите «На экран Домой»</li>
        <li>Подтвердите «Добавить»</li>
      </ol>
      {statusMessage ? <p className={styles.status}>{statusMessage}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onLater}>
          Позже
        </button>
      </div>
    </div>
  );
}

export default AppInstallPromo;
