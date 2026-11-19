import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './NyMindBoard.module.css';
import { layoutNyWall } from '../../utils/nyWallLayout';

/**
 * Стена фото: статичный фон до подарка или пан-майнд-доска после.
 *
 * @param {{
 *   items: Array<object>,
 *   thumbUrls: Record<string|number, string>,
 *   interactive: boolean,
 *   onPhotoClick: (item: object) => void,
 * }} props
 */
function NyMindBoard({ items, thumbUrls, interactive, onPhotoClick }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    function measure() {
      setViewportSize({
        w: viewport.clientWidth,
        h: viewport.clientHeight,
      });
    }
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(viewport);
    else window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, []);

  const layout = useMemo(
    () =>
      layoutNyWall(items, {
        cardW: interactive ? 92 : 76,
        cardH: interactive ? 114 : 96,
        // Не меньше экрана — иначе виден «тёмный лист» доски на фоне.
        minBoardW: Math.max(viewportSize.w, 360),
        minBoardH: Math.max(viewportSize.h, 640),
      }),
    [items, interactive, viewportSize.w, viewportSize.h],
  );

  useEffect(() => {
    const vw = viewportSize.w;
    const vh = viewportSize.h;
    if (!vw || !vh) return;
    if (interactive) {
      setOffset({
        x: Math.min(0, (vw - layout.boardW) / 2),
        y: Math.min(0, (vh - layout.boardH) / 2),
      });
    } else {
      setOffset({
        x: Math.min(-24, (vw - layout.boardW) * 0.12),
        y: Math.min(-16, (vh - layout.boardH) * 0.08),
      });
    }
  }, [layout.boardW, layout.boardH, interactive, items.length, viewportSize.w, viewportSize.h]);

  function clampOffset(nextX, nextY) {
    const viewport = viewportRef.current;
    if (!viewport) return { x: nextX, y: nextY };
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const minX = Math.min(0, vw - layout.boardW);
    const minY = Math.min(0, vh - layout.boardH);
    return {
      x: Math.max(minX, Math.min(0, nextX)),
      y: Math.max(minY, Math.min(0, nextY)),
    };
  }

  function onPointerDown(event) {
    if (!interactive) return;
    if (event.target.closest(`.${styles.card}`)) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    setOffset(clampOffset(drag.originX + dx, drag.originY + dy));
  }

  function onPointerUp(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={viewportRef}
      className={`${styles.viewport}${interactive ? ` ${styles.interactive}` : ` ${styles.static}`}${
        dragging ? ` ${styles.dragging}` : ''
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={styles.board}
        style={{
          width: layout.boardW,
          height: layout.boardH,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        {layout.placed.map((card) => (
          <button
            type="button"
            key={card.user_id}
            className={`${styles.card}${card.is_me ? ` ${styles.cardMe}` : ''}`}
            style={{
              left: card.x,
              top: card.y,
              width: card.w,
              height: card.h,
              transform: `rotate(${card.rot}deg)`,
            }}
            disabled={!interactive}
            onClick={() => {
              if (!interactive) return;
              if (dragRef.current?.moved) return;
              onPhotoClick?.(card);
            }}
          >
            {thumbUrls[card.user_id] ? (
              <img className={styles.img} src={thumbUrls[card.user_id]} alt="" loading="lazy" draggable={false} />
            ) : (
              <div className={styles.img} />
            )}
            <span className={styles.name}>{card.display_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default NyMindBoard;
