/** Приводит id товара магазина к числу для Set/API. */
export function normalizeMarketItemId(rawId) {
  const itemId = Number(rawId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return null;
  }
  return itemId;
}

/** Нормализует список id избранного с API. */
export function normalizeMarketItemIdList(rawIds) {
  if (!Array.isArray(rawIds)) {
    return [];
  }
  return rawIds
    .map((id) => normalizeMarketItemId(id))
    .filter((id) => id !== null);
}
