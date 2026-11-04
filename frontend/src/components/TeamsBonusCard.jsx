import React, { useEffect, useRef } from 'react';
import Barcode from 'react-barcode';
import '../lib/tilt/tilt-card.css';
import '../lib/tilt/tilt-core.js';
import './teams-wallet.css';
import styles from './TeamsBonusCard.module.css';

/**
 * Карта Teams Bonus (wallet + наклон), данные с GET /users/me/teams-bonus-card.
 */
function TeamsBonusCard({ card, fallbackName = '' }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window.createTilt !== 'function') {
      return undefined;
    }
    const tilt = window.createTilt(el, { maxAngle: 9, gyro: false });
    return () => {
      if (tilt && typeof tilt.destroy === 'function') {
        tilt.destroy();
      }
    };
  }, [card?.barcode_value, card?.balance_rub]);

  if (!card?.linked) {
    return null;
  }

  const holder = card.holder_name || fallbackName;
  const logoIsDefault = !card.logo_url;

  return (
    <article
      ref={rootRef}
      className={`wallet-card tilt-card tilt-card--shadow ${styles.root}`}
      style={{ '--card': card.color || '#00A8A8' }}
    >
      <div className="wallet-top">
        {card.logo_url ? (
          <img
            className={`wallet-logo${logoIsDefault ? ' is-default' : ''}`}
            src={card.logo_url}
            alt=""
            data-tilt-depth="3"
          />
        ) : (
          <img
            className="wallet-logo is-default"
            src="/teams-wallet-logo.png"
            alt=""
            data-tilt-depth="3"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="wallet-balance" data-tilt-depth="2">
          <p className="wallet-label">Баланс</p>
          <p className="wallet-amount">{card.balance_rub || '0'}</p>
          {card.discount_percent > 0 && (
            <p className="wallet-discount">{card.discount_percent}%</p>
          )}
        </div>
      </div>

      <div className={`wallet-banner${card.template_url ? '' : ' is-empty'}`}>
        {card.template_url ? (
          <img
            src={card.template_url}
            alt=""
            decoding="async"
            data-tilt-depth="6"
            data-tilt-bleed
          />
        ) : (
          <div className="wallet-placeholder" data-tilt-depth="4">
            <span>mugle rest</span>
          </div>
        )}
      </div>

      <div className="wallet-body">
        <p className="wallet-label" data-tilt-depth="2">
          Владелец карты
        </p>
        <p className="wallet-holder" data-tilt-depth="2">
          {holder}
        </p>
        <div className="wallet-code" data-tilt-ignore data-tilt-above>
          {card.barcode_value && (
            <div className={styles.barcode}>
              <Barcode
                value={card.barcode_value}
                displayValue={false}
                height={48}
                margin={0}
                background="transparent"
                lineColor="#111"
              />
            </div>
          )}
          <p className="wallet-code-number">
            {card.short_code_display || card.barcode_value || '••••-••••'}
          </p>
        </div>
        {card.public_number && (
          <p className="wallet-meta">{card.public_number}</p>
        )}
      </div>
      <span className="tilt-card__sheen" data-tilt-sheen aria-hidden="true" />
    </article>
  );
}

export default TeamsBonusCard;
