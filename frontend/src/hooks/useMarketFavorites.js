import { useCallback, useEffect, useState } from 'react';
import {
  addFavoriteItem,
  getFavoriteItemIds,
  removeFavoriteItem,
} from '../api';

/** Загрузка и переключение избранных товаров магазина. */
export function useMarketFavorites({ enabled = true }) {
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

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
          setFavoriteIds(new Set(response.data.item_ids ?? []));
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

  const toggleFavorite = useCallback(async (itemId) => {
    if (!enabled || togglingId !== null) {
      return;
    }

    let wasFavorite = false;
    setFavoriteIds((current) => {
      wasFavorite = current.has(itemId);
      const next = new Set(current);
      if (wasFavorite) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });

    setTogglingId(itemId);

    try {
      if (wasFavorite) {
        await removeFavoriteItem(itemId);
      } else {
        await addFavoriteItem(itemId);
      }
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
    } finally {
      setTogglingId(null);
    }
  }, [enabled, togglingId]);

  const isFavorite = useCallback((itemId) => favoriteIds.has(itemId), [favoriteIds]);

  return {
    favoriteIds,
    loading,
    togglingId,
    isFavorite,
    toggleFavorite,
  };
}
