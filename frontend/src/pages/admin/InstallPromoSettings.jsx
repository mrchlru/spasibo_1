import React, { useEffect, useMemo, useState } from 'react';
import styles from '../AdminPage.module.css';
import { adminGetAllUsers, getAppSettings, searchUsers, updateAppSettings } from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { formatToMsk } from '../../utils/dateFormatter';
import {
  DEFAULT_INSTALL_PROMO,
  buildInstallPromoSchedule,
  isInstallPromoWithinSchedule,
  normalizeInstallPromo,
} from '../../pwa/appInstallPromo.js';

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
 * Админка: запуск и остановка мягкой рекламы установки приложения.
 */
function InstallPromoSettings({ onAppSettingsUpdated }) {
  const { showAlert } = useModalAlert();
  const [promo, setPromo] = useState({ ...DEFAULT_INSTALL_PROMO, allowed_user_ids: [] });
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
        const nextPromo = normalizeInstallPromo(response?.data?.install_promo);
        setPromo(nextPromo);
        if (nextPromo.allowed_user_ids.length > 0) {
          const usersResponse = await adminGetAllUsers();
          if (cancelled) {
            return;
          }
          const byId = new Map(
            (usersResponse?.data || []).map((user) => [user.id, user]),
          );
          setAudienceUsers(
            nextPromo.allowed_user_ids
              .map((id) => byId.get(id) || { id })
              .filter(Boolean),
          );
        } else {
          setAudienceUsers([]);
        }
      } catch {
        if (!cancelled) {
          showAlert('Не удалось загрузить настройки рекламы установки.', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAlert]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return undefined;
    }
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const response = await searchUsers(query);
          if (!cancelled) {
            setSearchResults(response?.data || []);
          }
        } catch {
          if (!cancelled) {
            setSearchResults([]);
          }
        } finally {
          if (!cancelled) {
            setSearching(false);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [searchQuery]);

  const selectedIds = useMemo(
    () => new Set(promo.allowed_user_ids || []),
    [promo.allowed_user_ids],
  );

  function updateField(key, value) {
    setPromo((prev) => ({ ...prev, [key]: value }));
  }

  function addAudienceUser(user) {
    if (!user?.id || selectedIds.has(user.id)) {
      setSearchQuery('');
      setSearchResults([]);
      return;
    }
    setPromo((prev) => ({
      ...prev,
      allowed_user_ids: [...(prev.allowed_user_ids || []), user.id],
    }));
    setAudienceUsers((prev) => [...prev, user]);
    setSearchQuery('');
    setSearchResults([]);
  }

  function removeAudienceUser(userId) {
    setPromo((prev) => ({
      ...prev,
      allowed_user_ids: (prev.allowed_user_ids || []).filter((id) => id !== userId),
    }));
    setAudienceUsers((prev) => prev.filter((user) => user.id !== userId));
  }

  async function persistPromo(next, successMessage) {
    setLoading(true);
    try {
      const payload = normalizeInstallPromo(next);
      const response = await updateAppSettings({ install_promo: payload });
      showAlert(successMessage, 'success');
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        const saved = normalizeInstallPromo(response.data.install_promo);
        setPromo(saved);
        setAudienceUsers((prev) => {
          const byId = new Map(prev.map((user) => [user.id, user]));
          return saved.allowed_user_ids.map((id) => byId.get(id) || { id });
        });
      }
      return true;
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось сохранить.', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    await persistPromo(
      promo,
      promo.enabled ? 'Реклама установки обновлена.' : 'Настройки сохранены.',
    );
  }

  async function handleToggleCampaign(enabled) {
    const previous = promo;
    let next = normalizeInstallPromo({ ...promo, enabled });
    if (enabled) {
      next = {
        ...next,
        ...buildInstallPromoSchedule(),
      };
    }
    setPromo(next);
    const ok = await persistPromo(
      next,
      enabled ? 'Кампания запущена на 30 дней.' : 'Кампания остановлена.',
    );
    if (!ok) {
      setPromo(normalizeInstallPromo(previous));
    }
  }

  const scheduleActive = promo.enabled && isInstallPromoWithinSchedule(promo);
  const endsLabel = promo.ends_at
    ? formatToMsk(promo.ends_at)
    : null;
  const filteredSearchResults = searchResults.filter((user) => !selectedIds.has(user.id));

  return (
    <div className={styles.card}>
      <h2>Реклама установки приложения</h2>
      <p style={{ marginTop: 0, color: '#456843' }}>
        Пока кампания выключена — пользователям ничего не показывается.
        После запуска действует 30 дней, затем отключается автоматически.
        На ПК — QR-код, на iOS — «На экран Домой», на Android в браузере —
        плашка APK (нужен файл в разделе «Android-приложение»).
        Показ не чаще раза в 3 дня.
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
          Статус: {scheduleActive ? 'кампания активна' : 'кампания выключена'}
        </p>
        {endsLabel && (
          <p style={{ margin: '0 0 0.75rem', color: '#456843', fontSize: '0.95rem' }}>
            {scheduleActive
              ? `Автоматически отключится: ${endsLabel} (МСК)`
              : `Последнее окно кампании до: ${endsLabel} (МСК)`}
          </p>
        )}
        {!endsLabel && (
          <p style={{ margin: '0 0 0.75rem', color: '#456843', fontSize: '0.95rem' }}>
            При запуске срок отключения будет рассчитан на 30 дней.
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
            disabled={loading || !promo.enabled}
            onClick={() => handleToggleCampaign(false)}
          >
            Остановить
          </button>
        </div>
      </div>

      <h3 style={{ marginBottom: '0.5rem' }}>Кому показывать</h3>
      <p style={{ marginTop: 0, color: '#456843', fontSize: '0.92rem' }}>
        Если ничего не отмечено и список пуст — видят все. Иначе только админы
        и/или выбранные пользователи (удобно для превью).
      </p>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(promo.admins_only)}
          onChange={(event) => updateField('admins_only', event.target.checked)}
        />
        Всем администраторам
      </label>

      <div style={{ marginTop: '0.85rem' }}>
        <label htmlFor="install-promo-user-search" style={{ display: 'block', marginBottom: 6 }}>
          Добавить пользователя
        </label>
        <input
          id="install-promo-user-search"
          type="search"
          className={styles.input}
          placeholder="Имя, фамилия или @username…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          autoComplete="off"
        />
        {searching && (
          <p style={{ margin: '0.4rem 0 0', color: '#6E7A85', fontSize: '0.85rem' }}>
            Поиск…
          </p>
        )}
        {filteredSearchResults.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: '0.5rem 0 0',
              padding: 0,
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 10,
              maxHeight: 220,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            {filteredSearchResults.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => addAudienceUser(user)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    padding: '0.55rem 0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {formatAudienceUserLabel(user)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {audienceUsers.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: '0.85rem 0 0',
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.45rem',
          }}
        >
          {audienceUsers.map((user) => (
            <li
              key={user.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.55rem',
                borderRadius: 999,
                background: 'rgba(92, 161, 74, 0.14)',
                color: '#234a20',
                fontSize: '0.88rem',
              }}
            >
              <span>{formatAudienceUserLabel(user)}</span>
              <button
                type="button"
                aria-label="Убрать"
                onClick={() => removeAudienceUser(user.id)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontWeight: 700,
                  color: '#456843',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginBottom: '0.5rem', marginTop: '1rem' }}>Платформы</h3>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(promo.desktop)}
          onChange={(event) => updateField('desktop', event.target.checked)}
        />
        Компьютер (QR + уведомления в браузере)
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(promo.ios)}
          onChange={(event) => updateField('ios', event.target.checked)}
        />
        iPhone / iPad (инструкция Home Screen)
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(promo.android_browser)}
          onChange={(event) => updateField('android_browser', event.target.checked)}
        />
        Android в браузере (скачать APK)
      </label>

      <button
        type="button"
        className={styles.buttonGreen}
        style={{ marginTop: '1.25rem' }}
        disabled={loading}
        onClick={handleSave}
      >
        {loading ? 'Сохранение…' : 'Сохранить настройки'}
      </button>
    </div>
  );
}

export default InstallPromoSettings;
