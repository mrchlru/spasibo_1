/**
 * Общий клиентский store избранного магазина (мгновенный UI между страницами).
 */

import {
  addFavoriteItem,
  getFavoriteItemIds,
  getFavoriteMarketItems,
  removeFavoriteItem,
} from '../api';
import {
  normalizeMarketItemId,
  normalizeMarketItemIdList,
} from './marketItemId';

/** @type {Set<number>} */
let favoriteIds = new Set();
/** @type {Map<number, object>} */
let favoriteItemsById = new Map();
/** @type {Set<number>} */
let inFlightIds = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();

let hydratePromise = null;
let hydrated = false;

/** @type {{ favoriteIds: Set<number>, favoriteItems: object[], inFlightIds: Set<number>, hydrated: boolean }} */
let cachedSnapshot = {
  favoriteIds,
  favoriteItems: [],
  inFlightIds,
  hydrated: false,
};

/**
 * Подписка на изменения store.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeMarketFavorites(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Снимок для React-подписчиков (стабильная ссылка, пока нет изменений). */
export function getMarketFavoritesSnapshot() {
  return cachedSnapshot;
}

/** SSR/стартовый снимок. */
export function getMarketFavoritesServerSnapshot() {
  return {
    favoriteIds: new Set(),
    favoriteItems: [],
    inFlightIds: new Set(),
    hydrated: false,
  };
}

function _rebuildSnapshot() {
  cachedSnapshot = {
    favoriteIds,
    favoriteItems: Array.from(favoriteItemsById.values()),
    inFlightIds,
    hydrated,
  };
}

function _emit() {
  _rebuildSnapshot();
  listeners.forEach((listener) => listener());
}

/**
 * Загружает избранное с сервера один раз (повторно — только через force).
 *
 * @param {{ force?: boolean }} [options]
 */
export async function hydrateMarketFavorites(options = {}) {
  const force = Boolean(options.force);
  if (!force && hydrated) {
    return getMarketFavoritesSnapshot();
  }
  if (!force && hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    const [idsResponse, itemsResponse] = await Promise.all([
      getFavoriteItemIds(),
      getFavoriteMarketItems(),
    ]);
    const nextIds = new Set(normalizeMarketItemIdList(idsResponse?.data?.item_ids));
    const nextItems = new Map();
    const remoteItems = Array.isArray(itemsResponse?.data) ? itemsResponse.data : [];
    remoteItems.forEach((item) => {
      const itemId = normalizeMarketItemId(item?.id);
      if (itemId !== null && !item?.is_archived) {
        nextItems.set(itemId, item);
        nextIds.add(itemId);
      }
    });

    // Не затираем optimistic-изменения, пока запрос ещё в полёте.
    inFlightIds.forEach((itemId) => {
      if (favoriteIds.has(itemId)) {
        nextIds.add(itemId);
        const localItem = favoriteItemsById.get(itemId);
        if (localItem && !nextItems.has(itemId)) {
          nextItems.set(itemId, localItem);
        }
      } else {
        nextIds.delete(itemId);
        nextItems.delete(itemId);
      }
    });

    favoriteItemsById.forEach((item, itemId) => {
      if (nextIds.has(itemId) && !nextItems.has(itemId)) {
        nextItems.set(itemId, item);
      }
    });

    favoriteIds = nextIds;
    favoriteItemsById = nextItems;
    hydrated = true;
    _emit();
    return getMarketFavoritesSnapshot();
  })();

  try {
    return await hydratePromise;
  } catch (error) {
    hydratePromise = null;
    throw error;
  }
}

/**
 * Сбрасывает store (например, при выходе).
 */
export function resetMarketFavoritesStore() {
  favoriteIds = new Set();
  favoriteItemsById = new Map();
  inFlightIds = new Set();
  hydratePromise = null;
  hydrated = false;
  _emit();
}

/**
 * Мгновенно переключает избранное и синхронизирует с сервером в фоне.
 *
 * @param {unknown} rawItemId
 * @param {object | null | undefined} [itemHint] карточка товара для полоски профиля
 * @returns {Promise<boolean>}
 */
export async function toggleMarketFavorite(rawItemId, itemHint = null) {
  const itemId = normalizeMarketItemId(rawItemId);
  if (itemId === null || inFlightIds.has(itemId)) {
    return false;
  }

  const wasFavorite = favoriteIds.has(itemId);
  const previousItem = favoriteItemsById.get(itemId) || null;

  inFlightIds = new Set(inFlightIds);
  inFlightIds.add(itemId);

  const nextIds = new Set(favoriteIds);
  const nextItems = new Map(favoriteItemsById);
  if (wasFavorite) {
    nextIds.delete(itemId);
    nextItems.delete(itemId);
  } else {
    nextIds.add(itemId);
    const snapshot = itemHint && typeof itemHint === 'object' ? itemHint : previousItem;
    if (snapshot) {
      nextItems.set(itemId, snapshot);
    }
  }
  favoriteIds = nextIds;
  favoriteItemsById = nextItems;
  _emit();

  try {
    if (wasFavorite) {
      await removeFavoriteItem(itemId);
    } else {
      await addFavoriteItem(itemId);
    }
    return true;
  } catch (error) {
    const rollbackIds = new Set(favoriteIds);
    const rollbackItems = new Map(favoriteItemsById);
    if (wasFavorite) {
      rollbackIds.add(itemId);
      if (previousItem) {
        rollbackItems.set(itemId, previousItem);
      }
    } else {
      rollbackIds.delete(itemId);
      rollbackItems.delete(itemId);
    }
    favoriteIds = rollbackIds;
    favoriteItemsById = rollbackItems;
    _emit();
    throw error;
  } finally {
    inFlightIds = new Set(inFlightIds);
    inFlightIds.delete(itemId);
    _emit();
  }
}
