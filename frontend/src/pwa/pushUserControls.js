import { sendTestPush, unsubscribePush } from '../api.js';
import {
  disableAndroidNativePush,
  enableAndroidNativePush,
  isAndroidNativePushGranted,
  isAndroidPushReady,
  isSpasiboAndroidApp,
} from './androidNativePush.js';
import {
  getMobileWelcomePlatform,
  areMobileNotificationsEnabled,
} from './mobileWelcomeGuide.js';
import {
  enablePushFromUserGesture,
  getNotificationPermission,
  hasBrowserPushSubscription,
  startNotificationPermissionRequest,
} from './pushNotifications.js';
import {
  getPushBlockReason,
  isIosDevice,
  isPushApiAvailable,
  isStandaloneDisplayMode,
  pushBlockReasonMessage,
} from './pushEnvironment.js';

export const PUSH_PROMPT_DISMISSED_SESSION_KEY = 'spasibo_push_prompt_dismissed_session';

/** Платформы, где показываем промпт включения push при входе. */
export function isPushPromptPlatform() {
  const platform = getMobileWelcomePlatform();
  return platform === 'android-app' || platform === 'ios-standalone';
}

/** Скрывает промпт до конца сессии. */
export function dismissPushPromptForSession() {
  try {
    sessionStorage.setItem(PUSH_PROMPT_DISMISSED_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Нужно ли показывать промпт включения push. */
export function shouldShowPushPromptThisSession() {
  try {
    if (sessionStorage.getItem(PUSH_PROMPT_DISMISSED_SESSION_KEY) === '1') {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

/** Push включён на текущем устройстве. */
export async function isPushEnabledForUser() {
  if (isSpasiboAndroidApp()) {
    return isAndroidPushReady();
  }
  if (!isPushApiAvailable()) {
    return false;
  }
  const platform = getMobileWelcomePlatform();
  if (platform) {
    return areMobileNotificationsEnabled(platform);
  }
  if (getNotificationPermission() === 'granted') {
    return hasBrowserPushSubscription();
  }
  return false;
}

/** Включает push и отправляет тестовое уведомление. */
export async function enablePushWithTestPush() {
  if (isSpasiboAndroidApp()) {
    const result = await enableAndroidNativePush();
    if (!result.ok) {
      return result;
    }
    const testResult = await sendWelcomeTestPush();
    return {
      ok: true,
      welcomeSent: testResult.sent,
      detail: testResult.sent
        ? 'Уведомления включены! Тестовое сообщение уже в пути.'
        : 'Уведомления включены.',
    };
  }

  const blockReason = getPushBlockReason();
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }

  const permissionPromise = startNotificationPermissionRequest();
  const result = await enablePushFromUserGesture(permissionPromise);
  if (!result.ok) {
    return result;
  }

  const testResult = await sendWelcomeTestPush();
  return {
    ok: true,
    welcomeSent: testResult.sent,
    detail: testResult.sent
      ? 'Уведомления включены! Тестовое сообщение уже в пути.'
      : 'Уведомления включены.',
  };
}

/** Отключает push на сервере и в браузере / Android. */
export async function disablePushForUser() {
  if (isSpasiboAndroidApp()) {
    await disableAndroidNativePush();
    return { ok: true };
  }

  if (!isPushApiAvailable()) {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await unsubscribePush(subscription.endpoint);
      await subscription.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unsubscribe_failed' };
  }
}

/** Отправляет тестовый push текущему пользователю. */
export async function sendWelcomeTestPush() {
  try {
    const isAndroidApp = isSpasiboAndroidApp();
    const { data } = await sendTestPush({
      title: 'Уведомления включены',
      body: isAndroidApp
        ? 'Всё отлично! Push-уведомления «Спасибо» работают.'
        : 'Всё отлично! Вы будете получать спасибки и новости.',
      url: '/',
    });
    const delivered = (data?.delivered ?? 0) > 0 || (data?.fcm_delivered ?? 0) > 0;
    return { sent: delivered, data };
  } catch {
    return { sent: false, data: null };
  }
}

/** Сообщение об ошибке включения push. */
export function formatPushEnableError(result) {
  if (result?.detail && typeof result.detail === 'string') {
    return result.detail;
  }
  return pushBlockReasonMessage(result?.reason ?? 'unknown');
}

/** Доступны ли элементы управления push в настройках. */
export function arePushSettingsAvailable() {
  return isSpasiboAndroidApp() || isPushApiAvailable();
}

/** iOS в Safari без иконки на экране — только подсказка. */
export function isIosInstallRequiredForPush() {
  return isIosDevice() && !isStandaloneDisplayMode();
}

/** Системное разрешение выдано (без проверки подписки на сервере). */
export function isPushPermissionGrantedSync() {
  if (isSpasiboAndroidApp()) {
    return isAndroidNativePushGranted();
  }
  return getNotificationPermission() === 'granted';
}
