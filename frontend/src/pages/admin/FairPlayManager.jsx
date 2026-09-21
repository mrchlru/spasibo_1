import React, { useCallback, useEffect, useState } from 'react';
import {
  getFairPlayUsers,
  getFairPlaySettings,
  updateFairPlaySettings,
  fairPlayLiftBan,
  fairPlayLiftLimit,
  fairPlayClearSuspicious,
  fairPlayResetStrikes,
} from '../../api';
import { formatUserName } from '../../utils/nameFormatter';
import styles from '../AdminPage.module.css';
import fpStyles from './FairPlayManager.module.css';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';

const FILTERS = [
  { id: 'all', label: 'Все санкции' },
  { id: 'banned', label: 'Заблокированные' },
  { id: 'limited', label: 'Сниженный лимит' },
  { id: 'suspicious', label: 'Подозрительная активность' },
];

/**
 * Форматирует дату/время в МСК.
 *
 * @param {string | null | undefined} iso
 * @returns {string}
 */
function formatMskDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

/**
 * Бейджи активных санкций.
 *
 * @param {object} fp
 * @returns {string[]}
 */
function statusBadges(fp) {
  const badges = [];
  if (fp?.is_fair_play_banned) badges.push('Бан');
  if (fp?.limit_until && new Date(fp.limit_until) > new Date()) badges.push('Лимит');
  if (fp?.suspicious_active) badges.push('Подозрительно');
  return badges;
}

function FairPlayManager() {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const response = await getFairPlaySettings();
      setEnabled(Boolean(response?.data?.enabled));
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось загрузить настройки', 'error');
    } finally {
      setSettingsLoading(false);
    }
  }, [showAlert]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getFairPlayUsers(filter);
      setRows(response.data || []);
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось загрузить список', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, showAlert]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(nextEnabled) {
    if (nextEnabled === enabled || toggling) {
      return;
    }
    if (!nextEnabled) {
      const ok = await confirm(
        'Выключить Fair Play?',
        'Все текущие санкции будут сняты.',
      );
      if (!ok) {
        return;
      }
    }
    setToggling(true);
    try {
      const response = await updateFairPlaySettings(nextEnabled);
      setEnabled(Boolean(response?.data?.enabled));
      showAlert(nextEnabled ? 'Fair Play включён' : 'Fair Play выключен', 'success');
      await load();
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось изменить настройку', 'error');
    } finally {
      setToggling(false);
    }
  }

  async function runAction(action, userId, label) {
    const ok = await confirm('Подтверждение', `${label}?`);
    if (!ok) return;
    setActionId(userId);
    try {
      await action(userId);
      showAlert('Готово', 'success');
      await load();
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Ошибка операции', 'error');
    } finally {
      setActionId(null);
    }
  }

  return (
    <div>
      <h2>Fair Play</h2>

      <div className={fpStyles.toggleRow}>
        <span className={fpStyles.toggleLabel}>Защита</span>
        <div className={fpStyles.toggleGroup} role="group" aria-label="Fair Play">
          <button
            type="button"
            className={enabled ? fpStyles.toggleOn : fpStyles.toggleIdle}
            disabled={settingsLoading || toggling}
            onClick={() => handleToggle(true)}
          >
            Включено
          </button>
          <button
            type="button"
            className={!enabled ? fpStyles.toggleOff : fpStyles.toggleIdle}
            disabled={settingsLoading || toggling}
            onClick={() => handleToggle(false)}
          >
            Выключено
          </button>
        </div>
      </div>

      {enabled ? (
        <>
          <div className={fpStyles.filters}>
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? fpStyles.filterActive : fpStyles.filterBtn}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p>Загрузка...</p>
          ) : rows.length === 0 ? (
            <p className={fpStyles.empty}>Нет пользователей с выбранным типом санкции.</p>
          ) : (
            <div className={fpStyles.list}>
              {rows.map((row) => {
                const u = row.user;
                const fp = row.fair_play;
                const busy = actionId === u.id;
                return (
                  <div key={u.id} className={fpStyles.card}>
                    <div className={fpStyles.cardHead}>
                      <strong>{formatUserName(u.first_name, u.last_name)}</strong>
                      <span className={fpStyles.position}>{u.position}</span>
                      <div className={fpStyles.badges}>
                        {statusBadges(fp).map((b) => (
                          <span key={b} className={fpStyles.badge}>{b}</span>
                        ))}
                      </div>
                    </div>

                    <div className={fpStyles.details}>
                      {fp?.is_fair_play_banned && (
                        <p>Бан до: {formatMskDateTime(fp.ban_until)} (МСК)</p>
                      )}
                      {fp?.limit_until && new Date(fp.limit_until) > new Date() && (
                        <p>
                          Лимит: {fp.limit_cap} ({fp.limit_mode === 'weekly' ? 'в неделю' : 'в день'})
                          {' '}до {formatMskDateTime(fp.limit_until)} (МСК)
                        </p>
                      )}
                      {fp?.suspicious_active && (
                        <p>Подозрительная активность с: {formatMskDateTime(fp.suspicious_at)}</p>
                      )}
                      {fp?.strike_count > 0 && (
                        <p>Нарушений: {fp.strike_count}. Сброс strikes: {formatMskDateTime(fp.strike_reset_at)}</p>
                      )}
                    </div>

                    <div className={fpStyles.actions}>
                      {fp?.is_fair_play_banned && (
                        <button
                          type="button"
                          disabled={busy}
                          className={styles.buttonGreen}
                          onClick={() => runAction(fairPlayLiftBan, u.id, 'Снять бан')}
                        >
                          Снять бан
                        </button>
                      )}
                      {fp?.limit_until && new Date(fp.limit_until) > new Date() && (
                        <button
                          type="button"
                          disabled={busy}
                          className={styles.buttonGreen}
                          onClick={() => runAction(fairPlayLiftLimit, u.id, 'Снять ограничение лимита')}
                        >
                          Снять лимит
                        </button>
                      )}
                      {fp?.suspicious_active && (
                        <button
                          type="button"
                          disabled={busy}
                          className={styles.buttonGreen}
                          onClick={() => runAction(fairPlayClearSuspicious, u.id, 'Снять метку подозрительности')}
                        >
                          Снять «подозрительно»
                        </button>
                      )}
                      {fp?.strike_count > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          className={fpStyles.buttonSecondary}
                          onClick={() => runAction(fairPlayResetStrikes, u.id, 'Сбросить счётчик нарушений')}
                        >
                          Сброс strikes
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className={fpStyles.empty}>Защита выключена. Санкций нет.</p>
      )}
    </div>
  );
}

export default FairPlayManager;
