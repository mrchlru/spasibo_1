/**
 * Копирование и шаринг текста с учётом Android WebView «Спасибо».
 */

/**
 * Копирует текст в буфер обмена.
 * В APK сначала нативный мост, затем Clipboard API и execCommand.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyTextReliable(text) {
  const value = String(text || '');
  if (!value) {
    return false;
  }

  const bridge = typeof window !== 'undefined' ? window.SpasiboAndroid : null;
  if (bridge && typeof bridge.copyText === 'function') {
    try {
      if (bridge.copyText(value)) {
        return true;
      }
    } catch {
      /* fall through */
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }

  return copyTextViaExecCommand(value);
}

/**
 * Пользователь закрыл системный sheet «Поделиться» без отправки.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isShareDismissed(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = String(/** @type {{ name?: string }} */ (error).name || '');
  if (name === 'AbortError') {
    return true;
  }
  const message = String(/** @type {{ message?: string }} */ (error).message || '').toLowerCase();
  return (
    message.includes('abort')
    || message.includes('cancel')
    || message.includes('dismiss')
    || message.includes('share canceled')
    || message.includes('share cancelled')
  );
}

/**
 * Шаринг через нативный Android chooser или Web Share API.
 * Закрытие sheet пользователем → 'dismissed' (не ошибка).
 *
 * @param {{ text: string, title?: string, url?: string }} payload
 * @returns {Promise<'shared' | 'copied' | 'dismissed' | 'failed'>}
 */
export async function shareTextReliable(payload) {
  const text = String(payload?.text || payload?.url || '');
  const title = String(payload?.title || 'Спасибо');
  if (!text) {
    return 'failed';
  }

  const bridge = typeof window !== 'undefined' ? window.SpasiboAndroid : null;
  if (bridge && typeof bridge.shareText === 'function') {
    try {
      if (bridge.shareText(text, title)) {
        return 'shared';
      }
    } catch {
      /* fall through */
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const shareData = { title, text };
      if (payload?.url) {
        shareData.url = payload.url;
      }
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      if (isShareDismissed(error)) {
        return 'dismissed';
      }
      /* fall through to copy only on real share failures */
    }
  }

  const copied = await copyTextReliable(text);
  return copied ? 'copied' : 'failed';
}

/**
 * Fallback-копирование через скрытый textarea.
 *
 * @param {string} value
 * @returns {boolean}
 */
function copyTextViaExecCommand(value) {
  if (typeof document === 'undefined') {
    return false;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '0';
  textarea.style.top = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.opacity = '0';
  textarea.style.zIndex = '-1';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}
