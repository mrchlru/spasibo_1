import React, { useEffect, useState } from 'react';
import { getTeamsBonusPartners } from '../api';

/**
 * Диалог «Где и когда действует карта» (как на public_card Teams Bonus).
 */
function TeamsBonusPartnersDialog({ open, onClose, card }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    getTeamsBonusPartners()
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить список партнёров.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const weekdays = data?.weekday_choices || [];
  const activeDays = new Set(card?.use_days_active || []);

  return (
    <div className="teams-partners-backdrop" role="presentation" onClick={onClose}>
      <div
        className="teams-partners-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teams-partners-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="teams-partners-head">
          <div>
            <p className="teams-partners-eyebrow">Условия</p>
            <h2 id="teams-partners-title">Где и когда можно пользоваться картой</h2>
          </div>
          <button type="button" className="teams-partners-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>

        {card?.use_days_label && (
          <section className="teams-partners-days" aria-label="Дни использования">
            <p className="teams-partners-days-title">Дни использования</p>
            <p className="teams-partners-days-caption">{card.use_days_label}</p>
            <div className="teams-use-days-chips" role="list">
              {weekdays.map((day) => (
                <span
                  key={day.value}
                  className={`teams-use-day${activeDays.has(day.value) ? ' is-on' : ''}`}
                  role="listitem"
                >
                  {day.title}
                </span>
              ))}
            </div>
          </section>
        )}

        <p className="teams-partners-lead">Использовать карту можно в ресторанах-партнёрах.</p>

        <div className="teams-partners-scroll">
          {loading && <p className="muted">Загрузка…</p>}
          {error && <p className="muted">{error}</p>}
          {!loading &&
            !error &&
            (data?.cities || []).map((city) => (
              <section key={city.city} className="teams-partners-city">
                <h3>{city.city}</h3>
                <div className="teams-partners-row teams-partners-row-head">
                  <span>Ресторан</span>
                  <span>Адрес</span>
                </div>
                {city.places.map((place) =>
                  (place.addresses?.length ? place.addresses : ['']).map((address, index) => (
                    <div key={`${place.name}-${index}`} className="teams-partners-row">
                      <span>{index === 0 ? place.name : ''}</span>
                      <span>{address}</span>
                    </div>
                  ))
                )}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

export default TeamsBonusPartnersDialog;
