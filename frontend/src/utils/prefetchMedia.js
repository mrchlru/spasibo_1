import { resolveMediaUrl } from './resolveMediaUrl.js';
import { isUserAvatarUrl } from '../pwa/shellAssetCache.js';

/** @typedef {string} ImageUrl */

const prefetchedUrls = new Set();

/**
 * Прогревает HTTP-кэш браузера для списка URL изображений.
 *
 * @param {ImageUrl[]} urls
 * @param {number} [limit=80]
 */
export function prefetchImageUrls(urls, limit = 80) {
  if (typeof window === 'undefined' || !Array.isArray(urls)) {
    return;
  }

  let count = 0;
  for (const rawUrl of urls) {
    if (!rawUrl || count >= limit) {
      break;
    }
    const url = resolveMediaUrl(String(rawUrl).trim());
    if (!url || prefetchedUrls.has(url)) {
      continue;
    }
    prefetchedUrls.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    count += 1;
  }
}

/**
 * Собирает URL баннеров и вложений ленты для prefetch (без аватарок пользователей).
 *
 * @param {Array<object>} banners
 * @param {Array<object>} feedEntries
 * @returns {ImageUrl[]}
 */
export function collectBootMediaUrls(banners, feedEntries) {
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
