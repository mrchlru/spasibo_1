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
 * Раскладывает фото по сетке с лёгким джиттером без пересечений.
 *
 * @param {Array<{user_id: number, display_name?: string, is_me?: boolean}>} items
 * @param {{ cardW?: number, cardH?: number, gap?: number, pad?: number }} [options]
 * @returns {{ boardW: number, boardH: number, cardW: number, cardH: number, placed: Array<object> }}
 */
export function layoutNyWall(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const cardW = options.cardW ?? 92;
  const cardH = options.cardH ?? 114;
  const gap = options.gap ?? 16;
  const pad = options.pad ?? 48;
  const n = list.length;
  const cols = Math.max(3, Math.ceil(Math.sqrt(Math.max(n, 1) * 1.25)));
  const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
  const cellW = cardW + gap;
  const cellH = cardH + gap;
  const boardW = pad * 2 + cols * cellW;
  const boardH = pad * 2 + rows * cellH;
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
      x: pad + col * cellW + jx,
      y: pad + row * cellH + jy,
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
 * @returns {Promise<Blob>}
 */
export async function renderNyWallPng(layout, thumbUrls) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.boardW * scale));
  canvas.height = Math.max(1, Math.round(layout.boardH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas недоступен');
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#0a2417';
  ctx.fillRect(0, 0, layout.boardW, layout.boardH);

  // Лёгкий градиент «ёлки»
  const gradient = ctx.createRadialGradient(
    layout.boardW * 0.5,
    layout.boardH * 0.35,
    40,
    layout.boardW * 0.5,
    layout.boardH * 0.5,
    Math.max(layout.boardW, layout.boardH) * 0.7,
  );
  gradient.addColorStop(0, '#16452b');
  gradient.addColorStop(1, '#0a2417');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layout.boardW, layout.boardH);

  for (const card of layout.placed) {
    await _drawWallCard(ctx, card, thumbUrls[card.user_id] || '');
  }

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
 * Рисует одну карточку на canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card
 * @param {string} thumbUrl
 */
async function _drawWallCard(ctx, card, thumbUrl) {
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
  ctx.fillStyle = '#cfe6c7';
  ctx.fillRect(imgPad, imgPad, w - imgPad * 2, imgH);

  if (thumbUrl) {
    try {
      const image = await _loadImage(thumbUrl);
      ctx.drawImage(image, imgPad, imgPad, w - imgPad * 2, imgH);
    } catch {
      /* заглушка уже нарисована */
    }
  }

  ctx.fillStyle = '#333';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const label = String(name || 'Участник').slice(0, 16);
  ctx.fillText(label, w / 2, h - 6);
  ctx.restore();
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
