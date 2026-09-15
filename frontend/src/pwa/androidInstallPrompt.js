/**
 * Промпт установки / обновления Android APK (браузер и нативная оболочка).
 */

import { getSpasiboAndroidVersionCode, isSpasiboAndroidApp } from './androidNativePush.js';
import {
  isAppInstallPromoSnoozed,
  isInstallPromoAudienceAllowed,
  isInstallPromoCampaignActive,
  isInstallPromoRestrictedAudience,
  snoozeAppInstallPromo,
} from './appInstallPromo.js';
import { isAndroidMobileBrowser } from './mobileWelcomeGuide.js';

export const ANDROID_INSTALL_DISMISS_KEY = 'spasibo_android_install_dismissed_code';

/** @typedef {'install' | 'update'} AndroidInstallPromptMode */

/** Дефолты, если в app-settings ещё ничего не задано. */
export const DEFAULT_ANDROID_RELEASE = {
  enabled: false,
  version_code: 0,
  version_name: '1.0.0',
  apk_url: '',
  title: 'Установите приложение «Спасибо»',
  description:
    'Быстрее открывается, приходят push-уведомления и удобнее пользоваться с телефона.',
  release_notes: '',
  update_title: 'Доступно обновление «Спасибо»',
  update_description: 'Установите новую версию — так приложение будет работать стабильнее.',
};

/** Android в мобильном браузере или в APK «Спасибо». */
export function getAndroidInstallPromptMode() {
  if (isSpasiboAndroidApp()) {
    return 'update';
  }
  if (isAndroidMobileBrowser()) {
    return 'install';
  }
  return null;
}

/** @deprecated Используйте getAndroidInstallPromptMode(). */
export function isAndroidInstallPromptPlatform() {
  return getAndroidInstallPromptMode() !== null;
}

/**
 * Пользователь скрыл промпт: установка — snooze 3 дня; обновление — до новой version_code.
 *
 * @param {object | null | undefined} release
 */
export function isAndroidInstallPromptDismissed(release) {
  const mode = getAndroidInstallPromptMode();
  if (mode === 'install') {
    return isAppInstallPromoSnoozed();
  }

  const normalized = normalizeAndroidRelease(release);
  if (normalized.version_code <= 0) {
    return false;
  }
  try {
    const dismissedCode = Number.parseInt(localStorage.getItem(ANDROID_INSTALL_DISMISS_KEY) || '0', 10);
    return Number.isFinite(dismissedCode) && dismissedCode >= normalized.version_code;
  } catch {
    return false;
  }
}

/**
 * Нужно ли показывать промпт для текущего релиза.
 *
 * @param {object | null | undefined} release
 * @param {{
 *   isPrimaryAdmin?: boolean,
 *   isAdmin?: boolean,
 *   userId?: number | null,
 *   installPromo?: object | null,
 * }} [options]
 */
export function shouldShowAndroidInstallPrompt(release, options = {}) {
  const {
    isPrimaryAdmin = false,
    isAdmin = false,
    userId = null,
    installPromo = null,
  } = options;
  const canTestBeforeRollout = isPrimaryAdmin || isAdmin;
  const mode = getAndroidInstallPromptMode();
  if (!mode) {
    return false;
  }

  // Установка в браузере — только при активной кампании и для аудитории.
  if (mode === 'install') {
    if (!isInstallPromoCampaignActive(installPromo, 'android-browser')) {
      return false;
    }
    if (!isInstallPromoAudienceAllowed(installPromo, { isAdmin: canTestBeforeRollout, userId })) {
      return false;
    }
  }

  const normalized = normalizeAndroidRelease(release);
  if (!normalized.apk_url) {
    return false;
  }

  const rolloutEnabled = normalized.enabled;
  if (!rolloutEnabled && !canTestBeforeRollout) {
    return false;
  }

  if (mode === 'update') {
    const installedCode = getSpasiboAndroidVersionCode();
    const needsUpdate = installedCode < normalized.version_code;
    const testingBeforeRollout = canTestBeforeRollout && !rolloutEnabled;
    if (!needsUpdate && !testingBeforeRollout) {
      return false;
    }
  }

  // Ограниченная аудитория кампании: превью установки даже после snooze.
  if (
    mode === 'install'
    && isInstallPromoRestrictedAudience(installPromo)
    && isInstallPromoAudienceAllowed(installPromo, { isAdmin: canTestBeforeRollout, userId })
  ) {
    return true;
  }

  if (canTestBeforeRollout && !rolloutEnabled) {
    return true;
  }

  if (rolloutEnabled && normalized.version_code <= 0) {
    return false;
  }

  return !isAndroidInstallPromptDismissed(normalized);
}

/**
 * @param {object | null | undefined} raw
 */
export function normalizeAndroidRelease(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ANDROID_RELEASE };
  }
  return {
    ...DEFAULT_ANDROID_RELEASE,
    ...raw,
    version_code: Number.parseInt(String(raw.version_code ?? 0), 10) || 0,
    version_name: String(raw.version_name ?? DEFAULT_ANDROID_RELEASE.version_name).trim(),
    apk_url: String(raw.apk_url ?? '').trim(),
    title: String(raw.title ?? DEFAULT_ANDROID_RELEASE.title).trim(),
    description: String(raw.description ?? DEFAULT_ANDROID_RELEASE.description).trim(),
    release_notes: String(raw.release_notes ?? '').trim(),
    update_title: String(raw.update_title ?? DEFAULT_ANDROID_RELEASE.update_title).trim(),
    update_description: String(
      raw.update_description ?? DEFAULT_ANDROID_RELEASE.update_description,
    ).trim(),
    enabled: Boolean(raw.enabled),
  };
}

/** Тексты слайдера в зависимости от режима (установка / обновление). */
export function getAndroidInstallPromptCopy(release, mode) {
  const normalized = normalizeAndroidRelease(release);
  if (mode === 'update') {
    return {
      title: normalized.update_title,
      description: normalized.update_description,
      actionLabel: 'Скачать обновление',
    };
  }
  return {
    title: normalized.title,
    description: normalized.description,
    actionLabel: 'Скачать приложение',
  };
}

/**
 * Скрывает промпт: установка — на 3 дня; обновление — до следующего version_code.
 *
 * @param {object | null | undefined} release
 */
export function dismissAndroidInstallPrompt(release) {
  const mode = getAndroidInstallPromptMode();
  if (mode === 'install') {
    snoozeAppInstallPromo();
    return;
  }

  const normalized = normalizeAndroidRelease(release);
  try {
    localStorage.setItem(ANDROID_INSTALL_DISMISS_KEY, String(Math.max(normalized.version_code, 1)));
  } catch {
    /* ignore */
  }
}

/** Главный администратор (первый TELEGRAM_ADMIN_IDS или панель id=-1). */
export function isPrimaryAdminUser(user) {
  return Boolean(user?.is_primary_admin);
}
