/** Реферальная кампания: нормализация настроек и локальный ref-код. */

export const DEFAULT_REFERRAL = {
  enabled: false,
  started_at: null,
  ends_at: null,
  inactive_months: 3,
  reactivation_min_days: 3,
  reactivation_window_days: 7,
  bonus_new_inviter: 15,
  bonus_new_invitee: 15,
  bonus_reactivate_inviter: 15,
  bonus_reactivate_invitee: 15,
  promo_admins_only: false,
  promo_allowed_user_ids: [],
};

const REF_STORAGE_KEY = 'spasibo_referral_code';

/**
 * Нормализует список id пользователей.
 *
 * @param {unknown} raw
 * @returns {number[]}
 */
export function normalizeReferralUserIds(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Нормализует payload реферальной кампании.
 *
 * @param {unknown} raw
 * @returns {typeof DEFAULT_REFERRAL}
 */
export function normalizeReferral(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    started_at: src.started_at ? String(src.started_at) : null,
    ends_at: src.ends_at ? String(src.ends_at) : null,
    inactive_months: Math.max(1, Number(src.inactive_months) || 3),
    reactivation_min_days: Math.max(1, Number(src.reactivation_min_days) || 3),
    reactivation_window_days: Math.max(1, Number(src.reactivation_window_days) || 7),
    bonus_new_inviter: Math.max(0, Number(src.bonus_new_inviter) || 0),
    bonus_new_invitee: Math.max(0, Number(src.bonus_new_invitee) || 0),
    bonus_reactivate_inviter: Math.max(0, Number(src.bonus_reactivate_inviter) || 0),
    bonus_reactivate_invitee: Math.max(0, Number(src.bonus_reactivate_invitee) || 0),
    promo_admins_only: Boolean(src.promo_admins_only),
    promo_allowed_user_ids: normalizeReferralUserIds(src.promo_allowed_user_ids),
  };
}

/**
 * Расписание кампании на 30 дней от now.
 *
 * @param {Date} [from]
 * @returns {{ started_at: string, ends_at: string }}
 */
export function buildReferralSchedule(from = new Date()) {
  const started = new Date(from.getTime());
  const ends = new Date(started.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    started_at: started.toISOString(),
    ends_at: ends.toISOString(),
  };
}

/**
 * Кампания в активном временном окне.
 *
 * @param {unknown} campaign
 * @returns {boolean}
 */
export function isReferralWithinSchedule(campaign) {
  const normalized = normalizeReferral(campaign);
  if (!normalized.enabled) {
    return false;
  }
  const now = Date.now();
  if (normalized.started_at) {
    const start = Date.parse(normalized.started_at);
    if (Number.isFinite(start) && now < start) {
      return false;
    }
  }
  if (normalized.ends_at) {
    const end = Date.parse(normalized.ends_at);
    if (Number.isFinite(end) && now >= end) {
      return false;
    }
  }
  return true;
}

/**
 * Ограничена ли аудитория рекламы.
 *
 * @param {unknown} campaign
 * @returns {boolean}
 */
export function isReferralPromoRestricted(campaign) {
  const normalized = normalizeReferral(campaign);
  return normalized.promo_admins_only || normalized.promo_allowed_user_ids.length > 0;
}

/**
 * Разрешён ли показ рекламы пользователю.
 *
 * @param {unknown} campaign
 * @param {{ isAdmin?: boolean, userId?: number | null }} [options]
 * @returns {boolean}
 */
export function isReferralPromoAudienceAllowed(campaign, options = {}) {
  const normalized = normalizeReferral(campaign);
  if (!isReferralPromoRestricted(normalized)) {
    return true;
  }
  if (normalized.promo_admins_only && options.isAdmin) {
    return true;
  }
  const userId = Number(options.userId);
  if (Number.isFinite(userId) && normalized.promo_allowed_user_ids.includes(userId)) {
    return true;
  }
  return false;
}

/**
 * Показывать ли вход в рефералку (плашка / история).
 *
 * @param {unknown} campaign
 * @param {{ isAdmin?: boolean, userId?: number | null }} [options]
 * @returns {boolean}
 */
export function canShowReferralEntry(campaign, options = {}) {
  if (!isReferralWithinSchedule(campaign)) {
    return false;
  }
  return isReferralPromoAudienceAllowed(campaign, options);
}

/**
 * Сохраняет ref из URL в localStorage.
 *
 * @param {string | null | undefined} code
 */
export function storePendingReferralCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    return;
  }
  try {
    localStorage.setItem(REF_STORAGE_KEY, normalized);
  } catch {
    /* ignore */
  }
}

/**
 * Читает сохранённый ref-код.
 *
 * @returns {string | null}
 */
export function getPendingReferralCode() {
  try {
    const value = localStorage.getItem(REF_STORAGE_KEY);
    return value ? String(value).trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Удаляет сохранённый ref-код.
 */
export function clearPendingReferralCode() {
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Забирает ?ref= из текущего URL и сохраняет.
 *
 * @returns {string | null}
 */
export function captureReferralCodeFromLocation() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) {
      return getPendingReferralCode();
    }
    storePendingReferralCode(ref);
    url.searchParams.delete('ref');
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
    return String(ref).trim().toUpperCase();
  } catch {
    return null;
  }
}
