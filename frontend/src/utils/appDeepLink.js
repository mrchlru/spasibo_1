/** Маршруты из push/deep link (?panel=...) в страницы приложения. */

/** @typedef {{ page: string, homeSection?: string, feedPostId?: number | null }} DeepLinkTarget */

const PANEL_ROUTES = {
  home: { page: 'home', homeSection: 'feed' },
  feed: { page: 'home', homeSection: 'feed' },
  transfer: { page: 'transfer' },
  notifications: { page: 'notifications' },
  marketplace: { page: 'marketplace' },
  market: { page: 'marketplace' },
  profile: { page: 'profile' },
  roulette: { page: 'roulette' },
  leaderboard: { page: 'leaderboard' },
  rating: { page: 'leaderboard' },
};

const PATH_ROUTES = {
  '/': { page: 'home', homeSection: 'feed' },
  '/transfer': { page: 'transfer' },
  '/notifications': { page: 'notifications' },
  '/marketplace': { page: 'marketplace' },
  '/profile': { page: 'profile' },
  '/roulette': { page: 'roulette' },
};

/**
 * Разбирает URL из push или Android intent.
 *
 * @param {string | null | undefined} rawUrl
 * @param {string} [fallbackOrigin]
 * @returns {DeepLinkTarget | null}
 */
export function parseAppDeepLink(rawUrl, fallbackOrigin = '') {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const base = fallbackOrigin || (typeof window !== 'undefined' ? window.location.origin : 'https://local');
    const url = new URL(trimmed, base);
    const panel = url.searchParams.get('panel')?.toLowerCase();
    const feedPostRaw = url.searchParams.get('feed_post');
    const feedPostId = feedPostRaw ? Number.parseInt(feedPostRaw, 10) : null;

    if (panel && PANEL_ROUTES[panel]) {
      return {
        ...PANEL_ROUTES[panel],
        feedPostId: Number.isFinite(feedPostId) ? feedPostId : null,
      };
    }

    const pathKey = url.pathname.replace(/\/$/, '') || '/';
    if (PATH_ROUTES[pathKey]) {
      return {
        ...PATH_ROUTES[pathKey],
        feedPostId: Number.isFinite(feedPostId) ? feedPostId : null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Убирает ?panel= из адресной строки без перезагрузки.
 */
export function stripDeepLinkQueryFromLocation() {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has('panel') && !url.searchParams.has('feed_post')) {
    return;
  }
  url.searchParams.delete('panel');
  url.searchParams.delete('feed_post');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}
