/** Разбор ответа GET /feed (страница или legacy-массив). */

export const FEED_PAGE_SIZE = 20;

/**
 * @param {unknown} data
 * @returns {{ items: Array<object>, hasMore: boolean, offset: number, limit: number }}
 */
export function unwrapFeedPage(data) {
  if (data && typeof data === 'object' && Array.isArray(data.items)) {
    return {
      items: data.items,
      hasMore: Boolean(data.has_more),
      offset: Number(data.offset) || 0,
      limit: Number(data.limit) || FEED_PAGE_SIZE,
    };
  }
  if (Array.isArray(data)) {
    return {
      items: data,
      hasMore: false,
      offset: 0,
      limit: data.length,
    };
  }
  return { items: [], hasMore: false, offset: 0, limit: FEED_PAGE_SIZE };
}

/**
 * @param {Array<object>} data
 * @returns {Array<object>}
 */
export function normalizeFeedEntries(data) {
  if (!data || !Array.isArray(data)) return [];
  if (data.length > 0 && data[0].kind) return data;
  return data.map((transaction) => ({
    kind: 'transaction',
    timestamp: transaction.timestamp,
    transaction,
  }));
}

/**
 * @param {unknown} data
 * @returns {Array<object>}
 */
export function unwrapFeedItems(data) {
  return unwrapFeedPage(data).items;
}

/**
 * @param {object} entry
 * @returns {string}
 */
export function feedEntryKey(entry) {
  if (entry.kind === 'post' && entry.post) return `post-${entry.post.id}`;
  if (entry.kind === 'transaction' && entry.transaction) return `tx-${entry.transaction.id}`;
  if (entry.kind === 'birthday' && entry.birthday) return `birthday-${entry.birthday.user_id}`;
  return String(entry.timestamp || '');
}

/**
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {Array<object>}
 */
export function mergeFeedEntries(existing, incoming) {
  const keys = new Set();
  const result = [];
  for (const entry of [...existing, ...incoming]) {
    const key = feedEntryKey(entry);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    result.push(entry);
  }
  return result;
}
