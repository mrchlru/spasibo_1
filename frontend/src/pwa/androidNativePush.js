/**
 * Мост к нативной Android-оболочке «Спасибо» (WebView + FCM).
 * Нативный код инжектирует window.SpasiboAndroid и UA SpasiboAndroid/1.
 */

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

/** Включает push через FCM в Android WebView (без Web Push / Service Worker). */
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

  bridge.registerPushToken();
  await sleep(1500);
  return { ok: true };
}

/** True, если системное разрешение на уведомления уже выдано. */
export function isAndroidNativePushGranted() {
  return Boolean(window.SpasiboAndroid?.isNotificationPermissionGranted());
}

/** Запрашивает разрешение и регистрирует FCM после входа (без блокировки UI). */
export async function requestAndroidNotificationPermissionAfterLogin() {
  const bridge = window.SpasiboAndroid;
  if (!bridge) {
    return;
  }
  if (bridge.isNotificationPermissionGranted()) {
    bridge.registerPushToken();
    return;
  }
  bridge.requestNotificationPermission();
  const granted = await waitForAndroidNotificationPermission(30_000);
  if (granted) {
    bridge.registerPushToken();
  }
}
