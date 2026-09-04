/**
 * Мост к нативной Android-оболочке «Спасибо» (WebView + FCM).
 * Нативный код инжектирует window.SpasiboAndroid и UA SpasiboAndroid/1.
 */

import { getAndroidPushStatus, sendTestPush, unregisterAndroidPush } from '../api.js';

const WELCOME_PUSH_SENT_KEY = 'android_push_welcome_sent';
const PROMPT_DISMISSED_SESSION_KEY = 'android_push_prompt_dismissed_session';

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Скрывает нативный splash с биением сердца после загрузки PWA. */
export function hideAndroidBootSplash() {
  window.SpasiboAndroid?.hideBootSplash?.();
}

/** Приложение открыто в Android WebView «Спасибо», а не в браузере. */
export function isSpasiboAndroidApp() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.SpasiboAndroid) {
    return true;
  }
  return /SpasiboAndroid\/\d/i.test(navigator.userAgent);
}

/** Передаёт сессию в нативную оболочку для регистрации FCM-токена. */
export function syncAndroidNativeSession(userId, apiBaseUrl) {
  window.SpasiboAndroid?.syncSession(Number(userId), String(apiBaseUrl));
}

/** Сбрасывает сессию в нативной оболочке (logout). */
export function clearAndroidNativeSession() {
  window.SpasiboAndroid?.clearSession();
}

/** True, если системное разрешение на уведомления уже выдано. */
export function isAndroidNativePushGranted() {
  return Boolean(window.SpasiboAndroid?.isNotificationPermissionGranted());
}

/** Нужно ли показывать промпт включения push при входе в Android-приложение. */
export function shouldShowAndroidPushPrompt() {
  if (!isSpasiboAndroidApp()) {
    return false;
  }
  if (isAndroidNativePushGranted()) {
    return false;
  }
  try {
    return sessionStorage.getItem(PROMPT_DISMISSED_SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Скрывает промпт до конца текущей сессии (кнопка «Не сейчас»). */
export function dismissAndroidPushPromptForSession() {
  try {
    sessionStorage.setItem(PROMPT_DISMISSED_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

async function waitForAndroidNotificationPermission(timeoutMs) {
  const bridge = window.SpasiboAndroid;
  if (!bridge) {
    return false;
  }
  if (bridge.isNotificationPermissionGranted()) {
    return true;
  }

  const done = new Promise((resolve) => {
    const handler = (event) => {
      const detail = event.detail;
      window.removeEventListener('spasibo:notification-permission', handler);
      resolve(Boolean(detail?.granted));
    };
    window.addEventListener('spasibo:notification-permission', handler);
  });

  const poll = (async () => {
    const step = 400;
    let waited = 0;
    while (waited < timeoutMs) {
      if (bridge.isNotificationPermissionGranted()) {
        return true;
      }
      await sleep(step);
      waited += step;
    }
    return bridge.isNotificationPermissionGranted();
  })();

  const fromEvent = await Promise.race([done, sleep(timeoutMs).then(() => null)]);
  if (fromEvent === true) {
    return true;
  }
  if (fromEvent === false) {
    return false;
  }
  return poll;
}

const ANDROID_PUSH_SERVER_WAIT_MS = 25_000;

function readNativePushRegistrationStatus() {
  try {
    const raw = window.SpasiboAndroid?.getPushRegistrationStatus?.();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Нативная регистрация FCM на сервере прошла успешно. */
function isNativePushRegistrationOk() {
  return Boolean(readNativePushRegistrationStatus()?.ok);
}

/** Явный сбой получения/отправки FCM-токена (не просто «ещё не успело»). */
function hasNativePushRegistrationHardFailure() {
  const status = readNativePushRegistrationStatus();
  if (!status || status.ok || status.detail === 'not_attempted') {
    return false;
  }
  const detail = String(status.detail ?? '').toLowerCase();
  return (
    detail.includes('fcm token unavailable')
    || detail.includes('network error')
    || detail.includes('unable to resolve host')
  );
}

async function waitForAndroidPushRegisteredOnServer(timeoutMs = ANDROID_PUSH_SERVER_WAIT_MS) {
  const step = 500;
  let waited = 0;
  while (waited < timeoutMs) {
    if (isNativePushRegistrationOk()) {
      try {
        const status = await getAndroidPushStatus();
        if (status.tokens_registered > 0) {
          return status;
        }
      } catch {
        /* сервер ещё не видит токен */
      }
      return {
        fcm_enabled: true,
        tokens_registered: 1,
        ready: true,
      };
    }
    try {
      const status = await getAndroidPushStatus();
      if (status.tokens_registered > 0) {
        return status;
      }
    } catch {
      /* сервер ещё не видит токен */
    }
    await sleep(step);
    waited += step;
  }
  try {
    return await getAndroidPushStatus();
  } catch {
    return { fcm_enabled: false, tokens_registered: 0, ready: false };
  }
}

/**
 * Гарантирует регистрацию FCM-токена на сервере.
 *
 * @param {{ skipWelcome?: boolean, maxWaitMs?: number, forceRegister?: boolean }} [options]
 */
export async function ensureAndroidPushRegistered(options = {}) {
  const maxWaitMs = options.maxWaitMs ?? ANDROID_PUSH_SERVER_WAIT_MS;
  const forceRegister = options.forceRegister ?? false;

  if (!isAndroidNativePushGranted()) {
    return { registered: false, tokensRegistered: 0 };
  }

  if (!forceRegister) {
    if (isNativePushRegistrationOk()) {
      return { registered: true, tokensRegistered: 1 };
    }
    try {
      const status = await getAndroidPushStatus();
      if (status.tokens_registered > 0) {
        return {
          registered: true,
          tokensRegistered: status.tokens_registered,
        };
      }
    } catch {
      /* проверим после registerPushToken */
    }
  }

  window.SpasiboAndroid?.registerPushToken();
  const status = await waitForAndroidPushRegisteredOnServer(maxWaitMs);
  const registered = status.tokens_registered > 0 || isNativePushRegistrationOk();
  return {
    registered,
    tokensRegistered: Math.max(status.tokens_registered, registered ? 1 : 0),
  };
}

/**
 * Регистрирует FCM-токен и отправляет приветственный push один раз.
 *
 * @returns {Promise<{ registered: boolean, welcomeSent: boolean, tokensRegistered?: number }>}
 */
export async function registerAndroidPushAndSendWelcome(options = {}) {
  const registration = await ensureAndroidPushRegistered({
    maxWaitMs: options.maxWaitMs ?? ANDROID_PUSH_SERVER_WAIT_MS,
    forceRegister: options.forceRegister,
  });
  if (!registration.registered) {
    return {
      registered: false,
      welcomeSent: false,
      tokensRegistered: 0,
    };
  }

  const welcomeSent = await sendAndroidWelcomeTestPushIfNeeded();
  return {
    registered: true,
    welcomeSent,
    tokensRegistered: registration.tokensRegistered,
  };
}

/**
 * Отправляет тестовый push «уведомления включены», если ещё не отправляли.
 *
 * @returns {Promise<boolean>}
 */
export async function sendAndroidWelcomeTestPushIfNeeded() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    if (localStorage.getItem(WELCOME_PUSH_SENT_KEY) === '1') {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const { data } = await sendTestPush({
      title: 'Уведомления включены',
      body: 'Push-уведомления «Спасибо» работают. Вы будете получать новости и спасибки.',
      url: '/',
    });
    if ((data?.fcm_delivered ?? 0) > 0 || ((data?.delivered ?? 0) > 0 && (data?.fcm_tokens ?? 0) > 0)) {
      try {
        localStorage.setItem(WELCOME_PUSH_SENT_KEY, '1');
      } catch {
        /* ignore */
      }
      return true;
    }
  } catch {
    /* токен мог ещё не успеть зарегистрироваться на сервере */
  }
  return false;
}

/** Возвращает сохранённый FCM-токен из нативной оболочки. */
export function getAndroidFcmToken() {
  return window.SpasiboAndroid?.getFcmToken?.()?.trim() || '';
}

/** Отключает FCM на сервере для этого устройства. */
export async function disableAndroidNativePush() {
  const bridge = window.SpasiboAndroid;
  if (!bridge) {
    return { ok: false, reason: 'unsupported_browser' };
  }

  bridge.unregisterPushToken?.();

  const token = getAndroidFcmToken();
  if (token) {
    try {
      await unregisterAndroidPush(token);
    } catch {
      /* нативный unregister всё равно мог отработать */
    }
  }

  return { ok: true };
}

/**
 * Включает push через FCM в Android WebView (жест пользователя → системный диалог).
 *
 * @returns {Promise<{ ok: boolean, reason?: string, detail?: string, welcomeSent?: boolean }>}
 */
export async function enableAndroidNativePush() {
  const bridge = window.SpasiboAndroid;
  if (!bridge) {
    return { ok: false, reason: 'unsupported_browser' };
  }

  if (!bridge.isNotificationPermissionGranted()) {
    bridge.requestNotificationPermission();
    const granted = await waitForAndroidNotificationPermission(45_000);
    if (!granted) {
      bridge.openAppNotificationSettings?.();
      return {
        ok: false,
        reason: 'permission_dismissed',
        detail: 'Разрешите уведомления в настройках приложения «Спасибо»',
      };
    }
  }

  window.SpasiboAndroid?.registerPushToken();
  const registration = await registerAndroidPushAndSendWelcome({ forceRegister: true });

  if (registration.registered) {
    return { ok: true, welcomeSent: registration.welcomeSent };
  }

  if (isNativePushRegistrationOk()) {
    void sendAndroidWelcomeTestPushIfNeeded();
    return { ok: true, welcomeSent: false, pendingSync: true };
  }

  if (isAndroidNativePushGranted() && !hasNativePushRegistrationHardFailure()) {
    void ensureAndroidPushRegistered({ maxWaitMs: ANDROID_PUSH_SERVER_WAIT_MS, forceRegister: true });
    return { ok: true, welcomeSent: false, pendingSync: true };
  }

  return {
    ok: false,
    reason: 'fcm_token_missing',
    detail: 'Не удалось подключить уведомления. Проверьте интернет и Google Play Services на телефоне.',
  };
}

/** Проверяет, зарегистрирован ли FCM-токен этого телефона на сервере. */
export async function fetchAndroidPushServerStatus() {
  if (!isSpasiboAndroidApp()) {
    return { fcm_enabled: false, tokens_registered: 0, ready: false };
  }
  return getAndroidPushStatus();
}

/** Push на Android готов: разрешение выдано и (токен на сервере или нативная регистрация ok). */
export async function isAndroidPushReady() {
  if (!isAndroidNativePushGranted()) {
    return false;
  }
  if (isNativePushRegistrationOk()) {
    return true;
  }
  try {
    const status = await getAndroidPushStatus();
    return Boolean(status.ready);
  } catch {
    return false;
  }
}

/** Регистрирует FCM в фоне после входа (не блокирует UI). */
export function syncAndroidPushIfAlreadyGranted() {
  if (!isSpasiboAndroidApp() || !isAndroidNativePushGranted()) {
    return;
  }
  void registerAndroidPushAndSendWelcome();
}
