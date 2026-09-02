/**
 * Детект Apple-устройств и флаг темы «liquid glass».
 * Откат: localStorage.setItem('spasibo-ios-glass', '0') или VITE_IOS_GLASS=0
 */

const STORAGE_KEY = 'spasibo-ios-glass';

/** iPhone / iPad / iPadOS (в т.ч. десктопный UA на iPadOS 13+). */
export function isAppleMobileDevice() {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/i.test(ua)) {
    return true;
  }
  if (/iPad/i.test(ua)) {
    return true;
  }
  const isMac = /Macintosh/i.test(ua);
  const touchPoints = navigator.maxTouchPoints ?? 0;
  return isMac && touchPoints > 1;
}

/** Включена ли iOS glass-тема (с учётом явного отката). */
export function isIosGlassEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const override = window.localStorage.getItem(STORAGE_KEY);
    if (override === '0') {
      return false;
    }
    if (override === '1') {
      return true;
    }
  } catch {
    /* private mode */
  }
  const envFlag = String(import.meta.env.VITE_IOS_GLASS ?? '').trim();
  if (envFlag === '0' || envFlag === 'false') {
    return false;
  }
  if (envFlag === '1' || envFlag === 'true') {
    return true;
  }
  return isAppleMobileDevice();
}

/** Ставит data-platform на <html> для CSS-темы. */
export function applyPlatformTheme() {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (isIosGlassEnabled()) {
    root.setAttribute('data-platform', 'ios');
  } else {
    root.removeAttribute('data-platform');
  }
}
