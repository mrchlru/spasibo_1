/**
 * Кеш оболочки: шапки, кнопка «Отправить спасибки», логотипы.
 * Прогрев — через <img> (без CORS), без fetch/Cache API (ломало старт приложения).
 */

import { resolveSeasonAssets } from '../themeAssetDefaults.js';
import { resolveMediaUrl } from '../utils/resolveMediaUrl.js';

/** Критичные для первого экрана (шапка, кнопка, переключатель). */
export const CRITICAL_SHELL_KEYS = [
  'header_image_mobile',
  'header_image_desktop',
  'thanks_button',
  'section_slider_knob',
  'thanks_feed_logo',
];

const BUILD_ID_KEY = 'spasibo_frontend_build_id';
const CACHE_EPOCH_KEY = 'spasibo_cache_epoch_ms';
/** 30 дней — принудительное фоновое обновление данных. */
export const SHELL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const prefetchedDisplayUrls = new Set();
const preloadedLinkUrls = new Set();

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

/** URL аватарки / фото пользователя — не прогреваем в оболочке. */
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
  return [...urls];
}

/**
 * URL оболочки только для активной темы (без прогрева лето+зима сразу).
 *
 * @param {string} seasonTheme
 * @param {object | null | undefined} themeAssets
 * @returns {string[]}
 */
export function collectActiveThemeCriticalUrls(seasonTheme, themeAssets) {
  const seasonKey = seasonTheme === 'winter' ? 'winter' : 'summer';
  const merged = resolveSeasonAssets(seasonKey, themeAssets);
  return CRITICAL_SHELL_KEYS
    .map((key) => merged[key])
    .filter((value) => value && String(value).trim() && !isUserAvatarUrl(value))
    .map((value) => String(value).trim());
}

/**
 * `<link rel="preload">` для критичных картинок до первого кадра React.
 *
 * @param {string[]} rawUrls
 */
export function injectCriticalShellPreloads(rawUrls) {
  if (typeof document === 'undefined') {
    return;
  }
  const head = document.head;
  for (const rawUrl of rawUrls.slice(0, 6)) {
    const href = resolveMediaUrl(String(rawUrl).trim());
    if (!href || preloadedLinkUrls.has(href)) {
      continue;
    }
    preloadedLinkUrls.add(href);
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = href;
    head.appendChild(link);
  }
}

/**
 * Медиа из ленты/баннеров без аватарок.
 *
 * @param {Array<object>} banners
 * @param {Array<object>} feedEntries
 * @returns {string[]}
 */
export function collectContentShellUrls(banners, feedRaw) {
  const urls = [];
  const feedEntries = Array.isArray(feedRaw?.items)
    ? feedRaw.items
    : (Array.isArray(feedRaw) ? feedRaw : []);

  for (const banner of banners || []) {
    if (banner?.image_url && !isUserAvatarUrl(banner.image_url)) {
      urls.push(banner.image_url);
    }
  }

  for (const entry of feedEntries) {
    for (const attachment of entry?.post?.attachments || []) {
      if (attachment?.kind === 'image' && attachment.url && !isUserAvatarUrl(attachment.url)) {
        urls.push(attachment.url);
      }
    }
  }

  return urls;
}

/**
 * URL для отображения в UI (без blob-кеша).
 *
 * @param {string} rawUrl
 */
export function resolveShellDisplayUrl(rawUrl) {
  return resolveMediaUrl(String(rawUrl || '').trim());
}

function prefetchDisplayUrl(displayUrl) {
  if (!displayUrl || prefetchedDisplayUrls.has(displayUrl)) {
    return;
  }
  prefetchedDisplayUrls.add(displayUrl);
  const image = new Image();
  image.decoding = 'async';
  image.src = displayUrl;
}

/**
 * Прогревает HTTP-кеш браузера для URL оболочки (не блокирует UI).
 *
 * @param {string[]} urls
 * @param {number} [limit=16]
 */
export function warmShellAssets(urls, limit = 16) {
  if (typeof window === 'undefined') {
    return;
  }
  const unique = [...new Set(urls.filter(Boolean))].slice(0, limit);
  for (const rawUrl of unique) {
    if (isUserAvatarUrl(rawUrl)) {
      continue;
    }
    prefetchDisplayUrl(resolveMediaUrl(String(rawUrl).trim()));
  }
}

/** Сброс in-memory prefetch (при новой сборке). */
export async function clearAllShellAssetCaches() {
  prefetchedDisplayUrls.clear();
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
