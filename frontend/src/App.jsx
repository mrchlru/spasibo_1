// frontend/src/App.jsx

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { injectThemeAssetStyles } from './utils/themeAssetsCss';
import {
  ADMIN_PANEL_TOKEN_KEY,
  ADMIN_PANEL_USER_KEY,
} from './constants/adminPanelStorage.js';
import {
  checkUserStatus,
  checkUserStatusById,
  clearAdminPanelAuth,
  getAdminPanelMe,
  getFeed,
  getBanners,
  getAppSettings,
  updateMe,
  getTelegramPhotoProxyUrl,
  resolveAvatarUrl,
} from './api';
import { initializeCache, clearCache, setCachedData, hasWarmBootCache } from './storage';
import { preloadAppContent, ANDROID_BOOT_TIMEOUT_MS } from './boot/preloadAppContent';
import { isSpasiboAndroidApp, hideAndroidBootSplash } from './pwa/androidNativePush';
import { parseAppDeepLink, stripDeepLinkQueryFromLocation } from './utils/appDeepLink';
import { applyFrontendBuildUpdate } from './pwa/androidWebUpdate';
import {
  getCachedAppSettingsSnapshot,
} from './pwa/appSettingsCache';
import {
  persistAppSettingsFromApi,
  warmShellAssetsForTheme,
} from './boot/shellBootstrap';
import { syncBannersCache } from './pwa/bannerAssetCache';
import { ThemeAssetsProvider } from './contexts/ThemeAssetsContext';

// Компоненты навигации (загружаются сразу, так как всегда видны)
import BottomNav from './components/BottomNav';
import SideNav from './components/SideNav';
import LoadingScreen from './components/LoadingScreen'; // Страница загрузки

// Lazy loading страниц - загружаются только при необходимости
const RegistrationPage = lazy(() => import('./pages/RegistrationPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const FaqPage = lazy(() => import('./pages/FaqPage'));
const PendingPage = lazy(() => import('./pages/PendingPage'));
const RejectedPage = lazy(() => import('./pages/RejectedPage'));
const RoulettePage = lazy(() => import('./pages/RoulettePage'));
const BonusCardPage = lazy(() => import('./pages/BonusCardPage'));
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'));
const BlockedPage = lazy(() => import('./pages/BlockedPage'));
const TransferPage = lazy(() => import('./pages/TransferPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const OnboardingStories = lazy(() => import('./components/OnboardingStories'));
import EmailPromptModal from './components/EmailPromptModal';
import AndroidNativeSessionBridge from './pwa/AndroidNativeSessionBridge.jsx';
import MobileWelcomeGuide from './components/MobileWelcomeGuide.jsx';
import PushEnablePrompt from './components/PushEnablePrompt.jsx';
import AndroidInstallSheet from './components/AndroidInstallSheet.jsx';
import { DEFAULT_ANDROID_RELEASE, normalizeAndroidRelease } from './pwa/androidInstallPrompt.js';

import { useSessionTracking } from './hooks/useSessionTracking';

// Стили
import './App.css';

const STATUS_CHECK_INTERVAL = 5000; // Проверяем статус каждые 5 секунд (5000 миллисекунд)

// Без initData это заглушка SDK (браузер / Android WebView), не настоящий Telegram.
const tg = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;
const isTelegramWebApp = Boolean(window.Telegram?.WebApp?.initData);
const isAndroidShell = isSpasiboAndroidApp();
const androidLoadingFallback = <LoadingScreen />;

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootReady, setBootReady] = useState(false);
  const [page, setPage] = useState('home');
  const [homeSection, setHomeSection] = useState('feed');
  const [telegramPhotoUrl, setTelegramPhotoUrl] = useState(null);
  const [showPendingBanner, setShowPendingBanner] = useState(false);
 // 2. Добавляем новое состояние для принудительного показа обучения
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showEmailPromptModal, setShowEmailPromptModal] = useState(false);
  const [seasonTheme, setSeasonTheme] = useState(() => {
    return getCachedAppSettingsSnapshot()?.season_theme || 'summer';
  });
  const [themeAssets, setThemeAssets] = useState(() => {
    return getCachedAppSettingsSnapshot()?.theme_assets ?? null;
  });
  const [androidRelease, setAndroidRelease] = useState({ ...DEFAULT_ANDROID_RELEASE });
  const [pendingFeedPostId, setPendingFeedPostId] = useState(null);
  const seasonThemeRef = useRef('summer');
  // Инициализация windowWidth с проверкой доступности window
  const [windowWidth, setWindowWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1024; // Значение по умолчанию для SSR
  });
  // Состояние для переключения между страницами входа и регистрации в браузере
  const [showRegistration, setShowRegistration] = useState(false);
  // В Telegram: true = показать "Войти", false = показать "Регистрация"
  const [showLoginInTelegram, setShowLoginInTelegram] = useState(false);

  const applyTelegramTheme = (theme) => {
    if (!tg || !tg.setBackgroundColor || !tg.setHeaderColor) {
      return;
    }
    const isWinter = theme === 'winter';
    tg.setBackgroundColor(isWinter ? '#E8F4F8' : '#E5F5E3');
    tg.setHeaderColor(isWinter ? '#2196F3' : '#5CA14A');
  };
  
  // Определяем, является ли устройство десктопом
  // Пороговые значения:
  // - Mobile: < 768px (мобильный интерфейс)
  // - Tablet/Desktop: >= 768px (desktop интерфейс с боковым меню)
  // В браузере определяем desktop только по ширине окна
  // В Telegram WebApp также учитываем платформу
  const DESKTOP_BREAKPOINT = 768; // Порог для переключения на desktop интерфейс
  
  const isDesktop = !isTelegramWebApp 
    ? (windowWidth >= DESKTOP_BREAKPOINT) 
    : (['tdesktop', 'macos', 'web'].includes(tg?.platform) && windowWidth >= DESKTOP_BREAKPOINT) || 
      (windowWidth >= DESKTOP_BREAKPOINT);
  
  // Отладочная информация для разработки
  useEffect(() => {
    if (!isTelegramWebApp) {
      console.log('Browser mode - windowWidth:', windowWidth, 'isDesktop:', isDesktop, 'breakpoint:', DESKTOP_BREAKPOINT);
    }
  }, [windowWidth, isDesktop, isTelegramWebApp]);
  
  // Отслеживаем изменение размера окна с debounce для оптимизации
  useEffect(() => {
    let resizeTimer;
    const handleResize = () => {
      // Debounce для оптимизации производительности
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (typeof window !== 'undefined') {
          setWindowWidth(window.innerWidth);
        }
      }, 100); // Задержка 100ms для плавности
    };
    
    // Убеждаемся, что windowWidth актуален при первой загрузке
    if (typeof window !== 'undefined') {
      setWindowWidth(window.innerWidth);
    }
    
    window.addEventListener('resize', handleResize);
    // Также отслеживаем изменения через visualViewport для мобильных устройств
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  useEffect(() => {
    const fetchAppTheme = async () => {
      try {
        const response = await getAppSettings();
        persistAppSettingsFromApi(response?.data);
        if (response?.data?.season_theme) {
          setSeasonTheme(response.data.season_theme);
        }
        setThemeAssets(response?.data?.theme_assets ?? null);
        setAndroidRelease(normalizeAndroidRelease(response?.data?.android_release));
        applyFrontendBuildUpdate(response?.data?.frontend_build_id);
        void warmShellAssetsForTheme(response?.data?.theme_assets ?? null);
      } catch (error) {
        console.warn('Не удалось загрузить настройки оформления, используем летнюю тему.', error);
      }
    };

    fetchAppTheme();
  }, []);

  useEffect(() => {
    injectThemeAssetStyles(themeAssets);
  }, [themeAssets]);

  const handleAppearanceUpdated = useCallback((data) => {
    if (data?.season_theme) {
      setSeasonTheme(data.season_theme);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'theme_assets')) {
      setThemeAssets(data.theme_assets ?? null);
      void warmShellAssetsForTheme(data.theme_assets ?? null);
    }
    if (data) {
      persistAppSettingsFromApi(data);
    }
  }, []);

  const handleAppSettingsUpdated = useCallback((data) => {
    handleAppearanceUpdated(data);
    if (data && Object.prototype.hasOwnProperty.call(data, 'android_release')) {
      setAndroidRelease(normalizeAndroidRelease(data.android_release));
    }
  }, [handleAppearanceUpdated]);

  useEffect(() => {
    seasonThemeRef.current = seasonTheme;
    document.documentElement.classList.toggle('theme-winter', seasonTheme === 'winter');
    document.documentElement.classList.toggle('theme-summer', seasonTheme !== 'winter');
    applyTelegramTheme(seasonTheme);
  }, [seasonTheme]);

  useEffect(() => {
    // Инициализация Telegram WebApp только если он доступен
    if (tg) {
      tg.ready();
      tg.expand();
      applyTelegramTheme(seasonThemeRef.current);
      
      // Включаем подтверждение закрытия для предотвращения случайного закрытия
      tg.enableClosingConfirmation?.();
      
      // Обработчик изменения видимости viewport (когда приложение становится видимым/невидимым)
      tg.onEvent('viewportChanged', (event) => {
        console.log('Viewport changed:', event);
        // Когда приложение становится видимым, убеждаемся, что оно развернуто
        if (event.isStateVisible) {
          console.log('Viewport стал видимым, разворачиваем приложение...');
          tg.expand();
          tg.ready(); // Переподключаемся
        }
      });
      
      // Обработчик изменения видимости (для мобильных устройств)
      tg.onEvent('visibilityChanged', (event) => {
        console.log('Visibility changed:', event);
        // Когда приложение становится видимым, убеждаемся, что оно развернуто
        if (event.isVisible) {
          console.log('Приложение стало видимым, разворачиваем...');
          tg.expand();
          tg.ready(); // Переподключаемся
        } else {
          console.log('Приложение стало невидимым');
        }
      });
    }
    
    // Обработчик события visibilitychange для браузера (fallback)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && tg) {
        console.log('App became visible (visibilitychange), expanding and reconnecting...');
        // Агрессивно переподключаемся при возврате из фонового режима
        try {
          tg.expand();
          tg.ready(); // Переподключаемся к Telegram WebApp
          applyTelegramTheme(seasonThemeRef.current);
        } catch (error) {
          console.error('Ошибка при переподключении после возврата из фонового режима:', error);
        }
      } else if (document.visibilityState === 'hidden' && tg) {
        console.log('App became hidden (visibilitychange)');
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Инициализация кеша (не блокирует, выполняется параллельно)
    initializeCache().catch(err => {
      console.warn('Cache initialization failed, continuing without cache:', err);
    });
      
    const telegramUser = tg?.initDataUnsafe?.user;
    
    // Если не в Telegram WebApp, проверяем браузерную авторизацию
    if (!isTelegramWebApp || !telegramUser) {
      const savedUserId = localStorage.getItem('userId');
      const savedUser = localStorage.getItem('user');
      const adminPanelToken = localStorage.getItem(ADMIN_PANEL_TOKEN_KEY);

      const restoreAdminPanel = async () => {
        try {
          const me = await getAdminPanelMe();
          setUser(me.data.user);
          localStorage.setItem(ADMIN_PANEL_USER_KEY, JSON.stringify(me.data.user));
        } catch (err) {
          clearAdminPanelAuth();
          localStorage.removeItem(ADMIN_PANEL_USER_KEY);
          setUser(null);
        } finally {
          setLoading(false);
        }
      };

      if (adminPanelToken) {
        restoreAdminPanel();
      } else if (savedUserId && savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          setUser(parsedUser);
          if (isAndroidShell) {
            setLoading(false);
          }
        } catch (err) {
          console.error('Ошибка парсинга сохраненного пользователя:', err);
        }

        const checkBrowserUser = async () => {
          try {
            const userResponse = await checkUserStatusById(savedUserId);
            setUser(userResponse.data);
            localStorage.setItem('user', JSON.stringify(userResponse.data));
          } catch (err) {
            if (err.response && (err.response.status === 401 || err.response.status === 404)) {
              localStorage.removeItem('userId');
              localStorage.removeItem('user');
              setUser(null);
            } else {
              console.warn('Не удалось проверить статус пользователя, используем сохраненные данные:', err);
            }
          } finally {
            if (!isAndroidShell) {
              setLoading(false);
            }
          }
        };

        checkBrowserUser();
      } else {
        setLoading(false);
      }
      
      // Возвращаем функцию очистки даже при раннем выходе
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    if (telegramUser.photo_url) {
      setTelegramPhotoUrl(getTelegramPhotoProxyUrl(telegramUser.photo_url));
    }

    const fetchUser = async () => {
      try {
        // Предзагружаем данные для главной страницы параллельно с проверкой пользователя
        const [userResponse, feedResponse, bannersResponse] = await Promise.all([
          checkUserStatus(telegramUser.id),
          getFeed().catch(err => {
            console.warn('Не удалось предзагрузить feed:', err);
            return null;
          }),
          getBanners().catch(err => {
            console.warn('Не удалось предзагрузить banners:', err);
            return null;
          })
        ]);
        
        const u = userResponse.data;
        setUser(u);
        // Резерв для API до появления initDataUnsafe (иначе /sessions/start и request-update без заголовков → 401).
        localStorage.setItem('userId', String(u.id));
        localStorage.setItem('user', JSON.stringify(u));
        
        // Сохраняем предзагруженные данные в кэш для HomePage
        // Используем Promise.all для параллельного сохранения
        const cachePromises = [];
        if (feedResponse?.data) {
          cachePromises.push(setCachedData('feed', feedResponse.data));
        }
        if (bannersResponse?.data) {
          cachePromises.push(setCachedData('banners', bannersResponse.data));
          syncBannersCache(bannersResponse.data);
        }
        if (cachePromises.length > 0) {
          await Promise.all(cachePromises);
        }
      } catch (err) {
        if (err.response && err.response.status === 404) {
          console.log('Пользователь не зарегистрирован, показываем форму регистрации.');
        } else {
          console.error(err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
    
    // Очистка обработчика при размонтировании
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  
  const handleRegistrationSuccess = () => { window.location.reload(); };
  
  const handleAdminPanelLoginSuccess = (userData, accessToken) => {
    localStorage.removeItem('userId');
    localStorage.removeItem('user');
    localStorage.setItem(ADMIN_PANEL_TOKEN_KEY, accessToken);
    localStorage.setItem(ADMIN_PANEL_USER_KEY, JSON.stringify(userData));
    setUser(userData);
    setPage('admin');
  };

  const handleLoginSuccess = (userData) => {
    clearAdminPanelAuth();
    setUser(userData);
    localStorage.setItem('userId', userData.id.toString());
    localStorage.setItem('user', JSON.stringify(userData));
    if (!isTelegramWebApp && userData.status === 'approved') {
      const hasEmail = userData.email && String(userData.email).trim();
      if (!hasEmail) {
        setShowEmailPromptModal(true);
      }
    }
  };
  
  const navigate = (targetPage) => {
    setShowPendingBanner(false);
    if (targetPage === 'leaderboard' && !isDesktop) {
      setHomeSection('rating');
      setPage('home');
      return;
    }
    if (targetPage === 'home') {
      setHomeSection('feed');
    }
    setPage(targetPage);
  };

  const applyDeepLink = useCallback((rawUrl) => {
    const target = parseAppDeepLink(rawUrl, window.location.origin);
    if (!target) {
      return;
    }
    if (target.homeSection) {
      setHomeSection(target.homeSection);
    }
    if (target.feedPostId) {
      setPendingFeedPostId(target.feedPostId);
    }
    setPage(target.page);
    stripDeepLinkQueryFromLocation();
  }, [isDesktop]);
  
  const updateUser = (newUserData) => setUser(prev => ({ ...prev, ...newUserData }));

  /** Обновляет данные пользователя с сервера (баланс, спасибки и т.д.). */
  const refreshUser = useCallback(async () => {
    const telegramUser = tg?.initDataUnsafe?.user;
    if (!telegramUser && user?.id === -1) {
      const token = localStorage.getItem(ADMIN_PANEL_TOKEN_KEY);
      if (!token) return;
      try {
        const resp = await getAdminPanelMe();
        setUser(resp.data.user);
        localStorage.setItem(ADMIN_PANEL_USER_KEY, JSON.stringify(resp.data.user));
      } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
          clearAdminPanelAuth();
          setUser(null);
        }
      }
      return;
    }
    const userId = telegramUser ? null : (user?.id ?? localStorage.getItem('userId'));
    if (!telegramUser && !userId) return;
    try {
      const resp = telegramUser
        ? await checkUserStatus(telegramUser.id)
        : await checkUserStatusById(String(userId));
      setUser(resp.data);
      if (!telegramUser) {
        localStorage.setItem('user', JSON.stringify(resp.data));
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 404) {
        localStorage.removeItem('userId');
        localStorage.removeItem('user');
        setUser(null);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user || user.status !== 'approved') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshUser();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user?.id, user?.status, refreshUser]);

  /** Обновляем данные пользователя при переходе на профиль.
   *  Раньше это срабатывало и для «Магазина», но баланс там и так актуализируется
   *  при каждой покупке через onPurchaseSuccess → updateUser, а лишний
   *  checkUserStatus только замедлял открытие тяжёлой вкладки.
   */
  useEffect(() => {
    if (user?.status === 'approved' && page === 'profile') {
      refreshUser();
    }
  }, [page, user?.status, refreshUser]);

  const handlePurchaseAndUpdate = (newUserData) => {
    updateUser(newUserData);
    clearCache('market');
    clearCache('feed');
    clearCache('leaderboard');
  };

  const handleTransferSuccess = (updatedSenderData, options = {}) => {
    updateUser(updatedSenderData);
    clearCache('feed');
    clearCache('leaderboard');
    if (!options.silent) {
      navigate('home');
    }
  };
  
  const handleProfileSaveSuccess = () => {
      setShowPendingBanner(true);
      setPage('profile');
  };

  // 3. Создаем функцию-обработчик для завершения обучения
  const handleOnboardingComplete = () => {
    // Обновляем состояние пользователя локально, чтобы не перезагружать все приложение
    if (user) {
      setUser(prevUser => ({ ...prevUser, has_seen_onboarding: true }));
    }
    // Отключаем принудительный показ
    setShowOnboarding(false);
  };

  // --- 1. НОВАЯ ПЕРЕМЕННАЯ ДЛЯ УДОБСТВА ---
  // Эта переменная будет true, если нужно показать обучение, и false в противном случае.
  const isOnboardingVisible = (user && !user.has_seen_onboarding) || showOnboarding;

  useEffect(() => {
    if (loading || !user || user.status !== 'approved') {
      setBootReady(false);
      return undefined;
    }
    if (isOnboardingVisible) {
      setBootReady(true);
      return undefined;
    }

    const bootTimeoutMs = isAndroidShell ? ANDROID_BOOT_TIMEOUT_MS : 2500;
    const canShowHomeImmediately = hasWarmBootCache();

    let cancelled = false;
    if (canShowHomeImmediately) {
      setBootReady(true);
    } else {
      setBootReady(false);
    }

    preloadAppContent({ timeoutMs: bootTimeoutMs }).finally(() => {
      if (!cancelled) {
        setBootReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loading, user?.id, user?.status, isOnboardingVisible]);

  useEffect(() => {
    if (!user || user.status !== 'approved' || isOnboardingVisible || !bootReady) {
      return undefined;
    }
    applyDeepLink(window.location.href);
    return undefined;
  }, [user?.id, user?.status, isOnboardingVisible, bootReady, applyDeepLink]);

  useEffect(() => {
    if (!user || user.status !== 'approved') {
      return undefined;
    }
    function onOpenUrl(event) {
      const rawUrl = event?.detail?.url;
      if (rawUrl) {
        applyDeepLink(rawUrl);
      }
    }
    window.addEventListener('spasibo:open-url', onOpenUrl);
    return () => window.removeEventListener('spasibo:open-url', onOpenUrl);
  }, [user?.id, user?.status, applyDeepLink]);

  useEffect(() => {
    if (!isAndroidShell || !user || user.status !== 'approved') {
      return undefined;
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      getAppSettings()
        .then((response) => {
          applyFrontendBuildUpdate(response?.data?.frontend_build_id);
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [user?.id, user?.status]);

  const isAndroidBootLoading =
    loading ||
    (user?.status === 'approved' && !isOnboardingVisible && !bootReady);

  useEffect(() => {
    if (!isAndroidShell || isAndroidBootLoading) {
      return;
    }
    hideAndroidBootSplash();
  }, [isAndroidBootLoading]);
  
  const renderPage = () => {
    if (loading) {
      return androidLoadingFallback;
    }

    if (user?.status === 'approved' && !isOnboardingVisible && !bootReady) {
      return androidLoadingFallback;
    }
  
    // Если не в Telegram WebApp, показываем страницу входа или регистрации
    if (!isTelegramWebApp) {
      // Если пользователь не авторизован, показываем страницу входа или регистрации
      if (!user) {
        if (showRegistration) {
          return <RegistrationPage 
            telegramUser={null} 
            onRegistrationSuccess={handleRegistrationSuccess} 
            isWebBrowser={true}
            onBackToLogin={() => setShowRegistration(false)}
          />;
        }
        return (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onAdminPanelLoginSuccess={handleAdminPanelLoginSuccess}
            onShowRegistration={() => setShowRegistration(true)}
          />
        );
      }
      // Если пользователь авторизован, но статус pending, показываем соответствующую страницу
      // (остальная логика будет обработана ниже)
    }
  
    if (!user) {
      const telegramUser = tg?.initDataUnsafe?.user;
      if (!telegramUser) {
        // Для веб-браузера показываем страницу входа
        if (showRegistration) {
          return <RegistrationPage 
            telegramUser={null} 
            onRegistrationSuccess={handleRegistrationSuccess} 
            isWebBrowser={true}
            onBackToLogin={() => setShowRegistration(false)}
          />;
        }
        return (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onAdminPanelLoginSuccess={handleAdminPanelLoginSuccess}
            onShowRegistration={() => setShowRegistration(true)}
          />
        );
      }
      // В Telegram: выбор между "Войти" (привязка к веб-аккаунту) и "Регистрация"
      if (showLoginInTelegram) {
        return (
          <LoginPage
            telegramUser={telegramUser}
            onLoginSuccess={handleLoginSuccess}
            onAdminPanelLoginSuccess={handleAdminPanelLoginSuccess}
            onShowRegistration={() => setShowLoginInTelegram(false)}
          />
        );
      }
      return (
        <RegistrationPage
          telegramUser={telegramUser}
          onRegistrationSuccess={handleRegistrationSuccess}
          onBackToLogin={() => setShowLoginInTelegram(true)}
        />
      );
    }

    // 4. ГЛАВНАЯ ЛОГИКА: Показываем обучение, если нужно
    // Условие: (флаг в базе false ИЛИ мы включили принудительный показ)
    if (user.status === 'pending') {
      return <PendingPage />;
    }
    if (user.status === 'blocked') {
      return <BlockedPage />;
    }
    if (user.status === 'rejected') {
      return <RejectedPage />;
    }

    // 2. Только если пользователь одобрен, проверяем, видел ли он обучение.
    if (user.status === 'approved' && (!user.has_seen_onboarding || showOnboarding)) {
        return <OnboardingStories onComplete={handleOnboardingComplete} />;
    }
    
    if (user.status === 'approved') {
      const effectiveTelegramPhotoUrl =
        resolveAvatarUrl(user?.telegram_photo_url) ||
        telegramPhotoUrl ||
        getTelegramPhotoProxyUrl(user?.telegram_photo_url);
      switch (page) {
        case 'leaderboard':
          if (!isDesktop) {
            return (
              <HomePage
                user={user}
                telegramPhotoUrl={effectiveTelegramPhotoUrl}
                onNavigate={navigate}
                isDesktop={isDesktop}
                seasonTheme={seasonTheme}
                themeAssets={themeAssets}
                homeSection="rating"
                onHomeSectionChange={setHomeSection}
              />
            );
          }
          return <LeaderboardPage user={user} seasonTheme={seasonTheme} themeAssets={themeAssets} />;
        case 'roulette': return <RoulettePage user={user} onUpdateUser={updateUser} />;
        case 'marketplace': return <MarketplacePage user={user} onPurchaseSuccess={handlePurchaseAndUpdate} />;
        case 'profile': return <ProfilePage user={user} telegramPhotoUrl={effectiveTelegramPhotoUrl} onNavigate={navigate} onPurchaseSuccess={handlePurchaseAndUpdate} />;
        case 'bonus_card': return <BonusCardPage user={user} onBack={() => navigate('profile')} onUpdateUser={updateUser} />;
        case 'edit_profile': return <EditProfilePage user={user} onBack={() => navigate('profile')} onSaveSuccess={handleProfileSaveSuccess} />;
        case 'notifications': return <NotificationsPage user={user} onBack={() => navigate('profile')} />;
  case 'settings': 
    return (
      <SettingsPage 
        onBack={() => navigate('profile')} 
        onNavigate={navigate} 
        onRepeatOnboarding={() => setShowOnboarding(true)}
        user={user}
      />
    );
        case 'faq': return <FaqPage onBack={() => navigate('settings')} />;
        case 'history': return <HistoryPage user={user} onBack={() => navigate('profile')} />;
        // --- 2. ГЛАВНОЕ ИЗМЕНЕНИЕ: Передаем новую функцию в TransferPage ---
        case 'transfer': return <TransferPage user={user} onBack={() => navigate('home')} onTransferSuccess={handleTransferSuccess} />;
        case 'admin': return (
          <AdminPage
            user={user}
            seasonTheme={seasonTheme}
            themeAssets={themeAssets}
            onAppearanceUpdated={handleAppearanceUpdated}
            onAppSettingsUpdated={handleAppSettingsUpdated}
            onUserUpdated={updateUser}
          />
        );
        case 'home':
        default:
          return (
            <HomePage
              user={user}
              telegramPhotoUrl={effectiveTelegramPhotoUrl}
              onNavigate={navigate}
              isDesktop={isDesktop}
              seasonTheme={seasonTheme}
              themeAssets={themeAssets}
              homeSection={homeSection}
              onHomeSectionChange={setHomeSection}
              highlightFeedPostId={pendingFeedPostId}
              onHighlightFeedPostHandled={() => setPendingFeedPostId(null)}
            />
          );
      }
    }
    
    return <div>Неизвестный статус пользователя.</div>;
  };

  // 1. Создаем четкие флаги для отображения навигации
  const isUserApproved = user && user.status === 'approved';
  const showSideNav = isDesktop && isUserApproved && !isOnboardingVisible;
  const showBottomNav = !isDesktop && isUserApproved && !isOnboardingVisible;
  
  useSessionTracking({
    userId: user?.status === 'approved' ? user.id : undefined,
    enabled: Boolean(user?.id && user.status === 'approved'),
  });

  // --- АВТОМАТИЧЕСКАЯ ПРОВЕРКА СТАТУСА ДЛЯ ПОЛЬЗОВАТЕЛЕЙ СО СТАТУСОМ PENDING ---
  const statusCheckIntervalRef = useRef(null);

  useEffect(() => {
    // Проверяем статус только если пользователь существует и его статус 'pending'
    if (!user || user.status !== 'pending') {
      // Очищаем интервал, если статус изменился на не-pending
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
        statusCheckIntervalRef.current = null;
      }
      return;
    }

    const telegramUser = tg?.initDataUnsafe?.user;
    if (!telegramUser || !isTelegramWebApp) {
      return;
    }

    const checkStatus = async () => {
      try {
        const userResponse = await checkUserStatus(telegramUser.id);
        const newUserData = userResponse.data;
        
        // Если статус изменился, обновляем состояние пользователя
        if (newUserData.status !== user.status) {
          console.log(`Статус пользователя изменился с ${user.status} на ${newUserData.status}`);
          setUser(newUserData);
          
          // Если статус изменился на 'approved', останавливаем проверку
          if (newUserData.status === 'approved') {
            if (statusCheckIntervalRef.current) {
              clearInterval(statusCheckIntervalRef.current);
              statusCheckIntervalRef.current = null;
              console.log('Автоматическая проверка статуса остановлена: пользователь одобрен');
            }
          }
        }
      } catch (err) {
        // При ошибке просто логируем, но продолжаем проверку
        console.warn('Ошибка при проверке статуса пользователя:', err);
      }
    };

    // Очищаем предыдущий интервал, если он существует
    if (statusCheckIntervalRef.current) {
      clearInterval(statusCheckIntervalRef.current);
    }

    // Запускаем первую проверку сразу, затем каждые STATUS_CHECK_INTERVAL миллисекунд
    checkStatus();
    statusCheckIntervalRef.current = setInterval(checkStatus, STATUS_CHECK_INTERVAL);

    // Очистка интервала при размонтировании или изменении зависимостей
    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
        statusCheckIntervalRef.current = null;
        console.log('Автоматическая проверка статуса остановлена');
      }
    };
  }, [user]); // Зависимость от user, чтобы перезапускать при изменении пользователя

  // Создаем переменные, которые четко определяют, когда показывать меню
  const shouldShowSideNav = user && user.status === 'approved' && isDesktop && !isOnboardingVisible;
  const shouldShowBottomNav = user && user.status === 'approved' && !isDesktop && !isOnboardingVisible;
  
  // Проверяем, показывается ли страница входа или регистрации (для веб-версии)
  const isLoginOrRegistrationPage = !isTelegramWebApp && !user;
  
  return (
    <ThemeAssetsProvider seasonTheme={seasonTheme} themeAssets={themeAssets}>
    <div className="app-container">
      <AndroidNativeSessionBridge user={user} />
      <MobileWelcomeGuide
        user={user}
        bootReady={bootReady}
        loading={loading}
        isOnboardingVisible={isOnboardingVisible}
      />
      <PushEnablePrompt
        user={user}
        bootReady={bootReady}
        loading={loading}
        isOnboardingVisible={isOnboardingVisible}
      />
      <AndroidInstallSheet
        user={user}
        bootReady={bootReady}
        loading={loading}
        isOnboardingVisible={isOnboardingVisible}
        androidRelease={androidRelease}
        hasBottomNav={Boolean(shouldShowBottomNav)}
      />
      {/* Теперь меню показываются на основе новых, правильных переменных */}
      {shouldShowSideNav && <SideNav user={user} activePage={page} onNavigate={navigate} />}
      {shouldShowBottomNav && <BottomNav user={user} activePage={page} onNavigate={navigate} />}
      
      {/* Логика для <main>: 
          - Для страниц входа/регистрации не применяем классы wrapper
          - Для desktop всегда применяем desktop-wrapper (даже если меню не показывается)
          - Добавляем класс with-sidebar только когда боковое меню показывается
          - Для mobile применяем mobile-wrapper */}
      <main className={
        isLoginOrRegistrationPage 
          ? 'no-selection' 
          : (isDesktop 
              ? `desktop-wrapper ${shouldShowSideNav ? 'with-sidebar' : ''} ${page === 'admin' ? 'allow-selection' : 'no-selection'}` 
              : `mobile-wrapper ${page === 'admin' ? 'allow-selection' : 'no-selection'}`)
      }>
        {showPendingBanner && (
            <div className="pending-update-banner">
              ⏳ Ваши изменения отправлены на согласование администраторам.
            </div>
        )}
        <Suspense fallback={androidLoadingFallback}>
          {renderPage()}
        </Suspense>
      </main>

      {showEmailPromptModal && (
        <EmailPromptModal
          initialEmail={user?.email}
          onSave={async (email) => {
            const resp = await updateMe({ email });
            const updated = resp.data;
            updateUser(updated);
            localStorage.setItem('user', JSON.stringify(updated));
            setShowEmailPromptModal(false);
          }}
          onLater={() => setShowEmailPromptModal(false)}
        />
      )}
    </div>
    </ThemeAssetsProvider>
  );
  // --- КОНЕЦ ИЗМЕНЕНИЙ ---
}

export default App;
