import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Lottie from 'react-lottie-player';
import styles from './OnboardingStories.module.css';
import {
  getReferralPromoState,
  snoozeReferralPromo,
  markReferralPromoDone,
} from '../api';
import {
  canShowReferralEntry,
  isReferralPromoRestricted,
  normalizeReferral,
} from '../pwa/referralCampaign.js';
import sticker1 from '../assets/AnimatedSticker1.json';
import sticker2 from '../assets/AnimatedSticker3.json';
import sticker3 from '../assets/AnimatedSticker2.json';
import sticker4 from '../assets/TgDuckX_AgADaFEAAtd-MEs.json';

const SESSION_KEY = 'spasibo_referral_stories_shown';

/**
 * Собирает слайды истории рефералки с актуальными бонусами.
 *
 * @param {ReturnType<typeof normalizeReferral>} campaign
 */
function buildReferralStories(campaign) {
  return [
    {
      animation: sticker1,
      title: 'Бонусы за коллегу',
      text: 'Поделись персональной ссылкой — и вы оба можете получить спасибки.',
    },
    {
      animation: sticker2,
      title: 'Новый в «Спасибо»',
      text:
        `После регистрации и входа: вам ${campaign.bonus_new_inviter} спасибок, `
        + `коллеге — ${campaign.bonus_new_invitee}.`,
    },
    {
      animation: sticker4,
      title: 'Вернувшийся коллега',
      text:
        `Если человек не заходил ${campaign.inactive_months} мес., пусть отправит спасибки `
        + `минимум ${campaign.reactivation_min_days} дня за ${campaign.reactivation_window_days} дней. `
        + `Бонус: ${campaign.bonus_reactivate_inviter} / ${campaign.bonus_reactivate_invitee}.`,
    },
    {
      animation: sticker3,
      title: 'Правила простые',
      text:
        'Акция на месяц. Если коллега начал выполнять условия до конца — прогресс сохраняется. '
        + 'Ссылка и статусы — в профиле.',
    },
  ];
}

/**
 * Тестовая / рекламная история рефералки (как онбординг).
 * Показывается только при активной акции и для разрешённой аудитории.
 */
function ReferralStories({
  user,
  bootReady,
  loading,
  isOnboardingVisible,
  referral = null,
  onOpenReferral,
}) {
  const campaign = useMemo(() => normalizeReferral(referral), [referral]);
  const slides = useMemo(() => buildReferralStories(campaign), [campaign]);
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
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
    if (!canShowReferralEntry(campaign, {
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
    if (!accountCanShow || shownThisSession) {
      setVisible(false);
      return;
    }
    setVisible(true);
    setCurrentStep(0);
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

  async function handleSkip() {
    markSessionShown();
    setVisible(false);
    try {
      await snoozeReferralPromo();
    } catch {
      /* ignore */
    }
  }

  async function handleFinish() {
    markSessionShown();
    setVisible(false);
    try {
      await markReferralPromoDone('stories_done');
    } catch {
      /* ignore */
    }
    onOpenReferral?.();
  }

  function handleNext() {
    if (currentStep < slides.length - 1) {
      setCurrentStep((step) => step + 1);
      return;
    }
    void handleFinish();
  }

  if (!visible) {
    return null;
  }

  const currentStory = slides[currentStep];
  const isTestAudience = isReferralPromoRestricted(campaign);

  return (
    <div className={styles.container} style={{ position: 'fixed', inset: 0, zIndex: 1300 }}>
      <button type="button" onClick={handleSkip} className={styles.skipButton}>
        Позже
      </button>
      <div className={styles.content}>
        {isTestAudience && (
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#3d7a38' }}>
            Тестовый показ
          </p>
        )}
        <div className={styles.stickerContainer}>
          <Lottie
            animationData={currentStory.animation}
            loop
            play
            className={styles.sticker}
          />
        </div>
        <h1 className={styles.title}>{currentStory.title}</h1>
        <p className={styles.text}>{currentStory.text}</p>
      </div>
      <div className={styles.footer}>
        <div className={styles.dots}>
          {slides.map((_, index) => (
            <div
              key={index}
              className={`${styles.dot} ${index === currentStep ? styles.activeDot : ''}`}
            />
          ))}
        </div>
        <button type="button" onClick={handleNext} className={styles.nextButton}>
          {currentStep < slides.length - 1 ? 'Дальше' : 'К моей ссылке'}
        </button>
      </div>
    </div>
  );
}

export default ReferralStories;
