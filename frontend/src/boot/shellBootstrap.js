/**
 * Мгновенная отрисовка шапок из localStorage + лёгкий prefetch картинок.
 */

import {
  getCachedAppSettingsSnapshot,
  setCachedAppSettingsSnapshot,
} from '../pwa/appSettingsCache.js';
import {
  collectActiveThemeCriticalUrls,
  collectContentShellUrls,
  collectThemeShellUrls,
  injectCriticalShellPreloads,
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

  warmCriticalShellAssets(snapshot);
  return snapshot;
}

/**
 * Прогрев только критичных картинок активной темы + баннеров из кеша.
 *
 * @param {import('../pwa/appSettingsCache.js').AppSettingsSnapshot | null | undefined} snapshot
 */
export function warmCriticalShellAssets(snapshot) {
  const snap = snapshot ?? getCachedAppSettingsSnapshot();
  const criticalUrls = collectActiveThemeCriticalUrls(snap?.season_theme, snap?.theme_assets);
  injectCriticalShellPreloads(criticalUrls);
  warmShellAssets(criticalUrls, criticalUrls.length || 6);
  warmCachedBannerAssets(getCachedData('banners') || []);
}

/** Prefetch шапок, кнопок и баннеров (синхронный, без await). */
export function warmCachedShellAssets() {
  warmCriticalShellAssets(getCachedAppSettingsSnapshot());
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
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    window.setTimeout(run, 400);
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
