/**
 * Мгновенный показ баннеров из localStorage + prefetch картинок.
 * При смене набора баннеров (админка) — обновление кеша и повторный прогрев.
 */

import { warmShellAssets } from './shellAssetCache.js';

const BANNERS_FP_KEY = 'spasibo_banners_fingerprint';

/**
 * @param {Array<object>} banners
 * @returns {string}
 */
export function computeBannersFingerprint(banners) {
  if (!Array.isArray(banners) || banners.length === 0) {
    return 'empty';
  }
  return banners
    .map((banner) =>
      [
        banner.id,
        banner.image_url || '',
        banner.banner_type || '',
        banner.position || '',
        banner.is_active ? '1' : '0',
        JSON.stringify(banner.data || null),
      ].join('|'),
    )
    .join(';;');
}

/**
 * @returns {string | null}
 */
export function getStoredBannersFingerprint() {
  try {
    return localStorage.getItem(BANNERS_FP_KEY);
  } catch {
    return null;
  }
}

/**
 * @param {string} fingerprint
 */
function storeBannersFingerprint(fingerprint) {
  try {
    localStorage.setItem(BANNERS_FP_KEY, fingerprint);
  } catch {
    /* ignore */
  }
}

/**
 * @param {Array<object>} banners
 */
export function warmBannerAssets(banners) {
  const urls = (banners || [])
    .map((banner) => banner?.image_url)
    .filter(Boolean);
  warmShellAssets(urls, 24);
}

/**
 * Сохраняет баннеры и прогревает картинки, если набор изменился.
 *
 * @param {Array<object>} banners
 * @returns {boolean} true если fingerprint изменился
 */
export function syncBannersCache(banners) {
  const list = Array.isArray(banners) ? banners : [];
  const fingerprint = computeBannersFingerprint(list);
  const previous = getStoredBannersFingerprint();
  const changed = fingerprint !== previous;
  if (changed) {
    storeBannersFingerprint(fingerprint);
    warmBannerAssets(list);
  }
  return changed;
}

/** Прогрев из уже сохранённого кеша (при старте приложения). */
export function warmCachedBannerAssets(banners) {
  warmBannerAssets(banners);
}
