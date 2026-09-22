import React, { useCallback, useEffect, useState } from 'react';
import { FaFileExcel } from 'react-icons/fa';
import { exportInactiveUsers, getInactiveUsers } from '../../../api';
import { downloadExcelBlob } from '../../../utils/downloadBlob';
import styles from './InactiveUsersPage.module.css';
import dashboardStyles from '../StatisticsDashboard.module.css';
import UserAvatar from '../../../components/UserAvatar';

const PERIOD_OPTIONS = [
  { days: 7, label: '7 дней', hint: 'не отправляли «спасибо» за последние 7 дней' },
  { days: 30, label: '1 месяц', hint: 'не отправляли «спасибо» за последние 30 дней' },
  { days: 90, label: '3 месяца', hint: 'не отправляли «спасибо» за последние 90 дней' },
];

function InactiveUsersPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const activePeriod = PERIOD_OPTIONS.find((option) => option.days === periodDays) || PERIOD_OPTIONS[1];

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getInactiveUsers(periodDays);
      setUsers(response.data.users || []);
    } catch (err) {
      setError('Не удалось загрузить список неактивных пользователей.');
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
      const response = await exportInactiveUsers(periodDays);
      await downloadExcelBlob(response, `inactive_senders_${periodDays}d.xlsx`);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Не удалось выгрузить Excel.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <p>Загрузка списка...</p>;
  }

  if (error) {
    return <p style={{ color: 'red' }}>{error}</p>;
  }

  return (
    <div>
      <h2>Неактивные пользователи</h2>
      <p style={{ color: '#6E7A85', marginTop: '-10px', marginBottom: '16px' }}>
        Только одобренные (без удалённых и заблокированных). Неактивный — не отправил
        ни одного «спасибо» за выбранный период. Более длинный период входит в более короткий:
        кто не слал 3 месяца, попадает и в «1 месяц», и в «7 дней».
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            className={`${dashboardStyles.tab} ${periodDays === option.days ? dashboardStyles.tabActive : dashboardStyles.tabCollapsed}`}
            onClick={() => setPeriodDays(option.days)}
            title={option.hint}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className={dashboardStyles.consolidatedExportButton}
          onClick={handleExport}
          disabled={exporting}
          style={{ marginLeft: 'auto' }}
        >
          <FaFileExcel />
          {exporting ? 'Выгрузка…' : 'Excel'}
        </button>
      </div>

      <p style={{ fontWeight: 600, marginBottom: '12px' }}>
        Всего ({activePeriod.label}): {users.length}
      </p>

      {users.length > 0 ? (
        <ul className={styles.userList}>
          {users.map((user) => (
            <li key={user.id} className={styles.userCard}>
              <div className={styles.avatarContainer}>
                <UserAvatar user={user} size="medium" />
              </div>
              <div className={styles.userInfo}>
                <div className={styles.userName}>{`${user.first_name} ${user.last_name}`}</div>
                <div className={styles.userPosition}>{user.position}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.noInactiveMessage}>
          За этот период все одобренные отправляли «спасибо».
        </div>
      )}
    </div>
  );
}

export default InactiveUsersPage;
