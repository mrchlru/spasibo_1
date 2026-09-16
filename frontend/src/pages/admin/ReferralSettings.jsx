import React, { useEffect, useMemo, useState } from 'react';
import styles from '../AdminPage.module.css';
import { adminGetAllUsers, getAppSettings, searchUsers, updateAppSettings } from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { formatToMsk } from '../../utils/dateFormatter';
import {
  DEFAULT_REFERRAL,
  buildReferralSchedule,
  isReferralWithinSchedule,
  normalizeReferral,
} from '../../pwa/referralCampaign.js';

/**
 * Подпись пользователя для списка аудитории.
 *
 * @param {{ first_name?: string, last_name?: string, username?: string, id?: number }} user
 */
function formatAudienceUserLabel(user) {
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  if (name && user?.username) {
    return `${name} (@${user.username})`;
  }
  if (name) {
    return name;
  }
  if (user?.username) {
    return `@${user.username}`;
  }
  return `ID ${user?.id}`;
}

/**
 * Админка: реферальная кампания (сроки, бонусы, аудитория рекламы).
 */
function ReferralSettings({ onAppSettingsUpdated }) {
  const { showAlert } = useModalAlert();
  const [campaign, setCampaign] = useState({ ...DEFAULT_REFERRAL });
  const [audienceUsers, setAudienceUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await getAppSettings();
        if (cancelled) {
          return;
        }
        const next = normalizeReferral(response?.data?.referral);
        setCampaign(next);
        if (next.promo_allowed_user_ids.length > 0) {
          const usersResponse = await adminGetAllUsers();
          if (cancelled) {
            return;
          }
          const byId = new Map((usersResponse?.data || []).map((user) => [user.id, user]));
          setAudienceUsers(
            next.promo_allowed_user_ids
              .map((id) => byId.get(id) || { id })
              .filter(Boolean),
          );
        } else {
          setAudienceUsers([]);
        }
      } catch {
        if (!cancelled) {
          showAlert('Не удалось загрузить настройки рефералки.', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAlert]);

  const selectedIds = useMemo(
    () => new Set(campaign.promo_allowed_user_ids),
    [campaign.promo_allowed_user_ids],
  );

  function updateField(key, value) {
    setCampaign((prev) => normalizeReferral({ ...prev, [key]: value }));
  }

  async function persistCampaign(next, successMessage) {
    setLoading(true);
    try {
      const payload = normalizeReferral(next);
      const response = await updateAppSettings({ referral: payload });
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        const saved = normalizeReferral(response.data.referral);
        setCampaign(saved);
      }
      showAlert(successMessage, 'success');
      return true;
    } catch {
      showAlert('Не удалось сохранить настройки рефералки.', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    await persistCampaign(campaign, 'Настройки рефералки сохранены.');
  }

  async function handleToggleCampaign(enabled) {
    const previous = campaign;
    let next = normalizeReferral({ ...campaign, enabled });
    if (enabled) {
      next = {
        ...next,
        ...buildReferralSchedule(),
      };
    }
    setCampaign(next);
    const ok = await persistCampaign(
      next,
      enabled ? 'Реферальная акция запущена на 30 дней.' : 'Реферальная акция остановлена.',
    );
    if (!ok) {
      setCampaign(normalizeReferral(previous));
    }
  }

  async function handleSearch() {
    const q = searchQuery.trim();
    if (q.length < 2) {
      showAlert('Введите минимум 2 символа для поиска.', 'error');
      return;
    }
    setSearching(true);
    try {
      const response = await searchUsers(q);
      setSearchResults(response?.data || []);
    } catch {
      showAlert('Поиск не удался.', 'error');
    } finally {
      setSearching(false);
    }
  }

  function addAudienceUser(user) {
    if (!user?.id || selectedIds.has(user.id)) {
      return;
    }
    setAudienceUsers((prev) => [...prev, user]);
    updateField('promo_allowed_user_ids', [...campaign.promo_allowed_user_ids, user.id]);
  }

  function removeAudienceUser(userId) {
    setAudienceUsers((prev) => prev.filter((user) => user.id !== userId));
    updateField(
      'promo_allowed_user_ids',
      campaign.promo_allowed_user_ids.filter((id) => id !== userId),
    );
  }

  const scheduleActive = campaign.enabled && isReferralWithinSchedule(campaign);
  const endsLabel = campaign.ends_at ? formatToMsk(campaign.ends_at) : null;
  const filteredSearchResults = searchResults.filter((user) => !selectedIds.has(user.id));

  return (
    <div className={styles.card}>
      <h2>Реферальная акция</h2>
      <p style={{ marginTop: 0, color: '#456843' }}>
        Персональные ссылки, бонусы за новых и вернувшихся коллег.
        Кампания на 30 дней с автоотключением. Уже начатые приглашения
        доводят условия до конца даже после остановки.
      </p>

      <div
        style={{
          margin: '1rem 0',
          padding: '1rem',
          borderRadius: 14,
          background: scheduleActive ? 'rgba(92, 161, 74, 0.14)' : 'rgba(0,0,0,0.04)',
        }}
      >
        <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: '#234a20' }}>
          Статус: {scheduleActive ? 'акция активна' : 'акция выключена'}
        </p>
        {endsLabel && (
          <p style={{ margin: '0 0 0.75rem', color: '#456843', fontSize: '0.95rem' }}>
            {scheduleActive
              ? `Автоматически отключится: ${endsLabel} (МСК)`
              : `Последнее окно до: ${endsLabel} (МСК)`}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.buttonGreen}
            disabled={loading || scheduleActive}
            onClick={() => handleToggleCampaign(true)}
          >
            Запустить
          </button>
          <button
            type="button"
            className={styles.buttonGrey}
            disabled={loading || !campaign.enabled}
            onClick={() => handleToggleCampaign(false)}
          >
            Остановить
          </button>
        </div>
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Бонусы (спасибки)</h3>
      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <label>
          Новый пользователь — пригласившему
          <input
            type="number"
            min={0}
            value={campaign.bonus_new_inviter}
            onChange={(e) => updateField('bonus_new_inviter', Number(e.target.value))}
            className={styles.input}
          />
        </label>
        <label>
          Новый пользователь — приглашённому
          <input
            type="number"
            min={0}
            value={campaign.bonus_new_invitee}
            onChange={(e) => updateField('bonus_new_invitee', Number(e.target.value))}
            className={styles.input}
          />
        </label>
        <label>
          Возвращение — пригласившему
          <input
            type="number"
            min={0}
            value={campaign.bonus_reactivate_inviter}
            onChange={(e) => updateField('bonus_reactivate_inviter', Number(e.target.value))}
            className={styles.input}
          />
        </label>
        <label>
          Возвращение — приглашённому
          <input
            type="number"
            min={0}
            value={campaign.bonus_reactivate_invitee}
            onChange={(e) => updateField('bonus_reactivate_invitee', Number(e.target.value))}
            className={styles.input}
          />
        </label>
      </div>

      <h3 style={{ margin: '1.25rem 0 0.5rem' }}>Условия возвращения</h3>
      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <label>
          Месяцев без активности
          <input
            type="number"
            min={1}
            value={campaign.inactive_months}
            onChange={(e) => updateField('inactive_months', Number(e.target.value))}
            className={styles.input}
          />
        </label>
        <label>
          Минимум дней с отправкой спасибок
          <input
            type="number"
            min={1}
            value={campaign.reactivation_min_days}
            onChange={(e) => updateField('reactivation_min_days', Number(e.target.value))}
            className={styles.input}
          />
        </label>
        <label>
          Окно (дней)
          <input
            type="number"
            min={1}
            value={campaign.reactivation_window_days}
            onChange={(e) => updateField('reactivation_window_days', Number(e.target.value))}
            className={styles.input}
          />
        </label>
      </div>

      <h3 style={{ margin: '1.25rem 0 0.5rem' }}>Тестовая история / кому показывать</h3>
      <p style={{ marginTop: 0, color: '#456843', fontSize: '0.92rem' }}>
        После запуска акции выбранным людям показывается история (как онбординг)
        и плашка в профиле. Если ничего не отмечено — видят все.
        Для теста отметьте админов и/или конкретных пользователей.
      </p>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(campaign.promo_admins_only)}
          onChange={(event) => updateField('promo_admins_only', event.target.checked)}
        />
        Всем администраторам
      </label>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск пользователя"
          className={styles.input}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button type="button" className={styles.buttonGrey} disabled={searching} onClick={handleSearch}>
          {searching ? '...' : 'Найти'}
        </button>
      </div>
      {filteredSearchResults.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0' }}>
          {filteredSearchResults.slice(0, 8).map((user) => (
            <li key={user.id} style={{ marginBottom: 6 }}>
              <button type="button" className={styles.buttonGrey} onClick={() => addAudienceUser(user)}>
                + {formatAudienceUserLabel(user)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {audienceUsers.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0' }}>
          {audienceUsers.map((user) => (
            <li
              key={user.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <span>{formatAudienceUserLabel(user)}</span>
              <button type="button" className={styles.buttonGrey} onClick={() => removeAudienceUser(user.id)}>
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: '1.25rem' }}>
        <button type="button" className={styles.buttonGreen} disabled={loading} onClick={handleSave}>
          {loading ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
}

export default ReferralSettings;
