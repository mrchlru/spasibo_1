import React, { useCallback, useState } from 'react';
import { getTeamsBonusHistory } from '../api';

/**
 * Список операций по карте Teams (первая страница с карточки, далее — по кнопке).
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
    <section className="history">
      <h2>Операции</h2>
      {items.length === 0 ? (
        <p className="muted">Операций пока нет.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={item.undone ? 'is-undone' : undefined}>
              <div>
                <p className="history-title">{item.title}</p>
                {item.meta && <p className="muted">{item.meta}</p>}
              </div>
              {item.show_amount && item.amount_display && (
                <div className="history-side">
                  <p className={`history-amount${item.is_minus ? ' minus' : ''}`}>
                    {item.is_minus ? '−' : ''}
                    {item.amount_display}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="history-more">
          <button type="button" className="text-link" onClick={loadMore} disabled={loading}>
            {loading ? 'Загрузка…' : 'Показать ещё'}
          </button>
          {error && <p className="muted">{error}</p>}
        </div>
      )}
    </section>
  );
}

export default TeamsBonusHistory;
