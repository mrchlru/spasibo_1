/**
 * Мгновенная отрисовка шапок из localStorage + лёгкий prefetch картинок.
 */

import {
  getCachedAppSettingsSnapshot,
  setCachedAppSettingsSnapshot,
} from '../pwa/appSettingsCache.js';
import {
  collectContentShellUrls,
  collectThemeShellUrls,
  warmShellAssets,
} from '../pwa/shellAssetCache.js';
import { injectThemeAssetStyles } from '../utils/themeAssetsCss.js';
import { getCachedData } from '../storage.js';
import { warmCachedBannerAssets } from '../pwa/bannerAssetCache.js';

/**
 * Синхронно применяет тему из localStorage до первого кадра React.
 *
 * @returns {import('../pwa/appSettingsCache.js').AppSettingsSnapshot | null}
 */
export function hydrateShellSync() {
  const snapshot = getCachedAppSettingsSnapshot();
  if (!snapshot) {
    return null;
  }

  if (snapshot.season_theme) {
    const isWinter = snapshot.season_theme === 'winter';
    document.documentElement.classList.toggle('theme-winter', isWinter);
    document.documentElement.classList.toggle('theme-summer', !isWinter);
  }

  if (snapshot.theme_assets) {
    injectThemeAssetStyles(snapshot.theme_assets);
  }

  return snapshot;
}

/** Prefetch шапок, кнопок и баннеров (синхронный, без await). */
export function warmCachedShellAssets() {
  const snapshot = getCachedAppSettingsSnapshot();
  warmShellAssets(collectThemeShellUrls(snapshot?.theme_assets), 12);
  warmCachedBannerAssets(getCachedData('banners') || []);
}

/** Prefetch картинок ленты/баннеров в idle. */
export function scheduleContentShellWarm() {
  if (typeof window === 'undefined') {
    return;
  }
  const run = () => {
    const urls = collectContentShellUrls(getCachedData('banners'), getCachedData('feed'));
    warmShellAssets(urls, 20);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 8000 });
  } else {
    window.setTimeout(run, 2000);
  }
}

/** @param {object} data Ответ GET /app-settings/ */
export function persistAppSettingsFromApi(data) {
  if (!data || typeof data !== 'object') {
    return;
  }
  setCachedAppSettingsSnapshot({
    season_theme: data.season_theme,
    theme_assets: data.theme_assets ?? null,
    frontend_build_id: data.frontend_build_id ?? null,
  });
}

/**
 * Обновляет тему после ответа API.
 *
 * @param {object | null | undefined} themeAssets
 */
export function warmShellAssetsForTheme(themeAssets) {
  if (themeAssets) {
    injectThemeAssetStyles(themeAssets);
  }
  warmShellAssets(collectThemeShellUrls(themeAssets), 12);
}
