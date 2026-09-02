import { getFeed, getBanners, getMarketItems, getLeaderboard } from '../api';
import { setCachedData, getCachedData } from '../storage';
import { collectBootMediaUrls, prefetchImageUrls } from '../utils/prefetchMedia';

const DEFAULT_BOOT_TIMEOUT_MS = 2500;

/**
 * Ждёт promise не дольше timeoutMs.
 *
 * @param {Promise<unknown>} promise
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true если сработал timeout
 */
async function raceWithTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(true), timeoutMs);
  });

  try {
    await Promise.race([promise, timeoutPromise]);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Критический preload до показа главного экрана: лента + баннеры.
 * Магазин и рейтинг прогреваются в фоне.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ready: boolean, timedOut: boolean }>}
 */
export async function preloadAppContent(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;

  const critical = Promise.allSettled([
    getFeed()
      .then((response) => setCachedData('feed', response.data))
      .catch(() => null),
    getBanners()
      .then((response) => setCachedData('banners', response.data))
      .catch(() => null),
  ]);

  const timedOut = await raceWithTimeout(critical, timeoutMs);

  const banners = getCachedData('banners') || [];
  const feed = getCachedData('feed') || [];
  prefetchImageUrls(collectBootMediaUrls(banners, feed), 50);

  void Promise.allSettled([
    getMarketItems()
      .then((response) => setCachedData('market', response.data))
      .catch(() => null),
    getLeaderboard({ period: 'all_time', type: 'received' })
      .then((response) => setCachedData('leaderboard', response.data))
      .catch(() => null),
  ]);

  return {
    ready: true,
    timedOut,
  };
}
