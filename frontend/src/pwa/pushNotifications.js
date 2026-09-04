import { registerServiceWorker } from './registerServiceWorker.js';
import {
  getPushBlockReason,
  isIosDevice,
  isNotificationSupported,
  isServiceWorkerSupported,
} from './pushEnvironment.js';
import { getVapidPublicKey, subscribePush } from '../api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensureServiceWorkerReady() {
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready.catch(() => null));
  if (!registration?.active) {
    await registration?.update().catch(() => undefined);
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return registration;
    }
  }
  return registration;
}

/**
 * Запускает запрос разрешения синхронно в обработчике клика.
 * На Android (Яндекс.Бrowser) вызов до await обязателен, иначе плашка не появится.
 */
export function startNotificationPermissionRequest() {
  if (!isNotificationSupported()) {
    return null;
  }
  if (Notification.permission !== 'default') {
    return Promise.resolve(Notification.permission);
  }
  return Notification.requestPermission();
}

/** Подписывает пользователя на Web Push и сохраняет подписку на backend. */
export async function subscribeToPushNotifications(options = {}) {
  const blockReason = getPushBlockReason({ skipPermissionCheck: options.permission === 'granted' });
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }

  if (!isNotificationSupported() || !isServiceWorkerSupported()) {
    return { ok: false, reason: isIosDevice() ? 'ios_needs_standalone' : 'unsupported_browser' };
  }

  let permission = options.permission ?? Notification.permission;
  let registration;

  if (isIosDevice()) {
    registration = await ensureServiceWorkerReady();
    if (!registration) {
      return { ok: false, reason: 'service_worker_unavailable' };
    }
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
  } else if (permission === 'default') {
    return { ok: false, reason: 'permission_dismissed', detail: 'permission not requested in user gesture' };
  } else {
    registration = await ensureServiceWorkerReady();
    if (!registration) {
      return { ok: false, reason: 'service_worker_unavailable' };
    }
  }

  if (permission === 'denied') {
    return { ok: false, reason: 'permission_denied' };
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission_dismissed' };
  }

  if (!registration) {
    registration = await ensureServiceWorkerReady();
  }
  if (!registration?.pushManager) {
    return { ok: false, reason: 'unsupported_browser', detail: 'pushManager unavailable' };
  }

  const vapid = await getVapidPublicKey();
  if (!vapid.enabled || !vapid.public_key) {
    return { ok: false, reason: 'server_disabled' };
  }

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      /* Старая подписка могла быть с другим VAPID-ключом. */
    }
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.public_key),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: 'subscribe_failed', detail };
    }
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'subscribe_failed', detail: 'empty subscription keys' };
  }

  await subscribePush({
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });

  return { ok: true };
}

/** Проверяет, есть ли активная push-подписка в браузере. */
export async function hasBrowserPushSubscription() {
  if (!isServiceWorkerSupported() || !isNotificationSupported()) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/** Возвращает текущий статус разрешения на уведомления. */
export function getNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** Подключает push из жеста пользователя (кнопка в настройках). */
export async function enablePushFromUserGesture(permissionPromise) {
  if (!isNotificationSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  const blockReason = getPushBlockReason();
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }

  const permission = permissionPromise
    ? await permissionPromise
    : getNotificationPermission();

  if (permission === 'denied') {
    return { ok: false, reason: 'permission_denied' };
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission_dismissed' };
  }

  const result = await subscribeToPushNotifications({ permission });
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, reason: result.reason };
}
