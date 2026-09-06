import React, { useEffect, useState } from 'react';
import styles from '../AdminPage.module.css';
import { getAdminMediaStatus, getAppSettings, updateAppSettings, uploadAdminApk } from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { DEFAULT_ANDROID_RELEASE, normalizeAndroidRelease } from '../../pwa/androidInstallPrompt.js';

/** Админка: релиз Android APK (только для главного администратора). */
function AndroidReleaseSettings({ onAppSettingsUpdated }) {
  const { showAlert } = useModalAlert();
  const [release, setRelease] = useState({ ...DEFAULT_ANDROID_RELEASE });
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settingsResponse, mediaResponse] = await Promise.all([
          getAppSettings(),
          getAdminMediaStatus(),
        ]);
        if (cancelled) {
          return;
        }
        setRelease(normalizeAndroidRelease(settingsResponse?.data?.android_release));
        setMediaEnabled(Boolean(mediaResponse?.data?.enabled));
      } catch {
        if (!cancelled) {
          showAlert('Не удалось загрузить настройки Android-приложения.', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAlert]);

  const updateField = (key, value) => {
    setRelease((prev) => ({ ...prev, [key]: value }));
  };

  const handleApkUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.apk')) {
      showAlert('Выберите файл .apk', 'error');
      return;
    }
    setUploading(true);
    try {
      const response = await uploadAdminApk(file);
      updateField('apk_url', response.data.url);
      showAlert('APK загружен.', 'success');
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось загрузить APK.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = normalizeAndroidRelease(release);
      if (payload.enabled && !payload.apk_url) {
        showAlert('Укажите ссылку на APK или загрузите файл.', 'error');
        return;
      }
      if (payload.enabled && payload.version_code <= 0) {
        showAlert('Укажите versionCode больше 0 (например 2 — как в APK).', 'error');
        return;
      }
      const response = await updateAppSettings({ android_release: payload });
      showAlert('Настройки Android-приложения сохранены.', 'success');
      if (response?.data) {
        onAppSettingsUpdated?.(response.data);
        setRelease(normalizeAndroidRelease(response.data.android_release));
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось сохранить настройки.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2>Android-приложение</h2>
      <p style={{ marginTop: 0, color: '#456843' }}>
        Раздел виден только главному администратору. Пока переключатель выключен — слайдер видите
        только вы (для теста). После включения — все пользователи Android в браузере и в APK
        (если versionCode ниже релиза).
      </p>

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={Boolean(release.enabled)}
          onChange={(event) => updateField('enabled', event.target.checked)}
        />
        Показывать всем пользователям Android
      </label>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Заголовок (установка в браузере)</p>
        <input
          type="text"
          className={styles.input}
          value={release.title}
          onChange={(event) => updateField('title', event.target.value)}
        />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Описание (установка в браузере)</p>
        <textarea
          className={styles.input}
          rows={3}
          value={release.description}
          onChange={(event) => updateField('description', event.target.value)}
        />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Заголовок (обновление в APK)</p>
        <input
          type="text"
          className={styles.input}
          value={release.update_title}
          onChange={(event) => updateField('update_title', event.target.value)}
        />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Описание (обновление в APK)</p>
        <textarea
          className={styles.input}
          rows={3}
          value={release.update_description}
          onChange={(event) => updateField('update_description', event.target.value)}
        />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Что нового (необязательно)</p>
        <textarea
          className={styles.input}
          rows={4}
          value={release.release_notes}
          onChange={(event) => updateField('release_notes', event.target.value)}
        />
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>versionName</p>
          <input
            type="text"
            className={styles.input}
            value={release.version_name}
            onChange={(event) => updateField('version_name', event.target.value)}
            placeholder="1.0.1"
          />
        </div>
        <div>
          <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>versionCode</p>
          <input
            type="number"
            min="0"
            className={styles.input}
            value={release.version_code}
            onChange={(event) => updateField('version_code', Number.parseInt(event.target.value, 10) || 0)}
          />
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>Ссылка на APK</p>
        <input
          type="url"
          className={styles.input}
          value={release.apk_url}
          onChange={(event) => updateField('apk_url', event.target.value)}
          placeholder="https://..."
        />
        {release.apk_url ? (
          <p style={{ margin: '0.45rem 0 0', fontSize: '0.85rem', wordBreak: 'break-all' }}>
            {release.apk_url}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <label className={styles.buttonGreen} style={{ display: 'inline-block', cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Загрузка APK…' : 'Загрузить APK в хранилище'}
          <input
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={handleApkUpload}
            disabled={uploading || !mediaEnabled}
            style={{ display: 'none' }}
          />
        </label>
        {!mediaEnabled ? (
          <p style={{ margin: '0.5rem 0 0', color: '#c0392b', fontSize: '0.9rem' }}>
            S3 не настроен — загрузите APK вручную и вставьте URL.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.buttonGreen}
        style={{ marginTop: '1.25rem' }}
        onClick={handleSave}
        disabled={loading || uploading}
      >
        {loading ? 'Сохранение…' : 'Сохранить'}
      </button>
    </div>
  );
}

export default AndroidReleaseSettings;
