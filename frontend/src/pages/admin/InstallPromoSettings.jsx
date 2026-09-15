import React, { useEffect, useState } from 'react';
import styles from '../AdminPage.module.css';
import { getAppSettings, updateAppSettings } from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { formatToMsk } from '../../utils/dateFormatter';
import {
  DEFAULT_INSTALL_PROMO,
  buildInstallPromoSchedule,
  isInstallPromoWithinSchedule,
  normalizeInstallPromo,
} from '../../pwa/appInstallPromo.js';

/**
 * Админка: запуск и остановка мягкой рекламы установки приложения.
 */
function InstallPromoSettings({ onAppSettingsUpdated }) {
  const { showAlert } = useModalAlert();
  const [promo, setPromo] = useState({ ...DEFAULT_INSTALL_PROMO });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await getAppSettings();
        if (cancelled) {
          return;
        }
        setPromo(normalizeInstallPromo(response?.data?.install_promo));
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

  function updateField(key, value) {
    setPromo((prev) => ({ ...prev, [key]: value }));
  }

  async function persistPromo(next, successMessage) {
    setLoading(true);
    try {
      const payload = normalizeInstallPromo(next);
      const response = await updateAppSettings({ install_promo: payload });
      showAlert(successMessage, 'success');
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        setPromo(normalizeInstallPromo(response.data.install_promo));
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
    const ok = await persistPromo(
      promo,
      promo.enabled ? 'Реклама установки обновлена.' : 'Настройки сохранены.',
    );
    if (!ok) {
      return;
    }
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
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(promo.admins_only)}
          onChange={(event) => updateField('admins_only', event.target.checked)}
        />
        Только администраторам (превью кампании)
      </label>

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
