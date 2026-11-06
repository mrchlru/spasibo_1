import { clearCache } from '../storage.js';
import { clearCachedAppSettingsSnapshot } from './appSettingsCache.js';
import { setActiveFrontendBuildId } from './shellAssetCache.js';

const BUILD_ID_KEY = 'spasibo_frontend_build_id';
const RELOAD_ATTEMPTS_KEY = 'spasibo_build_reload_attempts';
const MAX_RELOAD_ATTEMPTS = 3;

/** In-memory guard, если sessionStorage недоступен (iOS private mode). */
let reloadInFlightBuildId = null;

/**
 * Id бандла, который реально загружен сейчас (из script src).
 * Совпадает с frontend_build_id на сервере (stem файла index-*.js).
 */
export function getRunningFrontendBuildId() {
  if (typeof document === 'undefined') {
    return '';
  }
  try {
    for (const script of document.scripts) {
      const src = String(script.src || '');
      const match = src.match(/\/assets\/(index-[A-Za-z0-9_-]+)\.js(?:\?|#|$)/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

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

function readReloadAttempts(serverBuildId) {
  try {
    const raw = sessionStorage.getItem(RELOAD_ATTEMPTS_KEY) || '';
    if (!raw.startsWith(`${serverBuildId}:`)) {
      return 0;
    }
    return Number.parseInt(raw.slice(serverBuildId.length + 1), 10) || 0;
  } catch {
    return 0;
  }
}

function writeReloadAttempts(serverBuildId, attempts) {
  try {
    sessionStorage.setItem(RELOAD_ATTEMPTS_KEY, `${serverBuildId}:${attempts}`);
  } catch {
    /* ignore */
  }
}

function clearReloadAttempts() {
  try {
    sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Сносит SW и все кеши spasibo-* — иначе iOS PWA может снова отдать старый index.
 */
async function nukeServiceWorkerAndCaches() {
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
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('spasibo-'))
          .map((key) => caches.delete(key)),
      );
    }
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

function markBuildCurrent(serverBuildId) {
  setActiveFrontendBuildId(serverBuildId);
  reloadInFlightBuildId = null;
  clearBuildReloadMarker();
  clearReloadAttempts();
}

/**
 * Если на сервере новая сборка фронта — жёстко сбрасывает кеш/SW и перезагружает.
 *
 * @param {string | null | undefined} serverBuildId stem бандла index-*.js
 */
export function applyFrontendBuildUpdate(serverBuildId) {
  if (!serverBuildId || typeof window === 'undefined') {
    return;
  }

  const running = getRunningFrontendBuildId();

  // Уже крутится нужный бандл — фиксируем и выходим.
  if (running && running === serverBuildId) {
    markBuildCurrent(serverBuildId);
    return;
  }

  let stored = '';
  try {
    stored = localStorage.getItem(BUILD_ID_KEY) || '';
  } catch {
    stored = '';
  }

  // Первый запуск без stamp в script (редко) — просто запоминаем серверный id.
  if (!running && !stored) {
    setActiveFrontendBuildId(serverBuildId);
    return;
  }

  // После reload с ?b= всё ещё старый JS — не помечаем успех, пробуем ещё.
  const attempts = readReloadAttempts(serverBuildId);
  if (hasBuildReloadMarker(serverBuildId) && running && running !== serverBuildId) {
    if (attempts >= MAX_RELOAD_ATTEMPTS) {
      console.warn(
        '[pwa] Не удалось подтянуть новую сборку после перезагрузок',
        { serverBuildId, running, attempts },
      );
      markBuildCurrent(serverBuildId);
      return;
    }
  }

  if (reloadInFlightBuildId === serverBuildId && attempts > 0) {
    return;
  }

  reloadInFlightBuildId = serverBuildId;
  writeReloadAttempts(serverBuildId, attempts + 1);

  // Не пишем BUILD_ID в localStorage до подтверждения running === server —
  // иначе iOS PWA «засыпает» на старом JS навсегда.
  clearCachedAppSettingsSnapshot();
  void clearCache('feed');
  void clearCache('market');
  void clearCache('leaderboard');
  void clearCache('banners');
  void clearCache('history');

  void nukeServiceWorkerAndCaches().finally(() => {
    hardReloadForNewBuild(serverBuildId);
  });
}
