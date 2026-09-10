import { clearCache } from '../storage.js';
import { clearCachedAppSettingsSnapshot } from './appSettingsCache.js';
import {
  clearAllShellAssetCaches,
  setActiveFrontendBuildId,
} from './shellAssetCache.js';

const BUILD_ID_KEY = 'spasibo_frontend_build_id';
const RELOAD_GUARD_KEY = 'spasibo_build_reload_guard';

/** Сбрасывает SW и HTTP-кеш браузера перед перезагрузкой после деплоя. */
async function purgeBrowserCachesBeforeReload() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Если на сервере новая сборка фронта — сбрасывает кеш и перезагружает (Android WebView).
 *
 * @param {string | null | undefined} serverBuildId
 */
export function applyFrontendBuildUpdate(serverBuildId) {
  if (!serverBuildId || typeof window === 'undefined') {
    return;
  }

  let stored = '';
  try {
    stored = localStorage.getItem(BUILD_ID_KEY) || '';
  } catch {
    stored = '';
  }

  if (!stored) {
    setActiveFrontendBuildId(serverBuildId);
    return;
  }

  if (stored === serverBuildId) {
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  let reloadGuard = '';
  try {
    reloadGuard = sessionStorage.getItem(RELOAD_GUARD_KEY) || '';
  } catch {
    reloadGuard = '';
  }
  if (reloadGuard === serverBuildId) {
    return;
  }

  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, serverBuildId);
  } catch {
    /* ignore */
  }

  setActiveFrontendBuildId(serverBuildId);
  void clearAllShellAssetCaches();
  clearCachedAppSettingsSnapshot();

  void clearCache('feed');
  void clearCache('market');
  void clearCache('leaderboard');
  void clearCache('banners');
  void clearCache('history');

  void purgeBrowserCachesBeforeReload().finally(() => {
    window.location.reload();
  });
}
