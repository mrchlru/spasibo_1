import { isSpasiboAndroidApp } from './androidNativePush.js';
import { isAppleMobileDevice } from '../platform/iosGlass.js';

/** Android APK или iPhone / iPad. */
export function isMobileShellClient() {
  return isSpasiboAndroidApp() || isAppleMobileDevice();
}

/** Safari на iOS без «Добавить на экран» — SW часто отдаёт устаревший index. */
export function isIosSafariBrowserTab() {
  if (!isAppleMobileDevice()) {
    return false;
  }
  return !window.navigator.standalone;
}
