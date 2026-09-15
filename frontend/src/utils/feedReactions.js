/** Константы реакций новостей ленты «Спасибо». */

export const FEED_REACTION_EMOJIS = ['❤️', '👎', '😁', '🔥'];

/**
 * Нормализует счётчики реакций.
 *
 * @param {Record<string, number> | null | undefined} raw
 * @returns {Record<string, number>}
 */
export function normalizeReactionCounts(raw) {
  const counts = {};
  FEED_REACTION_EMOJIS.forEach((emoji) => {
    counts[emoji] = Number(raw?.[emoji]) || 0;
  });
  return counts;
}

/**
 * Оптимистично переключает реакцию.
 *
 * @param {{ reaction_counts?: Record<string, number>, my_reaction?: string | null }} post
 * @param {string} emoji
 */
export function applyOptimisticReaction(post, emoji) {
  const counts = normalizeReactionCounts(post?.reaction_counts);
  const current = post?.my_reaction || null;
  let nextMine = emoji;

  if (current === emoji) {
    counts[emoji] = Math.max(0, counts[emoji] - 1);
    nextMine = null;
  } else {
    if (current && counts[current] != null) {
      counts[current] = Math.max(0, counts[current] - 1);
    }
    counts[emoji] = (counts[emoji] || 0) + 1;
  }

  return {
    ...post,
    reaction_counts: counts,
    my_reaction: nextMine,
  };
}
