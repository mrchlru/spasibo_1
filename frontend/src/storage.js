// frontend/src/storage.js

// Кеш живёт в трёх уровнях:
// 1) memoryCache — синхронный быстрый доступ из компонентов (stale-while-revalidate)
// 2) localStorage — переживает перезагрузку страницы/вкладки
// 3) Redis (только в Telegram WebApp) — синхронизация между устройствами/сессиями

import {
  getFeed,
  getMarketItems,
  getLeaderboard,
  getCache,
  setCache as setCacheAPI,
  deleteCache as deleteCacheAPI,
} from './api';

const getTelegramId = () => {
  return window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
};

// localStorage всегда есть и работает синхронно — это лучший быстрый кеш
// для первого рендера в браузере.
const fallbackStorage = {
  getItem: (key) => {
    try {
      const value = localStorage.getItem(`cache_${key}`);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Ошибка чтения из localStorage:', error);
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(`cache_${key}`, JSON.stringify(value));
    } catch (error) {
      console.error('Ошибка записи в localStorage:', error);
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(`cache_${key}`);
    } catch (error) {
      console.error('Ошибка удаления из localStorage:', error);
    }
  },
};

// Memory cache используется для синхронного доступа из компонентов:
// при заходе на страницу мы мгновенно отрисовываем то, что лежит здесь,
// а свежие данные подтягиваем в фоне.
const memoryCache = {
  feed: null,
  market: null,
  leaderboard: null,
  history: null,
  banners: null,
};

/**
 * Чтение значения из Redis (только в Telegram) с фолбэком на localStorage.
 * Синхронные данные кешируются в memoryCache — туда мы их и положим.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
const getStoredValue = async (key) => {
  const telegramId = getTelegramId();

  if (telegramId) {
    try {
      const response = await getCache(key);
      if (response.data && response.data.exists && response.data.value !== null) {
        return response.data.value;
      }
    } catch (error) {
      console.warn(`Не удалось получить кеш из Redis для ключа ${key}, используем fallback:`, error);
    }
  }

  return fallbackStorage.getItem(key);
};

/**
 * Инициализирует кэш при запуске приложения.
 *
 * Цель — максимально быстро заполнить memoryCache из синхронного localStorage
 * (это нулевая задержка первого рендера), а Redis-чтение и фоновое обновление
 * данных вынести в idle-фазу, чтобы они не конкурировали за сеть со стартовыми
 * запросами App.jsx (checkUserStatus, getFeed, getBanners, getAppSettings).
 */
export const initializeCache = async () => {
  // 1. Синхронно подтягиваем localStorage — это мгновенно и работает офлайн.
  for (const key of Object.keys(memoryCache)) {
    const cached = fallbackStorage.getItem(key);
    if (cached !== null) {
      memoryCache[key] = cached;
    }
  }

  const telegramId = getTelegramId();

  // 2. В Telegram-режиме можно дополнительно прогреть memoryCache из Redis,
  //    но строго в idle-фазе и без блокировки UI — старт приложения от этого
  //    больше не зависит (раньше 4 запроса /cache/* шли при инициализации,
  //    что в браузере выливалось в задержку загрузки приложения).
  if (telegramId) {
    scheduleIdle(() => {
      const keys = Object.keys(memoryCache);
      keys.forEach((key) => {
        getStoredValue(key)
          .then((value) => {
            if (value !== null) {
              memoryCache[key] = value;
            }
          })
          .catch(() => {});
      });
    });
  }
};

/**
 * Запускает callback в свободное время браузера. Если requestIdleCallback
 * недоступен (Safari), используем setTimeout с небольшой задержкой.
 */
function scheduleIdle(callback, timeout = 2000) {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 200);
  }
}

/**
 * Получает данные из кэша в памяти (синхронно).
 * @param {'feed' | 'market' | 'leaderboard' | 'history' | 'banners'} key
 */
export const getCachedData = (key) => {
  return memoryCache[key];
};

/**
 * Кладёт данные в memoryCache + localStorage (+ Redis в Telegram).
 * Запись в Redis идёт фоном и не блокирует вызов.
 * @param {'feed' | 'market' | 'leaderboard' | 'history' | 'banners'} key
 * @param {any} data
 */
export const setCachedData = async (key, data) => {
  memoryCache[key] = data;

  if (data === null) return;

  // localStorage обновляем всегда — он работает и в браузере, и в Telegram,
  // и нужен, чтобы переживать перезагрузку страницы.
  fallbackStorage.setItem(key, data);

  const telegramId = getTelegramId();
  if (telegramId) {
    // Redis-запись делаем «fire and forget», чтобы не задерживать рендер.
    setCacheAPI(key, data).catch((error) => {
      console.warn(`Не удалось сохранить кеш в Redis для ключа ${key}:`, error);
    });
  }
};

/**
 * Опционально обновляет основные кешируемые данные. Старая версия запускалась
 * автоматически при старте через setTimeout(100ms) и делала 3 тяжёлых запроса
 * (feed/market/leaderboard) даже если пользователь не собирался открывать эти
 * страницы — это и было одной из причин долгой загрузки приложения, особенно
 * в браузере. Теперь функция оставлена как явный инструмент: каждая страница
 * сама загружает свои данные через stale-while-revalidate.
 */
export const refreshAllData = async () => {
  const [feedRes, marketRes, leaderboardRes] = await Promise.allSettled([
    getFeed(),
    getMarketItems(),
    getLeaderboard({ period: 'current_month', type: 'received' }),
  ]);

  const updates = [];

  if (feedRes.status === 'fulfilled' && feedRes.value?.data) {
    updates.push(setCachedData('feed', feedRes.value.data));
  }
  if (marketRes.status === 'fulfilled' && marketRes.value?.data) {
    updates.push(setCachedData('market', marketRes.value.data));
  }
  if (leaderboardRes.status === 'fulfilled' && leaderboardRes.value?.data) {
    updates.push(setCachedData('leaderboard', leaderboardRes.value.data));
  }

  await Promise.all(updates);
};

/**
 * Очищает кэш для определенного ключа.
 * Используется после действий, которые делают данные неактуальными (например, покупка).
 * @param {'feed' | 'market' | 'leaderboard' | 'history' | 'banners'} key
 */
export const clearCache = async (key) => {
  memoryCache[key] = null;
  fallbackStorage.removeItem(key);

  const telegramId = getTelegramId();
  if (telegramId) {
    try {
      await deleteCacheAPI(key);
    } catch (error) {
      console.warn(`Не удалось очистить кеш из Redis для ключа ${key}:`, error);
    }
  }
};
