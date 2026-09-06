/**
 * Промпт установки / обновления Android APK (браузер и нативная оболочка).
 */

import { getSpasiboAndroidVersionCode, isSpasiboAndroidApp } from './androidNativePush.js';
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

/** Пользователь уже скрыл промпт для этой или более новой версии. */
export function isAndroidInstallPromptDismissed(release) {
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
 * @param {{ isPrimaryAdmin?: boolean }} [options]
 */
export function shouldShowAndroidInstallPrompt(release, options = {}) {
  const { isPrimaryAdmin = false } = options;
  const mode = getAndroidInstallPromptMode();
  if (!mode) {
    return false;
  }

  const normalized = normalizeAndroidRelease(release);
  if (!normalized.apk_url) {
    return false;
  }

  const rolloutEnabled = normalized.enabled;
  if (!rolloutEnabled && !isPrimaryAdmin) {
    return false;
  }

  if (mode === 'update') {
    const installedCode = getSpasiboAndroidVersionCode();
    const needsUpdate = installedCode < normalized.version_code;
    const testingAsPrimaryAdmin = isPrimaryAdmin && !rolloutEnabled;
    if (!needsUpdate && !testingAsPrimaryAdmin) {
      return false;
    }
  }

  if (isPrimaryAdmin && !rolloutEnabled) {
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

/** Запоминает, что пользователь скрыл промпт для этой версии. */
export function dismissAndroidInstallPrompt(release) {
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
