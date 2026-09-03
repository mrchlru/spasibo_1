import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-and-drop (мышь + touch) для переупорядочивания списка по id.
 *
 * @param {Array<{id: number}>} items
 * @param {(next: Array) => void} setItems
 * @param {(orderedIds: number[]) => Promise<void>} onPersist
 */
export function useDragReorder(items, setItems, onPersist) {
  const [dragId, setDragId] = useState(null);
  const itemsRef = useRef(items);
  const touchActiveRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const moveIdBeforeTarget = useCallback(
    (fromId, targetId) => {
      if (!fromId || fromId === targetId) {
        return;
      }
      setItems((prev) => {
        const next = [...prev];
        const fromIndex = next.findIndex((row) => row.id === fromId);
        const toIndex = next.findIndex((row) => row.id === targetId);
        if (fromIndex < 0 || toIndex < 0) {
          return prev;
        }
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [setItems],
  );

  const handleDragStart = useCallback((itemId) => {
    touchActiveRef.current = false;
    setDragId(itemId);
  }, []);

  const handleDragOver = useCallback(
    (event, targetId) => {
      event.preventDefault();
      if (touchActiveRef.current) {
        return;
      }
      moveIdBeforeTarget(dragId, targetId);
    },
    [dragId, moveIdBeforeTarget],
  );

  const handleDragEnd = useCallback(async () => {
    if (!dragId) {
      return;
    }
    setDragId(null);
    await onPersist(itemsRef.current.map((row) => row.id));
  }, [dragId, onPersist]);

  const handleTouchStart = useCallback((event, itemId) => {
    if (event.touches.length !== 1) {
      return;
    }
    touchActiveRef.current = true;
    setDragId(itemId);
  }, []);

  const handleTouchMove = useCallback(
    (event) => {
      if (!touchActiveRef.current || !dragId || event.touches.length !== 1) {
        return;
      }
      event.preventDefault();
      const touch = event.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const row = el?.closest?.('[data-sortable-id]');
      if (!row) {
        return;
      }
      const targetId = Number(row.getAttribute('data-sortable-id'));
      if (!Number.isFinite(targetId)) {
        return;
      }
      moveIdBeforeTarget(dragId, targetId);
    },
    [dragId, moveIdBeforeTarget],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!touchActiveRef.current || !dragId) {
      return;
    }
    touchActiveRef.current = false;
    setDragId(null);
    await onPersist(itemsRef.current.map((row) => row.id));
  }, [dragId, onPersist]);

  return {
    dragId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
