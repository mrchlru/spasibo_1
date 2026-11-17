import React from 'react';
import styles from './NewYearEventBanner.module.css';

/**
 * Баннер новогоднего ивента на главном экране.
 *
 * @param {{ subtitle: string, onClick: () => void }} props
 */
function NewYearEventBanner({ subtitle, onClick }) {
  return (
    <button type="button" className={styles.ny} onClick={onClick} aria-label="Новогодний подарок">
      <svg className={styles.giftSvg} viewBox="0 0 70 70" aria-hidden="true">
        <rect x="10" y="30" width="50" height="34" rx="5" fill="#d83a3a" />
        <rect x="6" y="22" width="58" height="14" rx="4" fill="#ef5350" />
        <rect x="31" y="22" width="8" height="42" fill="#ffd86b" />
        <path d="M35 22C20 6 12 18 35 22C58 18 50 6 35 22Z" fill="#ffd86b" />
      </svg>
      <i className={styles.star} style={{ right: 18, top: 10 }}>
        ✦
      </i>
      <i className={styles.star} style={{ right: 60, bottom: 10, animationDelay: '.7s' }}>
        ✦
      </i>
      <i className={styles.star} style={{ right: 110, top: 14, animationDelay: '1.2s' }}>
        ❄
      </i>
      <b>Новогодний подарок</b>
      <em>{subtitle || 'Загрузи фото с ёлкой и открой подарок'}</em>
    </button>
  );
}

export default NewYearEventBanner;
