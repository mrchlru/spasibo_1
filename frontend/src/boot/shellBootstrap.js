/**
 * Мгновенная отрисовка шапок и кнопок из локального снимка + прогрев Cache API.
 */

import {
  getCachedAppSettingsSnapshot,
  setCachedAppSettingsSnapshot,
} from '../pwa/appSettingsCache.js';
import {
  collectContentShellUrls,
  collectThemeShellUrls,
  getActiveFrontendBuildId,
  resolveThemeAssetsFromShellCache,
  warmShellAssets,
} from '../pwa/shellAssetCache.js';
import { injectThemeAssetStyles } from '../utils/themeAssetsCss.js';
import { getCachedData } from '../storage.js';

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

/**
 * Прогревает только шапки и кнопки (без ленты — иначе сотни запросов блокируют старт).
 */
export async function warmCachedShellAssets() {
  const snapshot = getCachedAppSettingsSnapshot();
  const buildId = getActiveFrontendBuildId();
  await warmShellAssets(collectThemeShellUrls(snapshot?.theme_assets), buildId);

  if (snapshot?.theme_assets) {
    const resolved = await resolveThemeAssetsFromShellCache(snapshot.theme_assets, buildId);
    injectThemeAssetStyles(resolved);
  }
}

/** Прогревает картинки ленты/баннеров в idle, без блокировки UI. */
export function scheduleContentShellWarm() {
  if (typeof window === 'undefined') {
    return;
  }
  const run = () => {
    const buildId = getActiveFrontendBuildId();
    const urls = collectContentShellUrls(getCachedData('banners'), getCachedData('feed'));
    void warmShellAssets(urls, buildId, { limit: 40 });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 8000 });
  } else {
    window.setTimeout(run, 1500);
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
 * Прогревает оболочку после свежих настроек с API.
 *
 * @param {object | null | undefined} themeAssets
 */
export async function warmShellAssetsForTheme(themeAssets) {
  const buildId = getActiveFrontendBuildId();
  await warmShellAssets(collectThemeShellUrls(themeAssets), buildId);
  if (themeAssets) {
    const resolved = await resolveThemeAssetsFromShellCache(themeAssets, buildId);
    injectThemeAssetStyles(resolved);
  }
}
