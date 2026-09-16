import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import styles from './ReferralPromo.module.css';
import {
  getReferralPromoState,
  snoozeReferralPromo,
  markReferralPromoDone,
} from '../api';
import {
  isReferralPromoAudienceAllowed,
  isReferralPromoRestricted,
  isReferralWithinSchedule,
  normalizeReferral,
} from '../pwa/referralCampaign.js';

const SESSION_KEY = 'spasibo_referral_promo_shown';

/**
 * Дружелюбный sheet с рекламой реферальной акции.
 */
function ReferralPromo({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
  referral = null,
  hasBottomNav = false,
  onOpenReferral,
}) {
  const campaign = useMemo(() => normalizeReferral(referral), [referral]);
  const [visible, setVisible] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [accountCanShow, setAccountCanShow] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const shownThisSession = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem(SESSION_KEY) === '1';
      } catch {
        return false;
      }
    },
    () => false,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!user?.id || user.status !== 'approved') {
        return;
      }
      try {
        const response = await getReferralPromoState();
        if (!cancelled) {
          setAccountCanShow(Boolean(response?.data?.can_show));
          setHydrated(true);
        }
      } catch {
        if (!cancelled) {
          setAccountCanShow(true);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.status]);

  useEffect(() => {
    if (!bootReady || loading || isOnboardingVisible || !hydrated) {
      setVisible(false);
      return;
    }
    if (!user || user.status !== 'approved') {
      setVisible(false);
      return;
    }
    if (!isReferralWithinSchedule(campaign)) {
      setVisible(false);
      return;
    }
    if (!isReferralPromoAudienceAllowed(campaign, {
      isAdmin: Boolean(user.is_admin),
      userId: user.id,
    })) {
      setVisible(false);
      return;
    }
    if (isReferralPromoRestricted(campaign) && !accountCanShow) {
      setVisible(false);
      return;
    }
    if (!accountCanShow) {
      setVisible(false);
      return;
    }
    if (shownThisSession) {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, [
    accountCanShow,
    bootReady,
    campaign,
    hydrated,
    isOnboardingVisible,
    loading,
    shownThisSession,
    user,
  ]);

  function markSessionShown() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  async function handleLater() {
    markSessionShown();
    setVisible(false);
    try {
      await snoozeReferralPromo();
    } catch {
      /* ignore */
    }
  }

  async function handleOpen() {
    markSessionShown();
    setVisible(false);
    try {
      await markReferralPromoDone('opened');
    } catch {
      /* ignore */
    }
    onOpenReferral?.();
  }

  if (!visible) {
    return null;
  }

  const bonusHint = Math.max(
    campaign.bonus_new_inviter,
    campaign.bonus_reactivate_inviter,
  );

  return (
    <div
      className={styles.overlay}
      style={hasBottomNav ? { paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      <button type="button" className={styles.backdrop} aria-label="Закрыть" onClick={handleLater} />
      <div className={styles.sheet} role="dialog" aria-labelledby="referral-promo-title">
        <p className={styles.eyebrow}>Акция для коллег</p>
        <h2 id="referral-promo-title" className={styles.title}>
          Получи бонусы за коллегу
        </h2>
        <p className={styles.text}>
          Поделись персональной ссылкой. Новым — бонус сразу, вернувшимся —
          после нескольких активных дней. До {bonusHint} спасибок вам обоим.
        </p>
        <button
          type="button"
          className={styles.rulesBtn}
          onClick={() => setRulesOpen((open) => !open)}
        >
          {rulesOpen ? 'Скрыть правила' : 'Правила акции'}
        </button>
        {rulesOpen && (
          <ol className={styles.rulesList}>
            <li>У каждого своя ссылка в профиле.</li>
            <li>
              Новый пользователь: бонус после регистрации и входа
              ({campaign.bonus_new_inviter} / {campaign.bonus_new_invitee}).
            </li>
            <li>
              Без активности {campaign.inactive_months} мес.: отправить спасибки
              минимум {campaign.reactivation_min_days} дня за {campaign.reactivation_window_days} дней
              ({campaign.bonus_reactivate_inviter} / {campaign.bonus_reactivate_invitee}).
            </li>
            <li>
              Акция на месяц. Уже начатые приглашения доводят условия до конца.
            </li>
          </ol>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={handleOpen}>
            Открыть
          </button>
          <button type="button" className={styles.secondary} onClick={handleLater}>
            Позже
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReferralPromo;
