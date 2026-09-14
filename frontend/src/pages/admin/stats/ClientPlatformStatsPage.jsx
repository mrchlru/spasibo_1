import React, { useEffect, useMemo, useState } from 'react';
import { FaFileExcel } from 'react-icons/fa';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { exportClientPlatformUsers, getClientStatistics } from '../../../api';
import { downloadExcelBlob } from '../../../utils/downloadBlob';
import dashboardStyles from '../StatisticsDashboard.module.css';
import styles from './ClientPlatformStatsPage.module.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const CATEGORY_ORDER = [
  { key: 'ios_pwa', label: 'iOS: на главный экран' },
  { key: 'android_app', label: 'Android: приложение' },
  { key: 'mobile_browser', label: 'Мобильный браузер' },
  { key: 'desktop', label: 'ПК' },
  { key: 'telegram', label: 'Telegram Mini App' },
  { key: 'unknown', label: 'Неизвестно' },
];

function StatTile({ label, value, hint }) {
  return (
    <div className={dashboardStyles.statCard}>
      <h4>{label}</h4>
      <p>{value ?? 0}</p>
      {hint && <small style={{ color: '#6E7A85' }}>{hint}</small>}
    </div>
  );
}

function ClientPlatformStatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
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

  const groupedUsers = useMemo(() => {
    const groups = Object.fromEntries(CATEGORY_ORDER.map(({ key }) => [key, []]));
    for (const user of stats?.users || []) {
      const bucket = groups[user.category] ? user.category : 'unknown';
      groups[bucket].push(user);
    }
    return groups;
  }, [stats?.users]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await exportClientPlatformUsers();
      await downloadExcelBlob(response, `client_platforms_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Не удалось выгрузить Excel.');
    } finally {
      setExporting(false);
    }
  };

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
      <div className={styles.headerRow}>
        <div>
          <h2 style={{ margin: 0 }}>Платформы и установки</h2>
          <p style={{ color: '#6E7A85', marginTop: '6px', marginBottom: 0 }}>
            Только одобренные пользователи. По последнему известному клиенту.
          </p>
        </div>
        <button
          type="button"
          className={dashboardStyles.consolidatedExportButton}
          onClick={handleExport}
          disabled={exporting}
        >
          <FaFileExcel />
          {exporting ? 'Выгрузка…' : 'Excel'}
        </button>
      </div>

      <div className={dashboardStyles.statsGrid}>
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

      {CATEGORY_ORDER.map(({ key, label }) => {
        const users = groupedUsers[key] || [];
        return (
          <section key={key} className={styles.categorySection}>
            <h3 className={styles.categoryTitle}>
              {label}
              {' '}
              <span style={{ color: '#6E7A85', fontWeight: 500 }}>({users.length})</span>
            </h3>
            {users.length > 0 ? (
              <ul className={styles.userList}>
                {users.map((user) => (
                  <li key={user.id} className={styles.userRow}>
                    <span className={styles.userName}>{user.full_name}</span>
                    <span className={styles.userMeta}>{user.phone_number || '—'}</span>
                    <span className={styles.userMeta}>{user.email || '—'}</span>
                    <span className={styles.userMeta}>{user.position || '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyCategory}>Нет пользователей в этой категории.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default ClientPlatformStatsPage;
