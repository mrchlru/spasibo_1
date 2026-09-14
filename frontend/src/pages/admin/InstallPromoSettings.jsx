import React, { useEffect, useState } from 'react';
import styles from '../AdminPage.module.css';
import { getAppSettings, updateAppSettings } from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import {
  DEFAULT_INSTALL_PROMO,
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

  async function handleSave() {
    setLoading(true);
    try {
      const payload = normalizeInstallPromo(promo);
      const response = await updateAppSettings({ install_promo: payload });
      showAlert(
        payload.enabled
          ? 'Реклама установки включена.'
          : 'Реклама установки выключена.',
        'success',
      );
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        setPromo(normalizeInstallPromo(response.data.install_promo));
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось сохранить.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleCampaign(enabled) {
    const next = normalizeInstallPromo({ ...promo, enabled });
    setPromo(next);
    setLoading(true);
    try {
      const response = await updateAppSettings({ install_promo: next });
      showAlert(
        enabled ? 'Кампания запущена.' : 'Кампания остановлена.',
        'success',
      );
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        setPromo(normalizeInstallPromo(response.data.install_promo));
      }
    } catch (error) {
      setPromo(normalizeInstallPromo(promo));
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось изменить статус.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2>Реклама установки приложения</h2>
      <p style={{ marginTop: 0, color: '#456843' }}>
        Пока кампания выключена — пользователям ничего не показывается.
        После запуска: на ПК — QR-код, на iOS — инструкция «На экран Домой»,
        на Android в браузере — плашка скачивания APK (нужен файл в разделе
        «Android-приложение»). Показ не чаще раза в 3 дня.
      </p>

      <div
        style={{
          margin: '1rem 0',
          padding: '1rem',
          borderRadius: 14,
          background: promo.enabled ? 'rgba(92, 161, 74, 0.14)' : 'rgba(0,0,0,0.04)',
        }}
      >
        <p style={{ margin: '0 0 0.75rem', fontWeight: 700, color: '#234a20' }}>
          Статус: {promo.enabled ? 'кампания активна' : 'кампания выключена'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.buttonGreen}
            disabled={loading || promo.enabled}
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

      <h3 style={{ marginBottom: '0.5rem' }}>Платформы</h3>
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
        {loading ? 'Сохранение…' : 'Сохранить платформы'}
      </button>
    </div>
  );
}

export default InstallPromoSettings;
