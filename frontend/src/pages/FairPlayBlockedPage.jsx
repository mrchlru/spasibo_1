import React, { useEffect, useState } from 'react';
import styles from './StatusPages.module.css';

function formatMskDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatRemaining(ms) {
  if (ms <= 0) return 'скоро';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} д.`);
  if (hours > 0 || days > 0) parts.push(`${hours} ч.`);
  parts.push(`${minutes} мин. ${seconds} сек.`);
  return parts.join(' ');
}

function FairPlayBlockedPage({ user }) {
  const banUntil = user?.fair_play?.ban_until;
  const banReason = user?.fair_play?.ban_reason;
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!banUntil) return undefined;
    function tick() {
      setRemainingMs(new Date(banUntil).getTime() - Date.now());
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [banUntil]);

  return (
    <div className={styles.statusPage}>
      <div className={styles.icon}>⏳</div>
      <h1>Вы временно заблокированы</h1>
      <p>
        {banReason
          ? `В связи с ${banReason} отправка и получение спасибок недоступны.`
          : 'Отправка и получение спасибок временно недоступны.'}
      </p>
      {banUntil && (
        <>
          <p>До: {formatMskDateTime(banUntil)} (МСК)</p>
          <p>Осталось: {formatRemaining(remainingMs)}</p>
        </>
      )}
    </div>
  );
}

export default FairPlayBlockedPage;
