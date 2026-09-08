import { clearCache } from '../storage.js';

const BUILD_ID_KEY = 'spasibo_frontend_build_id';

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
    try {
      localStorage.setItem(BUILD_ID_KEY, serverBuildId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (stored === serverBuildId) {
    return;
  }

  try {
    localStorage.setItem(BUILD_ID_KEY, serverBuildId);
  } catch {
    /* ignore */
  }

  void clearCache('feed');
  void clearCache('market');
  void clearCache('leaderboard');
  void clearCache('banners');
  void clearCache('history');

  window.location.reload();
}
