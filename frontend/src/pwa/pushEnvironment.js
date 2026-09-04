/** Приложение открыто с иконки на главном экране (PWA), а не во вкладке браузера. */
export function isStandaloneDisplayMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  );
}

/** Android-телефон или планшет. */
export function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

/** Яндекс.Бrowser (mobile/desktop). */
export function isYandexBrowser() {
  return /YaBrowser/i.test(navigator.userAgent);
}

/** iPhone / iPad (включая iPadOS с desktop UA). */
export function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Браузер поддерживает Notification API. */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/** Браузер поддерживает Service Worker. */
export function isServiceWorkerSupported() {
  return 'serviceWorker' in navigator;
}

/** Браузер поддерживает Web Push (минимальная проверка). */
export function isPushApiAvailable() {
  return isNotificationSupported() && isServiceWorkerSupported();
}

/** Возвращает причину, по которой push пока недоступен, или null если можно продолжать. */
export function getPushBlockReason(options = {}) {
  if (!isServiceWorkerSupported()) {
    return 'service_worker_unavailable';
  }

  if (!isNotificationSupported()) {
    if (isIosDevice()) {
      return isStandaloneDisplayMode() ? 'ios_needs_update' : 'ios_needs_standalone';
    }
    return 'unsupported_browser';
  }

  if (!options.skipPermissionCheck && Notification.permission === 'denied') {
    return 'permission_denied';
  }

  return null;
}

function isSpasiboAndroidShell() {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.SpasiboAndroid) || /SpasiboAndroid\/\d/i.test(navigator.userAgent);
}

/** Человекочитаемая подсказка для пользователя. */
export function pushBlockReasonMessage(reason) {
  switch (reason) {
    case 'ios_needs_standalone':
      return 'На iPhone push работает только из приложения на главном экране. Закройте Safari и откройте «Спасибо» с иконки.';
    case 'ios_needs_update':
      return 'Для push на iPhone нужен iOS 16.4 или новее. Обновите систему и откройте приложение с иконки.';
    case 'unsupported_browser':
      if (isYandexBrowser()) {
        return 'Обновите Яндекс.Бrowser до последней версии. Push работает в обычной вкладке и с иконки на экране.';
      }
      return 'Этот браузер не поддерживает push. На Android — Chrome или Яндекс.Бrowser, на iPhone — Safari с иконкой на экране.';
    case 'permission_denied':
      if (isYandexBrowser() && isAndroidDevice()) {
        return 'Уведомления запрещены. Меню Яндекса (⋮) → Настройки → Уведомления → разрешите для этого сайта.';
      }
      return isIosDevice()
        ? 'Уведомления запрещены. Настройки → Уведомления → Спасибо → Разрешить.'
        : 'Уведомления запрещены. Разрешите их в настройках браузера для этого сайта.';
    case 'permission_dismissed':
      if (isSpasiboAndroidShell()) {
        return 'Разрешите уведомления для приложения «Спасибо» в системных настройках или нажмите кнопку ещё раз.';
      }
      if (isYandexBrowser() && isAndroidDevice()) {
        return 'Запрос не показался. Откройте сайт во вкладке Яндекса (не с иконки), нажмите кнопку снова и выберите «Разрешить».';
      }
      return 'Вы не подтвердили запрос. Нажмите кнопку ещё раз и выберите «Разрешить».';
    case 'service_worker_unavailable':
      return 'Service Worker недоступен. Перезагрузите страницу и попробуйте снова.';
    case 'server_disabled':
      return 'Push на сервере временно отключён. Попробуйте позже.';
    case 'subscribe_failed':
      return 'Не удалось оформить подписку. Перезагрузите приложение и попробуйте снова.';
    default:
      return 'Не удалось включить push-уведомления.';
  }
}
