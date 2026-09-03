/**
 * Мост к нативной Android-оболочке «Спасибо» (WebView + FCM).
 * Нативный код инжектирует window.SpasiboAndroid и UA SpasiboAndroid/1.
 */

import { sendTestPush } from '../api.js';

const WELCOME_PUSH_SENT_KEY = 'android_push_welcome_sent';
const PROMPT_DISMISSED_SESSION_KEY = 'android_push_prompt_dismissed_session';

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

/**
 * Регистрирует FCM-токен и отправляет приветственный push один раз.
 *
 * @returns {Promise<{ registered: boolean, welcomeSent: boolean }>}
 */
export async function registerAndroidPushAndSendWelcome() {
  const bridge = window.SpasiboAndroid;
  if (!bridge?.isNotificationPermissionGranted()) {
    return { registered: false, welcomeSent: false };
  }

  bridge.registerPushToken();
  await sleep(1800);

  const welcomeSent = await sendAndroidWelcomeTestPushIfNeeded();
  return { registered: true, welcomeSent };
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
    if ((data?.delivered ?? 0) > 0) {
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

  const { welcomeSent } = await registerAndroidPushAndSendWelcome();
  return { ok: true, welcomeSent };
}

/** Регистрирует FCM, если разрешение уже выдано (без запроса диалога). */
export async function syncAndroidPushIfAlreadyGranted() {
  if (!isSpasiboAndroidApp() || !isAndroidNativePushGranted()) {
    return;
  }
  await registerAndroidPushAndSendWelcome();
}
