/**
 * Мягкое промо установки «Спасибо» (ПК / iOS Safari / Android-браузер).
 * Показ не чаще раза в 3 дня, пока цель не выполнена.
 */

import { isSpasiboAndroidApp } from './androidNativePush.js';
import { isAndroidMobileBrowser } from './mobileWelcomeGuide.js';
import {
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplayMode,
} from './pushEnvironment.js';
import {
  getNotificationPermission,
  hasBrowserPushSubscription,
} from './pushNotifications.js';

export const APP_INSTALL_PROMO_SNOOZE_KEY = 'spasibo_app_install_promo_snooze_until';
export const APP_INSTALL_PROMO_DONE_KEY = 'spasibo_app_install_promo_done';
export const APP_INSTALL_PROMO_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
export const APP_INSTALL_PROMO_SHOW_DELAY_MS = 1600;

/** @typedef {'desktop' | 'ios-browser' | 'android-browser'} AppInstallPromoPlatform */

/** @type {Event | null} */
let deferredPwaInstallPrompt = null;
let pwaInstallListenerBound = false;

/**
 * Подписывается на beforeinstallprompt (Chrome / Edge на ПК и Android).
 */
export function bindPwaInstallPromptCapture() {
  if (typeof window === 'undefined' || pwaInstallListenerBound) {
    return;
  }
  pwaInstallListenerBound = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('spasibo:pwa-install-available'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    markAppInstallPromoDone('pwa_installed');
  });
}

/** Есть ли отложенный системный промпт установки PWA. */
export function hasDeferredPwaInstallPrompt() {
  return Boolean(deferredPwaInstallPrompt);
}

/**
 * Запускает системный диалог установки PWA.
 *
 * @returns {Promise<{ ok: boolean, outcome?: string, reason?: string }>}
 */
export async function promptDeferredPwaInstall() {
  if (!deferredPwaInstallPrompt) {
    return { ok: false, reason: 'unavailable' };
  }
  const promptEvent = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      markAppInstallPromoDone('pwa_installed');
      return { ok: true, outcome: 'accepted' };
    }
    return { ok: false, outcome: choice?.outcome || 'dismissed', reason: 'dismissed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Платформа для мягкого промо или null, если не нужно.
 *
 * @returns {AppInstallPromoPlatform | null}
 */
export function getAppInstallPromoPlatform() {
  if (typeof window === 'undefined') {
    return null;
  }
  if (isSpasiboAndroidApp()) {
    return null;
  }
  if (isIosDevice()) {
    return isStandaloneDisplayMode() ? null : 'ios-browser';
  }
  if (isAndroidMobileBrowser()) {
    return 'android-browser';
  }
  if (isAndroidDevice()) {
    return 'desktop';
  }
  return 'desktop';
}

/** Ссылка для QR: тот же origin, чтобы вход был бесшовным. */
export function getAppInstallPromoShareUrl() {
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.origin}/`;
}

/** URL картинки QR-кода. */
export function buildAppInstallQrImageUrl(shareUrl) {
  const data = encodeURIComponent(shareUrl || getAppInstallPromoShareUrl());
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=M&margin=10&data=${data}`;
}

/** Цель промо уже достигнута на этом клиенте. */
export function isAppInstallPromoGoalMet(platform = getAppInstallPromoPlatform()) {
  if (!platform) {
    return true;
  }
  if (platform === 'ios-browser') {
    return isStandaloneDisplayMode();
  }
  if (platform === 'android-browser') {
    return isSpasiboAndroidApp();
  }
  if (platform === 'desktop') {
    if (isAppInstallPromoDone()) {
      return true;
    }
    return getNotificationPermission() === 'granted';
  }
  return false;
}

/** Пользователь нажал «Позже» — ждём cooldown. */
export function isAppInstallPromoSnoozed() {
  try {
    const until = Number.parseInt(localStorage.getItem(APP_INSTALL_PROMO_SNOOZE_KEY) || '0', 10);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

/** Пользователь завершил десктоп-сценарий (уведомления / PWA). */
export function isAppInstallPromoDone() {
  try {
    return Boolean(localStorage.getItem(APP_INSTALL_PROMO_DONE_KEY));
  } catch {
    return false;
  }
}

/** Скрывает промо на 3 дня. */
export function snoozeAppInstallPromo() {
  try {
    const until = Date.now() + APP_INSTALL_PROMO_COOLDOWN_MS;
    localStorage.setItem(APP_INSTALL_PROMO_SNOOZE_KEY, String(until));
    window.dispatchEvent(new CustomEvent('spasibo:app-install-promo-snoozed'));
  } catch {
    /* ignore */
  }
}

/**
 * Помечает промо выполненным (больше не показывать на этом браузере).
 *
 * @param {string} [reason]
 */
export function markAppInstallPromoDone(reason = 'done') {
  try {
    localStorage.setItem(APP_INSTALL_PROMO_DONE_KEY, String(reason));
    localStorage.removeItem(APP_INSTALL_PROMO_SNOOZE_KEY);
    window.dispatchEvent(new CustomEvent('spasibo:app-install-promo-done'));
  } catch {
    /* ignore */
  }
}

/**
 * Нужно ли показать мягкое промо (без учёта welcome / loading).
 *
 * @param {AppInstallPromoPlatform | null} [platform]
 */
export function shouldShowAppInstallPromo(platform = getAppInstallPromoPlatform()) {
  if (!platform) {
    return false;
  }
  if (platform === 'android-browser') {
    return false;
  }
  if (isAppInstallPromoGoalMet(platform)) {
    return false;
  }
  if (isAppInstallPromoSnoozed()) {
    return false;
  }
  return true;
}

/**
 * Асинхронно проверяет, включены ли уже push на десктопе.
 *
 * @returns {Promise<boolean>}
 */
export async function isDesktopPushAlreadyEnabled() {
  if (getNotificationPermission() !== 'granted') {
    return false;
  }
  try {
    return await hasBrowserPushSubscription();
  } catch {
    return true;
  }
}
