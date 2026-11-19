/**
 * Раскладка и экспорт стены новогоднего ивента (майнд-доска без наложений).
 */

/**
 * Стабильный unit-hash 0..1.
 *
 * @param {number|string} seed
 * @returns {number}
 */
export function unitFromSeed(seed) {
  const text = String(seed ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * Выполняет mapper по элементам с ограничением параллелизма.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit || 1, list.length || 1));

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Раскладывает фото по сетке с лёгким джиттером без пересечений.
 *
 * @param {Array<{user_id: number, display_name?: string, is_me?: boolean}>} items
 * @param {{ cardW?: number, cardH?: number, gap?: number, pad?: number, minBoardW?: number, minBoardH?: number }} [options]
 * @returns {{ boardW: number, boardH: number, cardW: number, cardH: number, placed: Array<object> }}
 */
export function layoutNyWall(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const cardW = options.cardW ?? 92;
  const cardH = options.cardH ?? 114;
  const gap = options.gap ?? 16;
  const pad = options.pad ?? 48;
  const minBoardW = options.minBoardW ?? 0;
  const minBoardH = options.minBoardH ?? 0;
  const n = list.length;
  if (n === 0) {
    return {
      boardW: Math.max(minBoardW, pad * 2),
      boardH: Math.max(minBoardH, pad * 2),
      cardW,
      cardH,
      placed: [],
    };
  }

  // Плотная почти-квадратная сетка без пустых «зарезервированных» колонок.
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.1)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = cardW + gap;
  const cellH = cardH + gap;
  const contentW = pad * 2 + cols * cellW - gap;
  const contentH = pad * 2 + rows * cellH - gap;
  const boardW = Math.max(minBoardW, contentW);
  const boardH = Math.max(minBoardH, contentH);
  const originX = Math.max(pad, (boardW - (cols * cellW - gap)) / 2);
  const originY = Math.max(pad, (boardH - (rows * cellH - gap)) / 2);
  const maxJitter = Math.min(gap * 0.35, 6);

  const ordered = list
    .map((item) => ({ item, key: unitFromSeed(`ord-${item.user_id}`) }))
    .sort((a, b) => a.key - b.key);

  const placed = ordered.map((entry, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const jx = (unitFromSeed(`${entry.item.user_id}-jx`) - 0.5) * 2 * maxJitter;
    const jy = (unitFromSeed(`${entry.item.user_id}-jy`) - 0.5) * 2 * maxJitter;
    const rot = Math.round(unitFromSeed(`${entry.item.user_id}-r`) * 18 - 9);
    return {
      ...entry.item,
      x: originX + col * cellW + jx,
      y: originY + row * cellH + jy,
      w: cardW,
      h: cardH,
      rot,
    };
  });

  return { boardW, boardH, cardW, cardH, placed };
}

/**
 * Рисует всю доску в PNG и отдаёт Blob.
 *
 * @param {{ boardW: number, boardH: number, cardW: number, cardH: number, placed: Array<object> }} layout
 * @param {Record<string|number, string>} thumbUrls
 * @param {{ title?: string }} [options]
 * @returns {Promise<Blob>}
 */
export async function renderNyWallPng(layout, thumbUrls, options = {}) {
  const title = options.title || 'Фото коллег';
  const titleBand = 56;
  const pad = 28;
  const placed = layout.placed || [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const card of placed) {
    const extent = Math.max(card.w, card.h) * 0.2;
    minX = Math.min(minX, card.x - extent);
    minY = Math.min(minY, card.y - extent);
    maxX = Math.max(maxX, card.x + card.w + extent);
    maxY = Math.max(maxY, card.y + card.h + extent);
  }
  if (!placed.length) {
    minX = 0;
    minY = 0;
    maxX = 320;
    maxY = 240;
  }

  const contentW = Math.max(280, maxX - minX);
  const contentH = Math.max(200, maxY - minY);
  const boardW = contentW + pad * 2;
  const boardH = contentH + pad * 2 + titleBand;
  const offsetX = pad - minX;
  const offsetY = pad + titleBand - minY;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(boardW * scale));
  canvas.height = Math.max(1, Math.round(boardH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas недоступен');
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const gradient = ctx.createRadialGradient(
    boardW * 0.5,
    boardH * 0.32,
    30,
    boardW * 0.5,
    boardH * 0.55,
    Math.max(boardW, boardH) * 0.72,
  );
  gradient.addColorStop(0, '#1a5334');
  gradient.addColorStop(0.55, '#0f3422');
  gradient.addColorStop(1, '#071a10');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, boardW, boardH);

  _drawExportSnow(ctx, boardW, boardH);

  ctx.fillStyle = '#fff';
  ctx.font = '700 22px "Segoe UI", "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, boardW / 2, titleBand * 0.55);

  ctx.fillStyle = '#ffd86bcc';
  ctx.font = '600 12px "Segoe UI", "Helvetica Neue", sans-serif';
  ctx.fillText(`${placed.length} на стене`, boardW / 2, titleBand * 0.88);

  const images = await mapWithConcurrency(placed, 8, async (card) => {
    const url = thumbUrls[card.user_id] || '';
    if (!url) return null;
    try {
      return await _loadImage(url);
    } catch {
      return null;
    }
  });

  placed.forEach((card, index) => {
    _drawWallCard(ctx, {
      ...card,
      x: card.x + offsetX,
      y: card.y + offsetY,
    }, images[index]);
  });

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Не удалось создать PNG'));
    }, 'image/png');
  });
  return blob;
}

/**
 * Скачивает Blob как файл.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Рисует декоративные «снежинки» на экспорте.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} boardW
 * @param {number} boardH
 */
function _drawExportSnow(ctx, boardW, boardH) {
  const count = Math.min(90, Math.round((boardW * boardH) / 18000));
  for (let i = 0; i < count; i += 1) {
    const x = unitFromSeed(`snow-x-${i}`) * boardW;
    const y = unitFromSeed(`snow-y-${i}`) * boardH;
    const r = 0.6 + unitFromSeed(`snow-r-${i}`) * 1.8;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.18 + unitFromSeed(`snow-a-${i}`) * 0.35})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Рисует одну карточку на canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card
 * @param {HTMLImageElement|null} image
 */
function _drawWallCard(ctx, card, image) {
  const { x, y, w, h, rot, display_name: name, is_me: isMe } = card;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#0008';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  _roundRect(ctx, 0, 0, w, h, 3);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  if (isMe) {
    ctx.strokeStyle = '#ffd86b';
    ctx.lineWidth = 3;
    _roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 3);
    ctx.stroke();
  }

  const imgH = h - 22;
  const imgPad = 4;
  const imgW = w - imgPad * 2;
  ctx.fillStyle = '#cfe6c7';
  ctx.fillRect(imgPad, imgPad, imgW, imgH);

  if (image) {
    _drawImageCover(ctx, image, imgPad, imgPad, imgW, imgH);
  }

  ctx.fillStyle = '#333';
  ctx.font = '600 11px "Segoe UI", "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = String(name || 'Участник').slice(0, 16);
  ctx.fillText(label, w / 2, h - 6);
  ctx.restore();
}

/**
 * Рисует изображение с object-fit: cover.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} image
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function _drawImageCover(ctx, image, x, y, w, h) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function _roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function _loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = url;
  });
}
