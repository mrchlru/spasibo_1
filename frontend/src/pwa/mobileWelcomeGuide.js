/**
 * Показ приветственной карусели на телефонах (Android / iOS).
 */

import { isSpasiboAndroidApp, isAndroidNativePushGranted, enableAndroidNativePush } from './androidNativePush.js';
import {
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplayMode,
  getPushBlockReason,
} from './pushEnvironment.js';
import {
  enablePushFromUserGesture,
  getNotificationPermission,
  hasBrowserPushSubscription,
  startNotificationPermissionRequest,
} from './pushNotifications.js';

export const MOBILE_WELCOME_VERSION = '1';
export const MOBILE_WELCOME_STORAGE_KEY = 'spasibo_mobile_welcome_seen';

/** @typedef {'android-app' | 'ios-standalone' | 'ios-browser' | 'android-browser'} MobileWelcomePlatform */

/** Возвращает платформу или null для десктопа / нецелевых клиентов. */
export function getMobileWelcomePlatform() {
  if (isSpasiboAndroidApp()) {
    return 'android-app';
  }
  if (isIosDevice()) {
    return isStandaloneDisplayMode() ? 'ios-standalone' : 'ios-browser';
  }
  if (isAndroidDevice() && typeof window !== 'undefined' && window.innerWidth < 768) {
    return 'android-browser';
  }
  return null;
}

/** Нужна ли карусель на этом устройстве. */
export function isMobileWelcomePlatform() {
  return getMobileWelcomePlatform() !== null;
}

/** Уже показывали текущую версию гида. */
export function isMobileWelcomeSeen() {
  try {
    return localStorage.getItem(MOBILE_WELCOME_STORAGE_KEY) === MOBILE_WELCOME_VERSION;
  } catch {
    return false;
  }
}

/** Запоминает, что гид просмотрен. */
export function markMobileWelcomeSeen() {
  try {
    localStorage.setItem(MOBILE_WELCOME_STORAGE_KEY, MOBILE_WELCOME_VERSION);
  } catch {
    /* ignore */
  }
}

/** Синхронная проверка: включены ли уже уведомления. */
export function areMobileNotificationsEnabledSync(platform) {
  if (platform === 'android-app') {
    return isAndroidNativePushGranted();
  }
  if (platform === 'ios-browser') {
    return false;
  }
  return getNotificationPermission() === 'granted';
}

/** Асинхронная проверка подписки (iOS / браузер). */
export async function areMobileNotificationsEnabled(platform) {
  if (platform === 'android-app') {
    return isAndroidNativePushGranted();
  }
  if (platform === 'ios-browser') {
    return false;
  }
  if (getNotificationPermission() === 'granted') {
    return hasBrowserPushSubscription();
  }
  return false;
}

/** Включение уведомлений из карусели (по клику пользователя). */
export async function enableMobileNotifications(platform) {
  if (platform === 'android-app') {
    return enableAndroidNativePush();
  }
  if (platform === 'ios-browser') {
    return { ok: false, reason: 'ios_needs_standalone' };
  }
  const blockReason = getPushBlockReason();
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }
  const permissionPromise = startNotificationPermissionRequest();
  return enablePushFromUserGesture(permissionPromise);
}

/**
 * Слайды карусели.
 *
 * @param {object} options
 * @param {MobileWelcomePlatform} options.platform
 * @param {boolean} options.notificationsEnabled
 */
export function buildMobileWelcomeSlides({ platform, notificationsEnabled }) {
  /** @type {Array<object>} */
  const slides = [
    {
      id: 'welcome',
      title: 'Добро пожаловать!',
      text: 'Это «Спасибо» — место, где коллеги благодарят друг друга, читают новости и выбирают подарки в магазине.',
      visual: 'welcome',
    },
    {
      id: 'features',
      title: 'Что здесь есть',
      text: 'Отправляйте спасибки, смотрите ленту, заглядывайте в магазин и следите за рейтингом — всё в нижнем меню.',
      visual: 'features',
    },
  ];

  if (platform === 'ios-browser') {
    slides.push({
      id: 'ios-home',
      title: 'Сначала — иконка на экране',
      text: 'На iPhone приложение работает с главного экрана. Нажмите «Поделиться» в Safari и выберите «На экран Домой».',
      visual: 'ios-home',
    });
  }

  if (notificationsEnabled) {
    slides.push({
      id: 'notifications-ok',
      title: 'Уведомления уже включены',
      text: 'Отлично! Вы будете получать спасибки и новости, даже когда приложение закрыто.',
      visual: 'notifications-ok',
      isNotificationSlide: true,
    });
  } else if (platform === 'android-app') {
    slides.push({
      id: 'notifications-android',
      title: 'Включите уведомления',
      text: 'Так вы не пропустите спасибки, новости и напоминания — даже если телефон лежит в кармане.',
      visual: 'notifications-android',
      isNotificationSlide: true,
    });
  } else if (platform === 'ios-standalone') {
    slides.push({
      id: 'notifications-ios',
      title: 'Включите уведомления',
      text: 'Нажмите зелёную кнопку — iPhone спросит разрешение. Выберите «Разрешить».',
      visual: 'notifications-ios',
      isNotificationSlide: true,
    });
  } else if (platform === 'android-browser') {
    slides.push({
      id: 'notifications-browser',
      title: 'Включите уведомления',
      text: 'Нажмите кнопку ниже — в окне браузера выберите «Разрешить», чтобы получать новости и спасибки.',
      visual: 'notifications-browser',
      isNotificationSlide: true,
    });
  }

  slides.push({
    id: 'done',
    title: 'Готово!',
    text: 'Приятного пользования. Если что — загляните в Профиль → Настройки, там всегда можно включить уведомления.',
    visual: 'done',
  });

  return slides;
}
