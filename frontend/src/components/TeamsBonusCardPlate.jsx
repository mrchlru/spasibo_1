import React from 'react';
import styles from './TeamsBonusCardPlate.module.css';

function BarcodeIcon({ size = 26 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={styles.barcodeIcon}
    >
      <path d="M3 6v12M6 6v12M9 6v12M12 6v12M16 6v12M19 6v12M21 6v12" />
    </svg>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/**
 * Строит aria-label для плашки «Моя карта».
 */
function buildAriaLabel(balanceRub, discountPercent, loadError) {
  if (loadError || !String(balanceRub || '').trim()) {
    return 'Моя карта. Перейти';
  }
  let label = `Моя карта: баланс ${balanceRub}`;
  if (Number(discountPercent) > 0) {
    label += `, скидка ${discountPercent}%`;
  }
  return `${label}. Перейти`;
}

/**
 * Плашка-кнопка «Моя карта» на главной (Teams Bonus).
 */
function TeamsBonusCardPlate({ balanceRub = '', discountPercent = 0, loadError = false, onClick }) {
  const showBalance = !loadError && Boolean(String(balanceRub || '').trim());
  const showDiscount = showBalance && Number(discountPercent) > 0;
  const ariaLabel = buildAriaLabel(balanceRub, discountPercent, loadError);

  return (
    <button
      type="button"
      className={styles.plate}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <BarcodeIcon />
      <span className={styles.copy}>
        <span className={styles.title}>Моя карта</span>
        {showBalance ? (
          <span className={styles.balanceLine}>
            {balanceRub}
            {showDiscount ? (
              <span className={styles.discount}>
                {' '}
                · {discountPercent}%
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className={styles.goText} aria-hidden="true">
        Перейти
        <ChevronIcon className={styles.goTextChevron} />
      </span>
      <span className={styles.goIcon} aria-hidden="true">
        <ChevronIcon className={styles.goIconChevron} />
      </span>
    </button>
  );
}

/**
 * Скелетон плашки на время загрузки карты Teams.
 */
function TeamsBonusCardPlateSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <span className={styles.skeletonIcon} />
      <span className={styles.skeletonLines}>
        <span className={styles.skeletonLineShort} />
        <span className={styles.skeletonLineLong} />
      </span>
      <span className={styles.skeletonGo} />
    </div>
  );
}

export { TeamsBonusCardPlateSkeleton };
export default TeamsBonusCardPlate;
