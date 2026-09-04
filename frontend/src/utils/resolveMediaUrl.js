import { getApiBaseUrl } from '../api.js';

/** Приложение «Спасибо» в Android WebView (см. userAgent SpasiboAndroid). */
export function isAndroidWebViewShell() {
  return typeof navigator !== 'undefined' && /SpasiboAndroid/i.test(navigator.userAgent);
}

function encodeUrlPath(url) {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://local.test';
    const parsed = new URL(url, base);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Подбирает URL картинки для текущего клиента: WebP-proxy для AVIF в Android WebView,
 * кодирование кириллицы в path для CSS/IMG.
 */
export function resolveMediaUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return '';
  }

  if (isAndroidWebViewShell() && /\.avif(\?|#|$)/i.test(trimmed)) {
    const absolute = trimmed.startsWith('/')
      ? `${window.location.origin}${trimmed}`
      : trimmed;
    const apiBase = getApiBaseUrl() || window.location.origin;
    return `${apiBase}/media/raster?src=${encodeURIComponent(absolute)}`;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return encodeUrlPath(trimmed);
  }

  return trimmed;
}
