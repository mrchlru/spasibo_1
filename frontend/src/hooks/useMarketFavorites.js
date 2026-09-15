import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getMarketFavoritesServerSnapshot,
  getMarketFavoritesSnapshot,
  hydrateMarketFavorites,
  subscribeMarketFavorites,
  toggleMarketFavorite,
} from '../utils/marketFavoritesStore';
import { normalizeMarketItemId } from '../utils/marketItemId';

/** Загрузка и мгновенное переключение избранных товаров магазина. */
export function useMarketFavorites({ enabled = true } = {}) {
  const snapshot = useSyncExternalStore(
    subscribeMarketFavorites,
    getMarketFavoritesSnapshot,
    getMarketFavoritesServerSnapshot,
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    void hydrateMarketFavorites().catch(() => {
      if (!cancelled) {
        /* пустой store — кнопка остаётся кликабельной */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const toggleFavorite = useCallback(async (rawItemId, itemHint = null) => {
    if (!enabled) {
      return false;
    }
    try {
      return await toggleMarketFavorite(rawItemId, itemHint);
    } catch {
      return false;
    }
  }, [enabled]);

  const isFavorite = useCallback(
    (rawItemId) => {
      const itemId = normalizeMarketItemId(rawItemId);
      return itemId !== null && snapshot.favoriteIds.has(itemId);
    },
    [snapshot.favoriteIds],
  );

  return {
    favoriteIds: snapshot.favoriteIds,
    favoriteItems: snapshot.favoriteItems,
    loading: enabled && !snapshot.hydrated,
    togglingIds: snapshot.inFlightIds,
    isFavorite,
    toggleFavorite,
  };
}
