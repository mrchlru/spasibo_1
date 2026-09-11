import React, { useEffect, useState } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { getClientStatistics } from '../../../api';
import styles from '../StatisticsDashboard.module.css';

ChartJS.register(ArcElement, Tooltip, Legend);

function StatTile({ label, value, hint }) {
  return (
    <div className={styles.statCard}>
      <h4>{label}</h4>
      <p>{value ?? 0}</p>
      {hint && <small style={{ color: '#6E7A85' }}>{hint}</small>}
    </div>
  );
}

function ClientPlatformStatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await getClientStatistics();
        if (!cancelled) {
          setStats(response.data);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Не удалось загрузить статистику платформ.');
        }
        console.error(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Загрузка...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!stats) return null;

  const platformChart = {
    labels: ['ПК', 'iPhone/iPad', 'Android', 'Неизвестно'],
    datasets: [{
      data: [
        stats.by_platform.desktop,
        stats.by_platform.ios,
        stats.by_platform.android,
        stats.by_platform.unknown,
      ],
      backgroundColor: ['#5CA14A', '#2196F3', '#FF9800', '#E9EEF2'],
      borderWidth: 2,
      borderColor: '#fff',
    }],
  };

  return (
    <div>
      <h2>Платформы и установки</h2>
      <p style={{ color: '#6E7A85', marginTop: '-8px' }}>
        По последнему известному клиенту пользователя. Данные накапливаются после обновления.
      </p>

      <div className={styles.statsGrid}>
        <StatTile label="Всего пользователей" value={stats.total_users} />
        <StatTile label="ПК" value={stats.by_platform.desktop} />
        <StatTile label="iPhone / iPad" value={stats.by_platform.ios} />
        <StatTile label="Android" value={stats.by_platform.android} />
        <StatTile
          label="iOS: на главный экран"
          value={stats.installs.ios_pwa}
          hint="Добавили PWA на домашний экран"
        />
        <StatTile
          label="Android: приложение"
          value={stats.installs.android_app}
          hint="Заходили через APK"
        />
        <StatTile label="Telegram Mini App" value={stats.by_shell.telegram} />
        <StatTile label="Браузер (моб.)" value={stats.by_shell.android_browser + stats.by_shell.ios_browser} />
      </div>

      <div style={{ height: '320px', marginTop: '24px' }}>
        <Doughnut
          data={platformChart}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
              legend: { position: 'bottom' },
              title: {
                display: true,
                text: 'Распределение по платформам',
              },
            },
          }}
        />
      </div>
    </div>
  );
}

export default ClientPlatformStatsPage;
