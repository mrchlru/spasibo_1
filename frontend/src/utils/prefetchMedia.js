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
    const url = String(rawUrl).trim();
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
 * Собирает URL баннеров и аватаров из ленты для prefetch.
 *
 * @param {Array<object>} banners
 * @param {Array<object>} feedEntries
 * @returns {ImageUrl[]}
 */
export function collectBootMediaUrls(banners, feedEntries) {
  const urls = [];

  for (const banner of banners || []) {
    if (banner?.image_url) {
      urls.push(banner.image_url);
    }
  }

  for (const entry of feedEntries || []) {
    if (entry?.kind === 'post' && entry.post?.author?.telegram_photo_url) {
      urls.push(entry.post.author.telegram_photo_url);
    }
    if (entry?.kind === 'transaction') {
      const tx = entry.transaction;
      if (tx?.sender?.telegram_photo_url) {
        urls.push(tx.sender.telegram_photo_url);
      }
      if (tx?.receiver?.telegram_photo_url) {
        urls.push(tx.receiver.telegram_photo_url);
      }
    }
    for (const attachment of entry?.post?.attachments || []) {
      if (attachment?.kind === 'image' && attachment.url) {
        urls.push(attachment.url);
      }
    }
  }

  return urls;
}
