import React, { useEffect, useMemo, useState } from 'react';
import { FaInfoCircle } from 'react-icons/fa';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { getDashboardStats } from '../../../api';
import styles from './GeneralStats.module.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const METRIC_HINTS = {
  total_users: 'Все одобренные сотрудники в приложении.',
  active_users_count: 'Сколько человек отправили хотя бы одно «спасибо» за выбранный период.',
  transactions_count: 'Число переводов «спасибо» от одобренных сотрудников за выбранный период (сутки по Москве).',
  total_balance: 'Сумма спасибок на балансах: переводы, подарки на день рождения и выигрыши в рулетке.',
  store_purchases_count: 'Сколько покупок совершено в магазине за всё время.',
  total_store_spent: 'Сколько спасибок потрачено в магазине за всё время.',
  fair_play_banned_count: 'Пользователи с активным fair-play баном (не могут отправлять и получать).',
  fair_play_limited_count: 'Пользователи со сниженным лимитом отправки спасибок.',
  fair_play_suspicious_count: 'Пользователи с меткой «подозрительная активность» (пограничный случай).',
};

const PERIOD_RING_COLORS = {
  7: { active: '#34C759', inactive: '#E8E8ED' },
  30: { active: '#007AFF', inactive: '#D6E8FF' },
  90: { active: '#FF9500', inactive: '#FFE8CC' },
};

function formatChange(value) {
  if (value == null) return '—';
  if (value > 0) return `+${value}%`;
  if (value < 0) return `${value}%`;
  return '0%';
}

function changeClassName(value) {
  if (value == null || value === 0) return styles.changeNeutral;
  return value > 0 ? styles.changeUp : styles.changeDown;
}

function MetricCard({ title, value, hintKey, wide = false, children }) {
  function showHint() {
    const text = METRIC_HINTS[hintKey];
    if (text) window.alert(text);
  }

  return (
    <div className={`${styles.card} ${wide ? styles.cardWide : ''}`}>
      <div className={styles.cardHeader}>
        <h4 className={styles.cardTitle}>{title}</h4>
        <button type="button" className={styles.infoButton} onClick={showHint} aria-label="Подробнее">
          <FaInfoCircle size={14} />
        </button>
      </div>
      <p className={styles.cardValue}>{value ?? 0}</p>
      {children}
    </div>
  );
}

function ActivityChart({ periods }) {
  const chartData = useMemo(() => {
    const datasets = periods.map((period) => {
      const colors = PERIOD_RING_COLORS[period.period_days] || PERIOD_RING_COLORS[7];
      return {
        label: period.period_label,
        data: [period.active_users, period.inactive_users],
        backgroundColor: [colors.active, colors.inactive],
        borderWidth: 2,
        borderColor: '#ffffff',
      };
    });

    return {
      labels: ['Отправляли', 'Не отправляли'],
      datasets,
    };
  }, [periods]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '58%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
      tooltip: {
        callbacks: {
          label(context) {
            const label = context.dataset.label || '';
            const value = context.parsed;
            return `${label}: ${value}`;
          },
        },
      },
    },
  };

  return (
    <div className={styles.chartCard}>
      <h3 className={styles.chartTitle}>Активные — неактивные пользователи</h3>
      <p className={styles.chartHint}>
        Кольца: 7 дней, 1 месяц и 3 месяца. Сравнение с прошлой неделей — в процентах.
      </p>
      <div className={styles.chartBody}>
        <div className={styles.chartWrap}>
          <Doughnut data={chartData} options={options} />
        </div>
        <div className={styles.periodLegend}>
          {periods.map((period) => (
            <div key={period.period_days} className={styles.periodBadge}>
              <div className={styles.periodBadgeTitle}>{period.period_label}</div>
              <div className={styles.periodBadgeValue}>
                {period.active_users} активных ({period.active_percent}%)
              </div>
              <div className={styles.periodBadgeSub}>
                {period.inactive_users} неактивных
              </div>
              <div className={changeClassName(period.week_change_percent)}>
                За неделю: {formatChange(period.week_change_percent)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GeneralStats({ startDate, endDate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await getDashboardStats(startDate, endDate);
        if (!cancelled) {
          setStats(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  if (loading) {
    return <p>Загрузка...</p>;
  }

  if (!stats) {
    return <p style={{ color: 'red' }}>Не удалось загрузить дашборд.</p>;
  }

  return (
    <div className={styles.page}>
      <div>
        <h2 className={styles.header}>Дашборд</h2>
        <p className={styles.subtitle}>
          Ключевые показатели приложения. Период — календарные сутки по Москве; влияет на отправителей и транзакции.
        </p>
      </div>

      <div className={styles.grid}>
        <MetricCard title="Всего пользователей" value={stats.total_users} hintKey="total_users" />
        <MetricCard title="Отправляли спасибки" value={stats.active_users_count} hintKey="active_users_count" />
        <MetricCard title="Всего транзакций" value={stats.transactions_count} hintKey="transactions_count" />
        <MetricCard
          title="Спасибок на счетах"
          value={`${stats.total_balance} спас.`}
          hintKey="total_balance"
        />
        <MetricCard
          title="Покупок в магазине"
          value={stats.store_purchases_count}
          hintKey="store_purchases_count"
          wide
        >
          {stats.top_store_items?.length > 0 && (
            <ul className={styles.topItems}>
              {stats.top_store_items.map((item, index) => (
                <li key={`${item.name}-${index}`} className={styles.topItem}>
                  <span className={styles.topItemName}>
                    {index + 1}. {item.name}
                  </span>
                  <span className={styles.topItemCount}>{item.purchase_count} шт.</span>
                </li>
              ))}
            </ul>
          )}
        </MetricCard>
        <MetricCard
          title="Потрачено в магазине"
          value={`${stats.total_store_spent} спас.`}
          hintKey="total_store_spent"
        />
        <MetricCard
          title="Fair Play: заблокированы"
          value={stats.fair_play_banned_count}
          hintKey="fair_play_banned_count"
        />
        <MetricCard
          title="Fair Play: снижен лимит"
          value={stats.fair_play_limited_count}
          hintKey="fair_play_limited_count"
        />
        <MetricCard
          title="Fair Play: подозрительные"
          value={stats.fair_play_suspicious_count}
          hintKey="fair_play_suspicious_count"
        />
      </div>

      <ActivityChart periods={stats.activity_by_period || []} />
    </div>
  );
}

export default GeneralStats;
