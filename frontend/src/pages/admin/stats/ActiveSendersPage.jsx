import React, { useCallback, useEffect, useState } from 'react';
import { FaFileExcel } from 'react-icons/fa';
import { exportActiveSenders, getActiveSendersStats } from '../../../api';
import { formatToMsk } from '../../../utils/dateFormatter';
import UserAvatar from '../../../components/UserAvatar';
import styles from './InactiveUsersPage.module.css';
import dashboardStyles from '../StatisticsDashboard.module.css';

const PERIOD_OPTIONS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '1 месяц' },
  { days: 90, label: '3 месяца' },
];

function downloadBlob(response, filename) {
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
}

function ActiveSendersPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [senders, setSenders] = useState([]);
  const [totalActive, setTotalActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getActiveSendersStats(periodDays);
      setSenders(response.data.senders || []);
      setTotalActive(response.data.total_active || 0);
    } catch (err) {
      setError('Не удалось загрузить список активных отправителей.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await exportActiveSenders(periodDays);
      downloadBlob(response, `active_senders_${periodDays}d.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Не удалось выгрузить Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h2>Активные отправители</h2>
      <p style={{ color: '#6E7A85', marginTop: '-10px', marginBottom: '16px' }}>
        Только одобренные пользователи. Отправили хотя бы 1 «спасибо» за выбранный период.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
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
        <button
          type="button"
          className={dashboardStyles.consolidatedExportButton}
          onClick={handleExport}
          disabled={exporting || loading}
          style={{ marginLeft: 'auto' }}
        >
          <FaFileExcel />
          {exporting ? 'Выгрузка…' : 'Excel'}
        </button>
      </div>

      {!loading && !error && (
        <p style={{ fontWeight: 600, marginBottom: '12px' }}>
          Всего активных: {totalActive}
        </p>
      )}

      {loading && <p>Загрузка...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && senders.length > 0 && (
        <ul className={styles.userList}>
          {senders.map((row) => (
            <li key={row.user.id} className={styles.userCard}>
              <div className={styles.avatarContainer}>
                <UserAvatar user={row.user} size="medium" />
              </div>
              <div className={styles.userInfo}>
                <div className={styles.userName}>{`${row.user.first_name} ${row.user.last_name}`}</div>
                <div className={styles.userPosition}>{row.user.position} · {row.user.department}</div>
                <div className={styles.userPosition}>
                  Отправлено: {row.sent_count}
                  {row.last_sent_at && (
                    <> · последний раз {formatToMsk(row.last_sent_at, { hour: undefined, minute: undefined })}</>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && senders.length === 0 && (
        <p>За этот период никто не отправлял «спасибо».</p>
      )}
    </div>
  );
}

export default ActiveSendersPage;
