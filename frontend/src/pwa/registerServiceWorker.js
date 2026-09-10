import { isSpasiboAndroidApp } from './androidNativePush.js';
import { isIosSafariBrowserTab } from './mobileClient.js';

/** Снимает старый SW — на iOS/Android он часто отдаёт устаревший index.js. */
async function unregisterLegacyServiceWorkers() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('spasibo-'))
          .map((key) => caches.delete(key)),
      );
    }
  } catch {
    /* ignore */
  }
}

/** Регистрирует service worker приложения «Спасибо». */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }
  if (isIosSafariBrowserTab() || isSpasiboAndroidApp()) {
    await unregisterLegacyServiceWorkers();
    return null;
  }

  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
