import { isSpasiboAndroidApp } from '../pwa/androidNativePush.js';

/**
 * Открывает URL во внешнем браузере (минуя WebView / in-app навигацию).
 *
 * @param {string} url
 */
export function openExternalLink(url) {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) {
    return;
  }

  if (isSpasiboAndroidApp() && window.SpasiboAndroid?.openExternalUrl) {
    window.SpasiboAndroid.openExternalUrl(trimmed);
    return;
  }

  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(trimmed);
    return;
  }

  const opened = window.open(trimmed, '_blank', 'noopener,noreferrer');
  if (opened) {
    return;
  }

  window.location.assign(trimmed);
}

/** True, если строка — http(s)-ссылка. */
export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}
