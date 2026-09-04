import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addFavoriteItem,
  getFavoriteItemIds,
  removeFavoriteItem,
} from '../api';
import {
  normalizeMarketItemId,
  normalizeMarketItemIdList,
} from '../utils/marketItemId';

/** Загрузка и переключение избранных товаров магазина. */
export function useMarketFavorites({ enabled = true }) {
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [togglingIds, setTogglingIds] = useState(new Set());
  const favoriteIdsRef = useRef(favoriteIds);

  useEffect(() => {
    favoriteIdsRef.current = favoriteIds;
  }, [favoriteIds]);

  useEffect(() => {
    if (!enabled) {
      setFavoriteIds(new Set());
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await getFavoriteItemIds();
        if (!cancelled) {
          setFavoriteIds(new Set(normalizeMarketItemIdList(response.data.item_ids)));
        }
      } catch {
        if (!cancelled) {
          setFavoriteIds(new Set());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const toggleFavorite = useCallback(async (rawItemId) => {
    const itemId = normalizeMarketItemId(rawItemId);
    if (!enabled || itemId === null) {
      return false;
    }

    let togglingStarted = false;
    setTogglingIds((current) => {
      if (current.has(itemId)) {
        return current;
      }
      togglingStarted = true;
      const next = new Set(current);
      next.add(itemId);
      return next;
    });

    if (!togglingStarted) {
      return false;
    }

    const wasFavorite = favoriteIdsRef.current.has(itemId);

    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });

    try {
      if (wasFavorite) {
        await removeFavoriteItem(itemId);
      } else {
        await addFavoriteItem(itemId);
      }
      return true;
    } catch {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) {
          next.add(itemId);
        } else {
          next.delete(itemId);
        }
        return next;
      });
      return false;
    } finally {
      setTogglingIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }, [enabled]);

  const isFavorite = useCallback(
    (rawItemId) => {
      const itemId = normalizeMarketItemId(rawItemId);
      return itemId !== null && favoriteIds.has(itemId);
    },
    [favoriteIds],
  );

  return {
    favoriteIds,
    loading,
    togglingIds,
    togglingId: togglingIds.size === 1 ? [...togglingIds][0] : null,
    isFavorite,
    toggleFavorite,
  };
}
