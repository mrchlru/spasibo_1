/**
 * Серверное состояние рекламы установки на аккаунт (общее для устройств).
 */

import {
  getInstallPromoUserState,
  markInstallPromoUserDone,
  snoozeInstallPromoUserState,
} from '../api';
import {
  APP_INSTALL_PROMO_COOLDOWN_MS,
  APP_INSTALL_PROMO_DONE_KEY,
  APP_INSTALL_PROMO_SNOOZE_KEY,
  isAppInstallPromoDone,
  isAppInstallPromoSnoozed,
} from './appInstallPromo.js';

/** @type {{ is_done: boolean, is_snoozed: boolean, can_show: boolean, snoozed_until: string | null, done_reason: string | null } | null} */
let accountState = null;
let hydrated = false;
let hydratePromise = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * Подписка на обновление account-state.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeInstallPromoAccountState(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Текущий снимок (null до первой успешной загрузки). */
export function getInstallPromoAccountState() {
  return accountState;
}

/** Уже загружали состояние с сервера. */
export function isInstallPromoAccountStateHydrated() {
  return hydrated;
}

function _emit() {
  listeners.forEach((listener) => listener());
}

function _applyLocalSnoozeMirror() {
  try {
    const until = Date.now() + APP_INSTALL_PROMO_COOLDOWN_MS;
    localStorage.setItem(APP_INSTALL_PROMO_SNOOZE_KEY, String(until));
  } catch {
    /* ignore */
  }
}

function _applyLocalDoneMirror(reason) {
  try {
    localStorage.setItem(APP_INSTALL_PROMO_DONE_KEY, String(reason || 'done'));
    localStorage.removeItem(APP_INSTALL_PROMO_SNOOZE_KEY);
  } catch {
    /* ignore */
  }
}

function _normalizeState(raw) {
  return {
    is_done: Boolean(raw?.is_done),
    is_snoozed: Boolean(raw?.is_snoozed),
    can_show: raw?.can_show !== false && !raw?.is_done && !raw?.is_snoozed,
    snoozed_until: raw?.snoozed_until || null,
    done_reason: raw?.done_reason || null,
  };
}

/**
 * Можно ли показывать промо с учётом аккаунта + локального кэша.
 * До гидрации опираемся на localStorage.
 */
export function canShowInstallPromoForAccount() {
  if (accountState) {
    return Boolean(accountState.can_show);
  }
  if (isAppInstallPromoDone()) {
    return false;
  }
  if (isAppInstallPromoSnoozed()) {
    return false;
  }
  return true;
}

/**
 * Загружает состояние с сервера для текущего пользователя.
 *
 * @returns {Promise<object | null>}
 */
export async function hydrateInstallPromoAccountState() {
  if (hydratePromise) {
    return hydratePromise;
  }
  hydratePromise = (async () => {
    try {
      const response = await getInstallPromoUserState();
      accountState = _normalizeState(response?.data);
      hydrated = true;
      if (accountState.is_done) {
        _applyLocalDoneMirror(accountState.done_reason || 'done');
      } else if (accountState.is_snoozed && accountState.snoozed_until) {
        try {
          const untilMs = Date.parse(accountState.snoozed_until);
          if (Number.isFinite(untilMs)) {
            localStorage.setItem(APP_INSTALL_PROMO_SNOOZE_KEY, String(untilMs));
          }
        } catch {
          /* ignore */
        }
      }
      _emit();
      return accountState;
    } catch {
      hydrated = true;
      _emit();
      return accountState;
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

/**
 * Сбрасывает кэш (logout).
 */
export function resetInstallPromoAccountState() {
  accountState = null;
  hydrated = false;
  hydratePromise = null;
  _emit();
}

/**
 * Фиксирует показ / «Позже»: 3 дня на аккаунте.
 *
 * @returns {Promise<object | null>}
 */
export async function snoozeInstallPromoOnAccount() {
  _applyLocalSnoozeMirror();
  accountState = _normalizeState({
    ...(accountState || {}),
    is_snoozed: true,
    can_show: false,
    snoozed_until: new Date(Date.now() + APP_INSTALL_PROMO_COOLDOWN_MS).toISOString(),
  });
  _emit();
  try {
    const response = await snoozeInstallPromoUserState();
    accountState = _normalizeState(response?.data);
    hydrated = true;
    _emit();
    return accountState;
  } catch {
    return accountState;
  }
}

/**
 * Цель выполнена на аккаунте.
 *
 * @param {string} [reason]
 * @returns {Promise<object | null>}
 */
export async function markInstallPromoDoneOnAccount(reason = 'done') {
  _applyLocalDoneMirror(reason);
  accountState = _normalizeState({
    is_done: true,
    is_snoozed: false,
    can_show: false,
    done_reason: reason,
    snoozed_until: null,
  });
  _emit();
  try {
    const response = await markInstallPromoUserDone(reason);
    accountState = _normalizeState(response?.data);
    hydrated = true;
    _emit();
    return accountState;
  } catch {
    return accountState;
  }
}
