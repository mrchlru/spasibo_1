// frontend/src/main.jsx
console.log('--- Application bootstrap sequence initiated ---'); 

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './styles/iosLiquidGlass.css';
import { applyPlatformTheme } from './platform/iosGlass.js';
import { registerServiceWorker } from './pwa/registerServiceWorker.js';
import { isSpasiboAndroidApp } from './pwa/androidNativePush.js';

applyPlatformTheme();

if (isSpasiboAndroidApp()) {
  window.addEventListener('load', () => {
    window.setTimeout(() => {
      void registerServiceWorker();
    }, 5000);
  }, { once: true });
} else {
  registerServiceWorker();
}

// 1. Импортируем наши ПРАВИЛЬНЫЕ Provider'ы
import { ModalAlertProvider } from './contexts/ModalAlertContext.jsx';
import { ConfirmationProvider } from './contexts/ConfirmationContext.jsx';

// --- НАЧАЛО ИЗМЕНЕНИЙ: Локализация календаря ---
import { registerLocale } from 'react-datepicker';
import { ru } from 'date-fns/locale/ru';

// Регистрируем русскую локаль под кодом 'ru'
registerLocale('ru', ru);
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* 2. Оборачиваем App в правильные Provider'ы */}
    {/* Теперь они действительно будут работать для всего приложения */}
    <ConfirmationProvider>
      <ModalAlertProvider>
        <App />
      </ModalAlertProvider>
    </ConfirmationProvider>
  </React.StrictMode>,
);

// Прячем inline-лоадер из index.html, как только React смонтировал дерево.
// Это короткая задержка через rAF — чтобы первый кадр приложения уже был
// отрисован к моменту скрытия и не было «мигания» белым.
if (typeof window !== 'undefined') {
  const hideInitialLoader = () => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.setAttribute('data-hidden', 'true');
      // Удаляем из DOM после анимации, чтобы он не перехватывал клики.
      setTimeout(() => loader.remove(), 250);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(hideInitialLoader));
}
