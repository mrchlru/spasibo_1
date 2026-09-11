import React, { useCallback, useEffect, useState } from 'react';
import { getActiveUserRatio } from '../../../api';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import dashboardStyles from '../StatisticsDashboard.module.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const PERIOD_OPTIONS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '1 месяц' },
  { days: 90, label: '3 месяца' },
];

function ActiveUserRatioPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [chartData, setChartData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await getActiveUserRatio(periodDays);
      const { active_users, inactive_users, total_users } = response.data;
      setSummary(response.data);
      setChartData({
        labels: ['Активные (отправляли)', 'Неактивные'],
        datasets: [{
          label: 'Пользователи',
          data: [active_users, inactive_users],
          backgroundColor: ['#5CA14A', '#E9EEF2'],
          borderColor: ['#FFFFFF', '#FFFFFF'],
          borderWidth: 2,
        }],
      });
    } catch (err) {
      setError('Не удалось загрузить данные.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: { position: 'bottom' },
      title: {
        display: true,
        text: 'Отправляли хотя бы 1 «спасибо» за период',
        font: { size: 16 },
      },
    },
  };

  if (loading) return <p>Загрузка диаграммы...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <div>
      <h2>Соотношение активных и неактивных</h2>
      <p style={{ color: '#6E7A85', marginTop: '-10px' }}>
        Активный = отправил хотя бы одно «спасибо» за выбранный период.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            className={`${dashboardStyles.tab} ${periodDays === option.days ? dashboardStyles.tabActive : dashboardStyles.tabCollapsed}`}
            onClick={() => setPeriodDays(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {summary && (
        <p style={{ marginBottom: '12px' }}>
          Всего пользователей: <strong>{summary.total_users}</strong>
          {' · '}
          Активных: <strong>{summary.active_users}</strong>
          {' · '}
          Неактивных: <strong>{summary.inactive_users}</strong>
        </p>
      )}

      <div style={{ height: '350px', marginTop: '20px', position: 'relative' }}>
        {chartData && <Doughnut options={options} data={chartData} />}
      </div>
    </div>
  );
}

export default ActiveUserRatioPage;
