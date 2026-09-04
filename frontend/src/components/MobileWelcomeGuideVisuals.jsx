import React from 'react';
import {
  FaBell,
  FaGift,
  FaHeart,
  FaHome,
  FaNewspaper,
  FaShareAlt,
  FaStore,
  FaUser,
} from 'react-icons/fa';
import styles from './MobileWelcomeGuide.module.css';

/** Визуальные «скриншоты» для слайдов карусели. */
function WelcomeVisual({ variant }) {
  if (variant === 'welcome') {
    return (
      <div className={styles.phone}>
        <div className={styles.phoneStatus} />
        <div className={styles.mockApp}>
          <div className={styles.mockHeader}>Спасибо</div>
          <div className={styles.mockFeedCard}>
            <div className={styles.mockAvatar} />
            <div className={styles.mockLines}>
              <span />
              <span />
            </div>
          </div>
          <div className={styles.mockFeedCard}>
            <div className={styles.mockAvatar} />
            <div className={styles.mockLines}>
              <span />
              <span />
            </div>
          </div>
          <div className={styles.mockNav}>
            <FaHome />
            <FaStore />
            <FaGift />
            <FaUser />
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'features') {
    return (
      <div className={styles.featureGrid}>
        <div className={styles.featureCard}>
          <FaHeart className={styles.featureIcon} />
          <span>Спасибки</span>
        </div>
        <div className={styles.featureCard}>
          <FaNewspaper className={styles.featureIcon} />
          <span>Новости</span>
        </div>
        <div className={styles.featureCard}>
          <FaStore className={styles.featureIcon} />
          <span>Магазин</span>
        </div>
      </div>
    );
  }

  if (variant === 'ios-home') {
    return (
      <div className={styles.phone}>
        <div className={styles.phoneStatus} />
        <div className={styles.mockSafari}>
          <div className={styles.mockSafariBar}>
            <span>Спасибо</span>
            <div className={styles.mockShareHighlight}>
              <FaShareAlt />
              <span className={styles.mockPointer}>①</span>
            </div>
          </div>
          <div className={styles.mockShareSheet}>
            <div className={styles.mockShareRow}>
              <span className={styles.mockShareIcon}>+</span>
              <strong>На экран «Домой»</strong>
              <span className={styles.mockPointer}>②</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'notifications-android') {
    return (
      <div className={styles.dualPhones}>
        <div className={styles.phoneSmall}>
          <div className={styles.phoneStatus} />
          <div className={styles.mockApp}>
            <div className={styles.mockHeader}>Спасибо</div>
            <button type="button" className={styles.mockGreenBtn}>
              <FaBell /> Включить уведомления
              <span className={styles.mockPointer}>①</span>
            </button>
          </div>
        </div>
        <div className={styles.phoneSmall}>
          <div className={styles.phoneStatus} />
          <div className={styles.mockSystemDialog}>
            <FaBell className={styles.mockDialogIcon} />
            <p>Разрешить «Спасибо» присылать уведомления?</p>
            <div className={styles.mockDialogActions}>
              <span>Запретить</span>
              <strong>Разрешить</strong>
              <span className={styles.mockPointer}>②</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'notifications-ios') {
    return (
      <div className={styles.dualPhones}>
        <div className={styles.phoneSmall}>
          <div className={styles.phoneStatus} />
          <div className={styles.mockApp}>
            <div className={styles.mockHeader}>Приложение</div>
            <button type="button" className={styles.mockGreenBtn}>
              <FaBell /> Включить уведомления
              <span className={styles.mockPointer}>①</span>
            </button>
          </div>
        </div>
        <div className={styles.phoneSmall}>
          <div className={styles.phoneStatus} />
          <div className={styles.mockSystemDialog}>
            <p>«Спасибо» хочет присылать вам уведомления</p>
            <div className={styles.mockDialogActions}>
              <span>Не разрешать</span>
              <strong>Разрешить</strong>
              <span className={styles.mockPointer}>②</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'notifications-browser') {
    return (
      <div className={styles.phone}>
        <div className={styles.phoneStatus} />
        <div className={styles.mockApp}>
          <div className={styles.mockHeader}>Спасибо</div>
          <button type="button" className={styles.mockGreenBtn}>
            <FaBell /> Включить уведомления
          </button>
          <div className={styles.mockBrowserPrompt}>
            <span>Разрешить уведомления?</span>
            <div>
              <span>Блокировать</span>
              <strong>Разрешить</strong>
            </div>
            <span className={styles.mockPointer}>②</span>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'notifications-ok') {
    return (
      <div className={styles.doneBadge}>
        <FaBell />
        <span>Всё включено</span>
      </div>
    );
  }

  return (
    <div className={styles.doneBadge}>
      <FaHeart />
      <span>Поехали!</span>
    </div>
  );
}

export default WelcomeVisual;
