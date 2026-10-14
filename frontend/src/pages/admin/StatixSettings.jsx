// frontend/src/pages/admin/StatixSettings.jsx

import React, { useState, useEffect } from 'react';
import { FaCoins } from 'react-icons/fa';
import { getStatixBonusSettings, updateStatixBonusSettings } from '../../api';
import AdminImageUrlField from '../../components/AdminImageUrlField';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { clearCache } from '../../storage';
import styles from '../AdminPage.module.css';

const DEFAULT_STATIX = {
  name: 'Бонусы Statix',
  description: 'Покупка бонусов для платформы Statix',
  image_url: '',
  thanks_to_statix_rate: 10,
  min_bonus_per_step: 100,
  max_bonus_per_step: 10000,
  bonus_step: 100,
  is_active: false,
};

/**
 * Собирает тело PUT /admin/statix-bonus без служебных полей ответа.
 */
function buildStatixUpdatePayload(settings, overrides = {}) {
  return {
    name: settings.name,
    description: settings.description,
    image_url: settings.image_url || null,
    thanks_to_statix_rate: Number(settings.thanks_to_statix_rate) || 10,
    min_bonus_per_step: Number(settings.min_bonus_per_step) || 100,
    max_bonus_per_step: Number(settings.max_bonus_per_step) || 10000,
    bonus_step: Number(settings.bonus_step) || 100,
    is_active: Boolean(settings.is_active),
    ...overrides,
  };
}

/**
 * Текст ошибки API для алерта.
 */
function getApiErrorDetail(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  return fallback;
}

/**
 * Настройки товара Statix Bonus в админке, включая включение/отключение витрины.
 */
function StatixSettings() {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [statixSettings, setStatixSettings] = useState(DEFAULT_STATIX);
  const [statixLoading, setStatixLoading] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    void fetchStatixSettings();
  }, []);

  async function fetchStatixSettings() {
    setStatixLoading(true);
    try {
      const response = await getStatixBonusSettings();
      if (!response.data) {
        setStatixSettings(DEFAULT_STATIX);
        return;
      }
      setStatixSettings({
        ...DEFAULT_STATIX,
        ...response.data,
        image_url: response.data.image_url || '',
        is_active: Boolean(response.data.is_active),
      });
    } catch (error) {
      const status = error.response?.status;
      // Товара ещё нет — форма с дефолтами, без ошибки «не удалось загрузить».
      if (status === 404 || status === 204) {
        setStatixSettings(DEFAULT_STATIX);
        return;
      }
      showAlert(getApiErrorDetail(error, 'Не удалось загрузить настройки Statix Bonus.'), 'error');
    } finally {
      setStatixLoading(false);
    }
  }

  function handleStatixSettingsChange(e) {
    const { name, value, type, checked } = e.target;
    setStatixSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? parseInt(value, 10) || 0 : value,
    }));
  }

  async function handleStatixSettingsSubmit(e) {
    e.preventDefault();
    setStatixLoading(true);
    try {
      const response = await updateStatixBonusSettings(buildStatixUpdatePayload(statixSettings));
      setStatixSettings({
        ...DEFAULT_STATIX,
        ...response.data,
        image_url: response.data?.image_url || '',
        is_active: Boolean(response.data?.is_active),
      });
      showAlert('Настройки Statix Bonus обновлены!', 'success');
      clearCache('market');
    } catch (error) {
      showAlert(getApiErrorDetail(error, 'Ошибка при обновлении настроек.'), 'error');
    } finally {
      setStatixLoading(false);
    }
  }

  async function handleToggleActive() {
    const nextActive = !statixSettings.is_active;
    const isConfirmed = await confirm(
      nextActive ? 'Включить Statix Bonus' : 'Отключить Statix Bonus',
      nextActive
        ? 'Товар снова появится в маркетплейсе у пользователей.'
        : 'Товар исчезнет из маркетплейса. Уведомления об ошибке загрузки показываться не будут.'
    );
    if (!isConfirmed) {
      return;
    }

    setToggling(true);
    try {
      // Только статус — бэкенд обрабатывает это отдельным надёжным путём.
      const response = await updateStatixBonusSettings({ is_active: nextActive });
      setStatixSettings((prev) => ({
        ...prev,
        ...response.data,
        image_url: response.data?.image_url || prev.image_url || '',
        is_active: Boolean(response.data?.is_active),
      }));
      showAlert(
        nextActive ? 'Statix Bonus включён.' : 'Statix Bonus отключён.',
        'success'
      );
      clearCache('market');
    } catch (error) {
      showAlert(getApiErrorDetail(error, 'Не удалось изменить статус Statix Bonus.'), 'error');
    } finally {
      setToggling(false);
    }
  }

  const isActive = Boolean(statixSettings.is_active);

  return (
    <div className={styles.card}>
      <h2>
        <FaCoins style={{ marginRight: '8px' }} />
        Настройки Statix Bonus
      </h2>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '16px',
          padding: '12px',
          borderRadius: '8px',
          background: isActive ? 'rgba(46, 125, 50, 0.08)' : 'rgba(158, 158, 158, 0.12)',
        }}
      >
        <div>
          <strong>Статус:</strong>{' '}
          {isActive ? 'включён (виден пользователям)' : 'отключён (скрыт)'}
        </div>
        <button
          type="button"
          onClick={handleToggleActive}
          disabled={statixLoading || toggling}
          className={isActive ? styles.buttonGrey : styles.buttonGreen}
        >
          {toggling
            ? 'Сохранение...'
            : isActive
              ? 'Отключить Statix Bonus'
              : 'Включить Statix Bonus'}
        </button>
      </div>

      <form onSubmit={handleStatixSettingsSubmit}>
        <AdminImageUrlField
          value={statixSettings.image_url}
          onChange={(v) => setStatixSettings((prev) => ({ ...prev, image_url: v }))}
          placeholder="Ссылка на изображение (URL) 4:3 или загрузка (AVIF)"
          urlHint="Загрузка: AVIF в объектное хранилище."
        />

        <input
          type="text"
          name="name"
          value={statixSettings.name}
          onChange={handleStatixSettingsChange}
          placeholder="Название товара"
          className={styles.input}
          required
        />

        <textarea
          name="description"
          placeholder="Описание"
          value={statixSettings.description}
          onChange={handleStatixSettingsChange}
          maxLength="120"
          className={styles.textarea}
        />

        <div className={styles.statixSettingsGrid}>
          <div className={styles.settingGroup}>
            <label>Курс валют (спасибок за 100 бонусов)</label>
            <input
              type="number"
              name="thanks_to_statix_rate"
              value={statixSettings.thanks_to_statix_rate}
              onChange={handleStatixSettingsChange}
              className={styles.input}
              min="1"
              required
            />
          </div>

          <div className={styles.settingGroup}>
            <label>Минимум бонусов за шаг</label>
            <input
              type="number"
              name="min_bonus_per_step"
              value={statixSettings.min_bonus_per_step}
              onChange={handleStatixSettingsChange}
              className={styles.input}
              min="1"
              required
            />
          </div>

          <div className={styles.settingGroup}>
            <label>Максимум бонусов за шаг</label>
            <input
              type="number"
              name="max_bonus_per_step"
              value={statixSettings.max_bonus_per_step}
              onChange={handleStatixSettingsChange}
              className={styles.input}
              min="1"
              required
            />
          </div>

          <div className={styles.settingGroup}>
            <label>Шаг увеличения бонусов</label>
            <input
              type="number"
              name="bonus_step"
              value={statixSettings.bonus_step}
              onChange={handleStatixSettingsChange}
              className={styles.input}
              min="1"
              required
            />
          </div>
        </div>

        <div className={styles.pricePreview}>
          <p>
            <strong>Примеры курса:</strong>
          </p>
          <p>10 спасибок = 100 бонусов</p>
          <p>20 спасибок = 200 бонусов</p>
          <p>100 спасибок = 1000 бонусов</p>
          <p>1000 спасибок = 10000 бонусов</p>
        </div>

        <button type="submit" disabled={statixLoading || toggling} className={styles.buttonGreen}>
          {statixLoading ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </form>
    </div>
  );
}

export default StatixSettings;
