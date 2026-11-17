/**
 * Сжимает изображение на клиенте: длинная сторона ≤ maxSide, JPEG quality.
 *
 * @param {File} file
 * @param {{ maxSide?: number, quality?: number }} [options]
 * @returns {Promise<File>}
 */
export async function compressImageForNyUpload(file, options = {}) {
  const maxSide = options.maxSide ?? 1600;
  const quality = options.quality ?? 0.8;
  if (!file || !file.type?.startsWith('image/')) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', quality);
  });
  if (!blob) {
    return file;
  }
  const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
