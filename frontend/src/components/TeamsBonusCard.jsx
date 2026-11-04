import React, { useEffect, useRef } from 'react';
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
  }, [card?.barcode_value, card?.barcode_svg, card?.balance_rub]);

  if (!card?.linked) {
    return null;
  }

  const holderBase = card.holder_name || fallbackName;
  const holder =
    card.segment_name && card.segment_name.trim()
      ? `${holderBase}, ${card.segment_name.trim().toLowerCase()}`
      : holderBase;
  const logoSrc = card.logo_custom && card.logo_url
    ? card.logo_url
    : (card.default_logo_url || '/teams-wallet-logo.png');
  const logoIsDefault = !(card.logo_custom && card.logo_url);

  const metaParts = [];
  if (card.public_number) metaParts.push(card.public_number);
  if (card.status_label) metaParts.push(card.status_label);
  const metaLine = metaParts.join(' · ');

  return (
    <article
      ref={rootRef}
      className={`wallet-card tilt-card tilt-card--shadow ${styles.root}`}
      style={{ '--card': card.color || '#00A8A8' }}
    >
      <div className="wallet-top">
        {logoSrc ? (
          <img
            className={`wallet-logo${logoIsDefault ? ' is-default' : ''}`}
            src={logoSrc}
            alt=""
            data-tilt-depth="3"
          />
        ) : null}
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
        {card.expires_on && (
          <p className="wallet-expiry" data-tilt-depth="2">
            Действует до {formatExpiry(card.expires_on)}
          </p>
        )}
        <div className="wallet-code" data-tilt-ignore data-tilt-above>
          {card.barcode_svg ? (
            <div
              className="wallet-barcode"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: card.barcode_svg }}
            />
          ) : null}
          <p className="wallet-code-number">
            {card.short_code_display || card.barcode_value || '••••-••••'}
          </p>
        </div>
        {metaLine && <p className="wallet-meta">{metaLine}</p>}
      </div>
      <span className="tilt-card__sheen" data-tilt-sheen aria-hidden="true" />
    </article>
  );
}

function formatExpiry(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default TeamsBonusCard;
