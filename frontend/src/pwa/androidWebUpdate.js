import { clearCache } from '../storage.js';
import { clearCachedAppSettingsSnapshot } from './appSettingsCache.js';
import {
  clearAllShellAssetCaches,
  setActiveFrontendBuildId,
} from './shellAssetCache.js';

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
    stored = localStorage.getItem('spasibo_frontend_build_id') || '';
  } catch {
    stored = '';
  }

  if (!stored) {
    setActiveFrontendBuildId(serverBuildId);
    return;
  }

  if (stored === serverBuildId) {
    return;
  }

  setActiveFrontendBuildId(serverBuildId);
  void clearAllShellAssetCaches();
  clearCachedAppSettingsSnapshot();

  void clearCache('feed');
  void clearCache('market');
  void clearCache('leaderboard');
  void clearCache('banners');
  void clearCache('history');

  window.location.reload();
}
