/**
 * Определение платформы и «оболочки» клиента для аналитики.
 */

import { isSpasiboAndroidApp } from '../pwa/androidNativePush.js';
import {
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplayMode,
} from '../pwa/pushEnvironment.js';
import { isAndroidMobileBrowser } from '../pwa/mobileWelcomeGuide.js';

/**
 * @returns {{ client_platform: 'desktop' | 'ios' | 'android', client_shell: string }}
 */
export function getClientProfile() {
  if (isSpasiboAndroidApp()) {
    return { client_platform: 'android', client_shell: 'android-app' };
  }

  const isTelegram = Boolean(window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
  if (isTelegram) {
    if (isIosDevice()) {
      return { client_platform: 'ios', client_shell: 'telegram' };
    }
    if (isAndroidDevice()) {
      return { client_platform: 'android', client_shell: 'telegram' };
    }
    return { client_platform: 'desktop', client_shell: 'telegram' };
  }

  if (isIosDevice()) {
    return {
      client_platform: 'ios',
      client_shell: isStandaloneDisplayMode() ? 'ios-pwa' : 'ios-browser',
    };
  }

  if (isAndroidMobileBrowser()) {
    return { client_platform: 'android', client_shell: 'android-browser' };
  }

  if (isAndroidDevice()) {
    return { client_platform: 'android', client_shell: 'browser' };
  }

  return { client_platform: 'desktop', client_shell: 'browser' };
}
