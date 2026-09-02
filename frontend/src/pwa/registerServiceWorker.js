/** Регистрирует service worker приложения «Спасибо». */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
