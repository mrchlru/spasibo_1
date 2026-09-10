import { clearCache } from '../storage.js';
import { clearCachedAppSettingsSnapshot } from './appSettingsCache.js';
import {
  clearAllShellAssetCaches,
  setActiveFrontendBuildId,
} from './shellAssetCache.js';

const BUILD_ID_KEY = 'spasibo_frontend_build_id';
const RELOAD_GUARD_KEY = 'spasibo_build_reload_guard';

/** In-memory guard, если sessionStorage недоступен (iOS private mode). */
let reloadGuardBuildId = null;

/** Страница уже перезагружена с ?b= после смены сборки. */
function hasBuildReloadMarker(serverBuildId) {
  try {
    const marker = new URL(window.location.href).searchParams.get('b') || '';
    return Boolean(marker) && serverBuildId.startsWith(marker);
  } catch {
    return false;
  }
}

/** Убирает ?b= из адресной строки после успешной перезагрузки. */
function clearBuildReloadMarker() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('b')) {
      return;
    }
    url.searchParams.delete('b');
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}

/** Перезагрузка с cache-bust — WebView/Safari подтягивают свежий index.html. */
function hardReloadForNewBuild(serverBuildId) {
  const url = new URL(window.location.href);
  url.searchParams.set('b', serverBuildId.slice(0, 12));
  window.location.replace(url.toString());
}

/**
 * Если на сервере новая сборка фронта — сбрасывает кеш и перезагружает один раз.
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
    reloadGuardBuildId = null;
    clearBuildReloadMarker();
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  if (hasBuildReloadMarker(serverBuildId)) {
    setActiveFrontendBuildId(serverBuildId);
    reloadGuardBuildId = null;
    clearBuildReloadMarker();
    return;
  }

  if (reloadGuardBuildId === serverBuildId) {
    setActiveFrontendBuildId(serverBuildId);
    return;
  }

  let sessionGuard = '';
  try {
    sessionGuard = sessionStorage.getItem(RELOAD_GUARD_KEY) || '';
  } catch {
    sessionGuard = '';
  }
  if (sessionGuard === serverBuildId) {
    setActiveFrontendBuildId(serverBuildId);
    return;
  }

  reloadGuardBuildId = serverBuildId;
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

  hardReloadForNewBuild(serverBuildId);
}
