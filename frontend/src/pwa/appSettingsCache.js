/** Снимок app-settings для мгновенного старта без ожидания API. */

const SNAPSHOT_KEY = 'spasibo_app_settings_snapshot';

/**
 * @typedef {{
 *   season_theme?: string,
 *   theme_assets?: object | null,
 *   frontend_build_id?: string | null,
 *   cached_at?: number,
 * }} AppSettingsSnapshot
 */

/** @returns {AppSettingsSnapshot | null} */
export function getCachedAppSettingsSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {AppSettingsSnapshot} snapshot */
export function setCachedAppSettingsSnapshot(snapshot) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        ...snapshot,
        cached_at: Date.now(),
      }),
    );
  } catch {
    /* ignore quota */
  }
}

/** Удаляет снимок (при смене сборки). */
export function clearCachedAppSettingsSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
