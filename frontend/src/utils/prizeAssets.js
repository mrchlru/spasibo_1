/** Проверяет, является ли выданный код URL картинки приза. */
export function isPrizeImageUrl(value) {
  return typeof value === 'string' && value.includes('/market-prizes/');
}

/** Скачивает файл по URL. */
export async function downloadUrlAsFile(url, filename) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Download failed');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
