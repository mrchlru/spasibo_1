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
  transactions_count: 'Число переводов «спасибо» между сотрудниками за выбранный период.',
  total_balance: 'Сумма спасибок на балансах: переводы, подарки на день рождения и выигрыши в рулетке.',
  store_purchases_count: 'Сколько покупок совершено в магазине за всё время.',
  total_store_spent: 'Сколько спасибок потрачено в магазине за всё время.',
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

function ActivityChart({ title, hint, periods, mode }) {
  const chartData = useMemo(() => {
    const datasets = periods.map((period) => {
      const colors = PERIOD_RING_COLORS[period.period_days] || PERIOD_RING_COLORS[7];
      const active = period.active_users;
      const inactive = period.inactive_users;
      return {
        label: period.period_label,
        data: mode === 'inactive' ? [inactive, active] : [active, inactive],
        backgroundColor: mode === 'inactive'
          ? [colors.inactive, colors.active]
          : [colors.active, colors.inactive],
        borderWidth: 2,
        borderColor: '#ffffff',
      };
    });

    return {
      labels: mode === 'inactive'
        ? ['Не отправляли', 'Отправляли']
        : ['Отправляли', 'Не отправляли'],
      datasets,
    };
  }, [mode, periods]);

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
      <h3 className={styles.chartTitle}>{title}</h3>
      <p className={styles.chartHint}>{hint}</p>
      <div className={styles.chartWrap}>
        <Doughnut data={chartData} options={options} />
      </div>
      <div className={styles.periodLegend}>
        {periods.map((period) => (
          <div key={period.period_days} className={styles.periodBadge}>
            <div className={styles.periodBadgeTitle}>{period.period_label}</div>
            <div className={styles.periodBadgeValue}>
              {mode === 'inactive'
                ? `${period.inactive_users} неактивных`
                : `${period.active_users} активных (${period.active_percent}%)`}
            </div>
            <div className={changeClassName(period.week_change_percent)}>
              {mode === 'inactive' ? 'Изм. активных: ' : 'За неделю: '}
              {formatChange(period.week_change_percent)}
            </div>
          </div>
        ))}
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
          Ключевые показатели приложения. Период влияет на отправителей и транзакции.
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
      </div>

      <div className={styles.chartsSection}>
        <ActivityChart
          title="Активные пользователи"
          hint="Кольца: 7 дней, 1 месяц и 3 месяца. Сравнение с прошлой неделей — в процентах."
          periods={stats.activity_by_period || []}
          mode="active"
        />
        <ActivityChart
          title="Неактивные пользователи"
          hint="Кто не отправлял «спасибо» за период. Те же три кольца, акцент на неактивных."
          periods={stats.activity_by_period || []}
          mode="inactive"
        />
      </div>
    </div>
  );
}

export default GeneralStats;
