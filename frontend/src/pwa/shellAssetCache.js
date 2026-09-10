/**
 * Жёсткий кеш оболочки: шапки, кнопка «Отправить спасибки», логотипы, баннеры, картинки в ленте.
 * Не кеширует аватарки пользователей.
 */

import { THEME_ASSET_DEFAULTS, resolveSeasonAssets } from '../themeAssetDefaults.js';
import { resolveMediaUrl } from '../utils/resolveMediaUrl.js';

const BUILD_ID_KEY = 'spasibo_frontend_build_id';
const CACHE_EPOCH_KEY = 'spasibo_cache_epoch_ms';
/** 30 дней — принудительное фоновое обновление данных. */
export const SHELL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const blobUrlByRequestUrl = new Map();

/** @returns {string} */
export function getActiveFrontendBuildId() {
  try {
    return localStorage.getItem(BUILD_ID_KEY) || 'bootstrap';
  } catch {
    return 'bootstrap';
  }
}

/** @param {string} buildId */
export function setActiveFrontendBuildId(buildId) {
  try {
    localStorage.setItem(BUILD_ID_KEY, buildId || 'bootstrap');
    localStorage.setItem(CACHE_EPOCH_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Нужно ли фоновое обновление данных (раз в месяц). */
export function isShellCacheEpochExpired() {
  try {
    const raw = localStorage.getItem(CACHE_EPOCH_KEY);
    const epoch = Number.parseInt(raw || '0', 10);
    if (!Number.isFinite(epoch) || epoch <= 0) {
      return true;
    }
    return Date.now() - epoch > SHELL_CACHE_MAX_AGE_MS;
  } catch {
    return true;
  }
}

function shellCacheName(buildId) {
  return `spasibo-shell-assets-${buildId || 'bootstrap'}`;
}

/** URL аватарки / фото пользователя — не кешируем в оболочке. */
export function isUserAvatarUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return false;
  }
  if (/\/users\/\d+\/avatar/i.test(url)) {
    return true;
  }
  if (/\/telegram\/photo-proxy/i.test(url)) {
    return true;
  }
  if (/t\.me\/i\/userpic/i.test(url)) {
    return true;
  }
  return false;
}

/**
 * Все URL оболочки для summer/winter (дефолты + переопределения из админки).
 *
 * @param {object | null | undefined} themeAssets
 * @returns {string[]}
 */
export function collectThemeShellUrls(themeAssets) {
  const urls = new Set();
  for (const seasonKey of ['summer', 'winter']) {
    const merged = resolveSeasonAssets(seasonKey, themeAssets);
    for (const value of Object.values(merged)) {
      if (value && String(value).trim() && !isUserAvatarUrl(value)) {
        urls.add(String(value).trim());
      }
    }
  }
  for (const season of Object.values(THEME_ASSET_DEFAULTS)) {
    for (const value of Object.values(season)) {
      if (value && String(value).trim()) {
        urls.add(String(value).trim());
      }
    }
  }
  return [...urls];
}

/**
 * Медиа из ленты/баннеров без аватарок.
 *
 * @param {Array<object>} banners
 * @param {Array<object>} feedEntries
 * @returns {string[]}
 */
export function collectContentShellUrls(banners, feedEntries) {
  const urls = [];

  for (const banner of banners || []) {
    if (banner?.image_url && !isUserAvatarUrl(banner.image_url)) {
      urls.push(banner.image_url);
    }
  }

  for (const entry of feedEntries || []) {
    for (const attachment of entry?.post?.attachments || []) {
      if (attachment?.kind === 'image' && attachment.url && !isUserAvatarUrl(attachment.url)) {
        urls.push(attachment.url);
      }
    }
  }

  return urls;
}

async function openShellCache(buildId) {
  if (typeof caches === 'undefined') {
    return null;
  }
  try {
    return await caches.open(shellCacheName(buildId));
  } catch {
    return null;
  }
}

/**
 * Кладёт файл в Cache API и возвращает blob:-URL для мгновенного CSS/img.
 *
 * @param {string} rawUrl
 * @param {string} buildId
 */
export async function ensureShellAssetCached(rawUrl, buildId = getActiveFrontendBuildId()) {
  const requestUrl = resolveMediaUrl(String(rawUrl || '').trim());
  if (!requestUrl || isUserAvatarUrl(requestUrl)) {
    return '';
  }

  const cachedBlob = blobUrlByRequestUrl.get(requestUrl);
  if (cachedBlob) {
    return cachedBlob;
  }

  const cache = await openShellCache(buildId);
  if (cache) {
    const hit = await cache.match(requestUrl);
    if (hit) {
      const blob = await hit.blob();
      const objectUrl = URL.createObjectURL(blob);
      blobUrlByRequestUrl.set(requestUrl, objectUrl);
      return objectUrl;
    }
  }

  try {
    const response = await fetch(requestUrl, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) {
      return requestUrl;
    }
    if (cache) {
      await cache.put(requestUrl, response.clone());
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    blobUrlByRequestUrl.set(requestUrl, objectUrl);
    return objectUrl;
  } catch {
    return requestUrl;
  }
}

/**
 * Прогревает кеш оболочки (шапки, кнопки и т.д.).
 *
 * @param {string[]} urls
 * @param {string} [buildId]
 */
export async function warmShellAssets(urls, buildId = getActiveFrontendBuildId()) {
  const unique = [...new Set(urls.filter(Boolean))];
  await Promise.allSettled(
    unique.map((url) => ensureShellAssetCached(url, buildId)),
  );
}

/**
 * Подменяет URL в theme_assets на blob:-URL из кеша (для CSS background).
 *
 * @param {object | null | undefined} themeAssets
 * @param {string} [buildId]
 * @returns {Promise<object | null>}
 */
export async function resolveThemeAssetsFromShellCache(themeAssets, buildId = getActiveFrontendBuildId()) {
  if (!themeAssets || typeof themeAssets !== 'object') {
    return themeAssets ?? null;
  }

  const resolved = {};
  for (const [seasonKey, row] of Object.entries(themeAssets)) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    resolved[seasonKey] = {};
    for (const [assetKey, rawUrl] of Object.entries(row)) {
      if (!rawUrl || isUserAvatarUrl(rawUrl)) {
        resolved[seasonKey][assetKey] = rawUrl;
        continue;
      }
      resolved[seasonKey][assetKey] = await ensureShellAssetCached(String(rawUrl), buildId);
    }
  }
  return resolved;
}

/**
 * URL для отображения: blob из Cache API, если уже прогрет, иначе обычный resolveMediaUrl.
 *
 * @param {string} rawUrl
 */
export function resolveShellDisplayUrl(rawUrl) {
  const requestUrl = resolveMediaUrl(String(rawUrl || '').trim());
  if (!requestUrl) {
    return '';
  }
  return blobUrlByRequestUrl.get(requestUrl) || requestUrl;
}

/** Сбрасывает кеш оболочки при новой сборке сервера. */
export async function clearAllShellAssetCaches() {
  for (const objectUrl of blobUrlByRequestUrl.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }
  blobUrlByRequestUrl.clear();

  if (typeof caches === 'undefined') {
    return;
  }
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('spasibo-shell-assets-'))
        .map((key) => caches.delete(key)),
    );
  } catch {
    /* ignore */
  }
}
