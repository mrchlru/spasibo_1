/**
 * Арбитр входных промо: установка и рефералка.
 * За один заход (session) — максимум одна кампания; между заходами чередуются.
 */

/** @typedef {'install' | 'referral'} EntryPromoSlot */

const LAST_SHOWN_KEY = 'spasibo_entry_promo_last';
const SESSION_SLOT_KEY = 'spasibo_entry_promo_session_slot';

/** @type {Set<() => void>} */
const listeners = new Set();

const installSoft = { ready: false, eligible: false };
const installAndroid = { ready: false, eligible: false };
const referral = { ready: false, eligible: false };

/**
 * Решение сессии: pending — пока не выбрали;
 * install | referral — выбранный слот (липкий до конца захода).
 *
 * @type {'pending' | EntryPromoSlot}
 */
let sessionDecision = _loadSessionDecision();

/** @type {{ slot: EntryPromoSlot | null, isReady: boolean } | null} */
let cachedSnapshot = null;

/**
 * Подписка на смену слота / готовности.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeEntryPromoRotation(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Снимок для useSyncExternalStore.
 *
 * @returns {{
 *   slot: EntryPromoSlot | null,
 *   isReady: boolean,
 * }}
 */
export function getEntryPromoRotationSnapshot() {
  const sourcesReady = _allSourcesReady();
  /** @type {EntryPromoSlot | null} */
  let slot = null;
  let isReady = false;

  if (sourcesReady) {
    _resolveIfNeeded();
    if (sessionDecision === 'install' || sessionDecision === 'referral') {
      slot = sessionDecision;
      isReady = true;
    }
  }

  if (
    cachedSnapshot
    && cachedSnapshot.slot === slot
    && cachedSnapshot.isReady === isReady
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = { slot, isReady };
  return cachedSnapshot;
}

/**
 * Назначенный слот этой сессии.
 *
 * @returns {EntryPromoSlot | null}
 */
export function getAssignedEntryPromoSlot() {
  return getEntryPromoRotationSnapshot().slot;
}

/**
 * Сообщает готовность мягкого промо установки (desktop / iOS).
 *
 * @param {{ ready: boolean, eligible: boolean }} status
 */
export function reportInstallSoftPromoStatus(status) {
  _applyStatus(installSoft, status);
  _onSourceChanged();
}

/**
 * Сообщает готовность Android install sheet (режим install).
 *
 * @param {{ ready: boolean, eligible: boolean }} status
 */
export function reportInstallAndroidPromoStatus(status) {
  _applyStatus(installAndroid, status);
  _onSourceChanged();
}

/**
 * Сообщает готовность реферальных stories.
 *
 * @param {{ ready: boolean, eligible: boolean }} status
 */
export function reportReferralPromoStatus(status) {
  _applyStatus(referral, status);
  _onSourceChanged();
}

/**
 * Фиксирует реальный показ — для чередования на следующем заходе.
 *
 * @param {EntryPromoSlot} slot
 */
export function markEntryPromoPresented(slot) {
  if (slot !== 'install' && slot !== 'referral') {
    return;
  }
  try {
    localStorage.setItem(LAST_SHOWN_KEY, slot);
  } catch {
    /* ignore */
  }
  if (sessionDecision !== slot) {
    sessionDecision = slot;
    _persistSessionDecision(slot);
    _emit();
  }
}

/**
 * Сброс in-memory (для тестов).
 */
export function resetEntryPromoRotationForTests() {
  installSoft.ready = false;
  installSoft.eligible = false;
  installAndroid.ready = false;
  installAndroid.eligible = false;
  referral.ready = false;
  referral.eligible = false;
  sessionDecision = 'pending';
  cachedSnapshot = null;
  try {
    sessionStorage.removeItem(SESSION_SLOT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ ready: boolean, eligible: boolean }} target
 * @param {{ ready: boolean, eligible: boolean }} status
 */
function _applyStatus(target, status) {
  const ready = Boolean(status?.ready);
  target.ready = ready;
  target.eligible = ready && Boolean(status?.eligible);
}

function _installEligible() {
  return installSoft.eligible || installAndroid.eligible;
}

function _allSourcesReady() {
  return installSoft.ready && installAndroid.ready && referral.ready;
}

function _onSourceChanged() {
  if (_allSourcesReady()) {
    _resolveIfNeeded();
  }
  _emit();
}

function _resolveIfNeeded() {
  if (sessionDecision === 'install' || sessionDecision === 'referral') {
    // Слот захода липкий: не переключаем на другую кампанию в этой же сессии.
    return;
  }

  const picked = _pickSlot(_installEligible(), referral.eligible);
  if (!picked) {
    return;
  }
  sessionDecision = picked;
  _persistSessionDecision(picked);
  try {
    localStorage.setItem(LAST_SHOWN_KEY, picked);
  } catch {
    /* ignore */
  }
}

/**
 * @param {boolean} installOk
 * @param {boolean} referralOk
 * @returns {EntryPromoSlot | null}
 */
function _pickSlot(installOk, referralOk) {
  if (installOk && referralOk) {
    const last = _readLastShown();
    // Чередование: после referral → install, иначе (в т.ч. первый раз) → referral.
    return last === 'referral' ? 'install' : 'referral';
  }
  if (installOk) {
    return 'install';
  }
  if (referralOk) {
    return 'referral';
  }
  return null;
}

/**
 * @returns {EntryPromoSlot | null}
 */
function _readLastShown() {
  try {
    const value = localStorage.getItem(LAST_SHOWN_KEY);
    if (value === 'install' || value === 'referral') {
      return value;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @returns {'pending' | EntryPromoSlot}
 */
function _loadSessionDecision() {
  try {
    const raw = sessionStorage.getItem(SESSION_SLOT_KEY);
    if (raw === 'install' || raw === 'referral') {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return 'pending';
}

/**
 * @param {EntryPromoSlot} decision
 */
function _persistSessionDecision(decision) {
  try {
    sessionStorage.setItem(SESSION_SLOT_KEY, decision);
  } catch {
    /* ignore */
  }
}

function _emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
}
