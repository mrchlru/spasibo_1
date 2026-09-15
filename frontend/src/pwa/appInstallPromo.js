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
export const INSTALL_PROMO_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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
  import('./installPromoAccountState.js').then((mod) => {
    void mod.snoozeInstallPromoOnAccount();
  }).catch(() => {
    /* ignore */
  });
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
  import('./installPromoAccountState.js').then((mod) => {
    void mod.markInstallPromoDoneOnAccount(reason);
  }).catch(() => {
    /* ignore */
  });
}

/**
 * Нужно ли показать мягкое промо (без учёта welcome / loading).
 *
 * @param {AppInstallPromoPlatform | null} [platform]
 * @param {object | null | undefined} [campaign] настройки из админки (install_promo)
 * @param {{
 *   isAdmin?: boolean,
 *   userId?: number | null,
 *   accountCanShow?: boolean | null,
 * }} [options]
 */
export function shouldShowAppInstallPromo(
  platform = getAppInstallPromoPlatform(),
  campaign = null,
  options = {},
) {
  if (!platform) {
    return false;
  }
  if (platform === 'android-browser') {
    return false;
  }
  if (!isInstallPromoCampaignActive(campaign, platform)) {
    return false;
  }
  if (!isInstallPromoAudienceAllowed(campaign, options)) {
    return false;
  }
  // Ограниченная аудитория (админы / выбранные) — превью без goal/snooze.
  if (isInstallPromoRestrictedAudience(campaign)) {
    return true;
  }
  if (isAppInstallPromoGoalMet(platform)) {
    return false;
  }
  if (options.accountCanShow === false) {
    return false;
  }
  if (options.accountCanShow == null) {
    if (isAppInstallPromoDone() || isAppInstallPromoSnoozed()) {
      return false;
    }
  }
  return true;
}

export const DEFAULT_INSTALL_PROMO = {
  enabled: false,
  desktop: true,
  ios: true,
  android_browser: true,
  admins_only: false,
  allowed_user_ids: [],
  started_at: null,
  ends_at: null,
};

/**
 * Нормализует список id пользователей из настроек.
 *
 * @param {unknown} raw
 * @returns {number[]}
 */
export function normalizeInstallPromoUserIds(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids = [];
  const seen = new Set();
  raw.forEach((value) => {
    const id = Number.parseInt(String(value), 10);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

/**
 * Нормализует настройки кампании из app-settings.
 *
 * @param {object | null | undefined} raw
 */
export function normalizeInstallPromo(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_INSTALL_PROMO, allowed_user_ids: [] };
  }
  return {
    enabled: Boolean(raw.enabled),
    desktop: raw.desktop !== false,
    ios: raw.ios !== false,
    android_browser: raw.android_browser !== false,
    admins_only: Boolean(raw.admins_only),
    allowed_user_ids: normalizeInstallPromoUserIds(raw.allowed_user_ids),
    started_at: typeof raw.started_at === 'string' ? raw.started_at : null,
    ends_at: typeof raw.ends_at === 'string' ? raw.ends_at : null,
  };
}

/**
 * Кампания ограничена админами и/или списком пользователей.
 *
 * @param {object | null | undefined} campaign
 */
export function isInstallPromoRestrictedAudience(campaign) {
  const normalized = normalizeInstallPromo(campaign);
  return normalized.admins_only || normalized.allowed_user_ids.length > 0;
}

/**
 * Текущий пользователь входит в аудиторию кампании.
 *
 * @param {object | null | undefined} campaign
 * @param {{ isAdmin?: boolean, userId?: number | null }} [options]
 */
export function isInstallPromoAudienceAllowed(campaign, options = {}) {
  const normalized = normalizeInstallPromo(campaign);
  if (!isInstallPromoRestrictedAudience(normalized)) {
    return true;
  }
  if (normalized.admins_only && options.isAdmin) {
    return true;
  }
  const userId = Number.parseInt(String(options.userId ?? ''), 10);
  if (Number.isFinite(userId) && normalized.allowed_user_ids.includes(userId)) {
    return true;
  }
  return false;
}

/**
 * Ставит окно кампании на месяц от сейчас.
 *
 * @param {Date} [from]
 */
export function buildInstallPromoSchedule(from = new Date()) {
  const started = new Date(from);
  const ends = new Date(started.getTime() + INSTALL_PROMO_DURATION_MS);
  return {
    started_at: started.toISOString(),
    ends_at: ends.toISOString(),
  };
}

/**
 * Кампания ещё не истекла по ends_at.
 *
 * @param {object | null | undefined} campaign
 */
export function isInstallPromoWithinSchedule(campaign) {
  const normalized = normalizeInstallPromo(campaign);
  if (!normalized.ends_at) {
    return true;
  }
  const endsMs = Date.parse(normalized.ends_at);
  if (!Number.isFinite(endsMs)) {
    return true;
  }
  return endsMs > Date.now();
}

/**
 * Кампания включена в админке для данной платформы.
 *
 * @param {object | null | undefined} campaign
 * @param {AppInstallPromoPlatform | 'android-browser' | null} platform
 */
export function isInstallPromoCampaignActive(campaign, platform) {
  const normalized = normalizeInstallPromo(campaign);
  if (!normalized.enabled) {
    return false;
  }
  if (!isInstallPromoWithinSchedule(normalized)) {
    return false;
  }
  if (platform === 'desktop') {
    return normalized.desktop;
  }
  if (platform === 'ios-browser') {
    return normalized.ios;
  }
  if (platform === 'android-browser') {
    return normalized.android_browser;
  }
  return false;
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
