import { useEffect, useRef } from 'react';

/**
 * Вызывает onLoadMore, когда sentinel попадает в viewport.
 *
 * @param {{ hasMore: boolean, isLoading: boolean, onLoadMore: () => void, rootMargin?: string }} options
 * @returns {import('react').RefObject<HTMLDivElement>}
 */
export function useInfiniteScroll({ hasMore, isLoading, onLoadMore, rootMargin = '240px' }) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!hasMore || isLoading) {
      return undefined;
    }
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore, rootMargin]);

  return sentinelRef;
}
