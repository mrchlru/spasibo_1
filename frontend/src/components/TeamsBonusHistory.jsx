import React, { useCallback, useState } from 'react';
import { getTeamsBonusHistory } from '../api';
import styles from './TeamsBonusHistory.module.css';

/**
 * Список операций по карте Teams — как на public_card, цвета под белый фон «Спасибо».
 */
function TeamsBonusHistory({ initialItems, initialHasMore, initialNextBefore }) {
  const [items, setItems] = useState(initialItems || []);
  const [hasMore, setHasMore] = useState(Boolean(initialHasMore));
  const [nextBefore, setNextBefore] = useState(initialNextBefore ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || nextBefore == null) return;
    setLoading(true);
    setError('');
    try {
      const response = await getTeamsBonusHistory(nextBefore);
      const page = response.data;
      setItems((prev) => [...prev, ...(page.items || [])]);
      setHasMore(Boolean(page.has_more));
      setNextBefore(page.next_before ?? null);
    } catch {
      setError('Не удалось загрузить операции. Попробуйте позже.');
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, nextBefore]);

  return (
    <section className={styles.history}>
      <h2>Операции</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>Операций пока нет.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const amountText = item.amount_display || item.amount_rub || '';
            const showAmount = item.show_amount !== false && Boolean(amountText);
            const cheque = String(item.cheque_detail || '').trim();
            return (
              <li key={item.id} className={item.undone ? styles.isUndone : undefined}>
                <div className={styles.main}>
                  <p className={styles.title}>{item.title}</p>
                  {item.meta ? <p className={styles.meta}>{item.meta}</p> : null}
                  {cheque ? (
                    <details className={styles.cheque}>
                      <summary>Чек заказа</summary>
                      <pre className={styles.chequeBody}>{cheque}</pre>
                    </details>
                  ) : null}
                </div>
                {showAmount ? (
                  <div className={styles.side}>
                    <p
                      className={`${styles.amount}${item.is_minus ? ` ${styles.amountMinus}` : ''}`}
                    >
                      {item.is_minus ? '−' : ''}
                      {amountText}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <div className={styles.more}>
          <button
            type="button"
            className={styles.moreButton}
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? 'Загрузка…' : 'Показать ещё'}
          </button>
          {error ? <p className={styles.moreError}>{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export default TeamsBonusHistory;
