import React, { useEffect, useMemo, useState } from 'react';
import styles from '../AdminPage.module.css';
import localStyles from './NewYearEventManager.module.css';
import {
  deleteAdminNyCertificate,
  exportAdminNyStatsCsv,
  fetchAuthedMediaUrl,
  getAdminNyCertificates,
  getAdminNyPhotos,
  getAdminNySettings,
  getAdminNyStats,
  patchAdminNyCertificate,
  patchAdminNyPhoto,
  patchAdminNySettings,
  uploadAdminNyCertificates,
} from '../../api';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { downloadExcelBlob } from '../../utils/downloadBlob';

const TABS = [
  { id: 'certificates', label: 'Сертификаты' },
  { id: 'stats', label: 'Статистика' },
  { id: 'photos', label: 'Фото' },
  { id: 'settings', label: 'Настройки' },
];

/**
 * Админ-раздел новогоднего ивента.
 */
function NewYearEventManager() {
  const { showAlert } = useModalAlert();
  const [tab, setTab] = useState('certificates');
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [certs, setCerts] = useState([]);
  const [certFilter, setCertFilter] = useState('');
  const [certQuery, setCertQuery] = useState('');
  const [stats, setStats] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [thumbMap, setThumbMap] = useState({});
  const [uploadFiles, setUploadFiles] = useState([]);
  const [linksCsv, setLinksCsv] = useState(null);
  const [manualLinks, setManualLinks] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState(null);

  async function refreshSettings() {
    const response = await getAdminNySettings();
    setSettings(response.data);
  }

  async function refreshCerts() {
    const response = await getAdminNyCertificates({
      status: certFilter || undefined,
      q: certQuery || undefined,
      page: 1,
    });
    setCerts(response.data.items || []);
    const next = {};
    await Promise.all(
      (response.data.items || []).slice(0, 40).map(async (item) => {
        try {
          next[item.id] = await fetchAuthedMediaUrl(item.thumb_url);
        } catch {
          /* ignore */
        }
      }),
    );
    setThumbMap((prev) => ({ ...prev, ...next }));
  }

  async function refreshStats() {
    const response = await getAdminNyStats();
    setStats(response.data);
  }

  async function refreshPhotos() {
    const response = await getAdminNyPhotos();
    setPhotos(response.data.items || []);
    const next = {};
    await Promise.all(
      (response.data.items || []).map(async (item) => {
        try {
          next[item.user_id] = await fetchAuthedMediaUrl(item.thumb_url);
        } catch {
          /* ignore */
        }
      }),
    );
    setThumbMap((prev) => ({ ...prev, ...next }));
  }

  useEffect(() => {
    void refreshSettings().catch(() => showAlert('Не удалось загрузить настройки', 'error'));
  }, [showAlert]);

  useEffect(() => {
    if (tab === 'certificates') {
      void refreshCerts().catch(() => showAlert('Не удалось загрузить сертификаты', 'error'));
    }
    if (tab === 'stats') {
      void refreshStats().catch(() => showAlert('Не удалось загрузить статистику', 'error'));
    }
    if (tab === 'photos') {
      void refreshPhotos().catch(() => showAlert('Не удалось загрузить фото', 'error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, certFilter]);

  const previewRows = useMemo(
    () =>
      uploadFiles.map((file) => ({
        file,
        link: manualLinks[file.name] || '',
      })),
    [uploadFiles, manualLinks],
  );

  async function handleUpload() {
    if (!uploadFiles.length) {
      showAlert('Выберите файлы сертификатов (JPG/PNG/WEBP/PDF или ZIP)', 'error');
      return;
    }
    setUploading(true);
    setUploadReport(null);
    try {
      const linksJson = {};
      previewRows.forEach((row) => {
        if (row.link) linksJson[row.file.name] = { link: row.link };
      });
      const response = await uploadAdminNyCertificates({
        files: uploadFiles,
        linksJson,
        linksCsv,
        comment: 'admin-upload',
      });
      setUploadReport(response.data);
      const created = Number(response.data?.created || 0);
      showAlert(
        response.data.message || (created > 0 ? 'Загрузка завершена' : 'Файлы не загружены'),
        created > 0 ? 'success' : 'error',
      );
      if (created > 0) {
        setUploadFiles([]);
        setLinksCsv(null);
        setManualLinks({});
        await refreshCerts();
        await refreshStats();
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      let message = 'Ошибка загрузки';
      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail
          .map((item) => item?.msg || item?.detail || JSON.stringify(item))
          .join('; ');
      } else if (error.message) {
        message = error.message;
      }
      showAlert(message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    try {
      const response = await patchAdminNySettings({
        is_active: Boolean(settings.is_active),
        starts_at: settings.starts_at || null,
        ends_at: settings.ends_at || null,
        taps_required: Number(settings.taps_required) || 7,
        photo_moderation_required: Boolean(settings.photo_moderation_required),
        low_stock_threshold: Number(settings.low_stock_threshold) || 0,
      });
      setSettings(response.data);
      showAlert('Настройки сохранены', 'success');
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось сохранить', 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  return (
    <div className={localStyles.wrap}>
      <h2 className={styles.sectionTitle || localStyles.title}>Новогодний ивент</h2>
      <div className={localStyles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${localStyles.tab}${tab === item.id ? ` ${localStyles.tabActive}` : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && settings ? (
        <form className={localStyles.form} onSubmit={saveSettings}>
          <label className={localStyles.check}>
            <input
              type="checkbox"
              checked={Boolean(settings.is_active)}
              onChange={(e) => setSettings({ ...settings, is_active: e.target.checked })}
            />
            Ивент включён
          </label>
          <label>
            Начало
            <input
              type="datetime-local"
              value={toLocalInput(settings.starts_at)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  starts_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </label>
          <label>
            Конец
            <input
              type="datetime-local"
              value={toLocalInput(settings.ends_at)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </label>
          <label>
            Число тапов
            <input
              type="number"
              min={1}
              max={50}
              value={settings.taps_required || 7}
              onChange={(e) => setSettings({ ...settings, taps_required: Number(e.target.value) })}
            />
          </label>
          <label>
            Порог низкого остатка
            <input
              type="number"
              min={0}
              value={settings.low_stock_threshold || 0}
              onChange={(e) =>
                setSettings({ ...settings, low_stock_threshold: Number(e.target.value) })
              }
            />
          </label>
          <label className={localStyles.check}>
            <input
              type="checkbox"
              checked={Boolean(settings.photo_moderation_required)}
              onChange={(e) =>
                setSettings({ ...settings, photo_moderation_required: e.target.checked })
              }
            />
            Модерация фото перед стеной
          </label>
          <p className={localStyles.hint}>
            Окно сейчас: {settings.window_open ? 'открыто' : 'закрыто'}
          </p>
          <button type="submit" className={styles.gridButton} disabled={savingSettings}>
            {savingSettings ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      ) : null}

      {tab === 'certificates' ? (
        <div className={localStyles.block}>
          <h3>Загрузка пакета</h3>
          <p className={localStyles.hint}>
            1) Выберите файлы сертификатов: JPG, PNG, WEBP, GIF, PDF или ZIP.
            Файл уходит в S3 в папку по имени; если ссылку не указать — в системе появится ссылка на сам файл.
          </p>
          <input
            type="file"
            accept="image/*,.pdf,application/pdf,.zip"
            multiple
            onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
          />
          <p className={localStyles.hint}>
            2) По желанию: CSV/XLSX со ссылками (колонки file_name, link) или https-ссылка вручную.
            Текст без http:// будет сохранён как название, а не как ссылка.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setLinksCsv(e.target.files?.[0] || null)}
          />
          <div className={localStyles.previewList}>
            {previewRows.map((row) => (
              <div key={row.file.name} className={localStyles.previewRow}>
                <span>{row.file.name}</span>
                <input
                  placeholder="https://… (необязательно)"
                  value={row.link}
                  onChange={(e) =>
                    setManualLinks((prev) => ({ ...prev, [row.file.name]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <button type="button" className={styles.gridButton} disabled={uploading} onClick={handleUpload}>
            {uploading ? 'Загрузка…' : `Загрузить файлы (${uploadFiles.length || 0})`}
          </button>
          {uploadReport ? (
            <div className={localStyles.report}>
              <p>{uploadReport.message}</p>
              {(uploadReport.errors || []).slice(0, 20).map((err) => (
                <div key={`${err.file_name}-${err.error}`}>
                  {err.file_name}: {err.error}
                </div>
              ))}
            </div>
          ) : null}

          <h3>Список</h3>
          <div className={localStyles.filters}>
            <select value={certFilter} onChange={(e) => setCertFilter(e.target.value)}>
              <option value="">Все статусы</option>
              <option value="available">Доступен</option>
              <option value="issued">Выдан</option>
              <option value="disabled">Отключён</option>
            </select>
            <input
              placeholder="Поиск"
              value={certQuery}
              onChange={(e) => setCertQuery(e.target.value)}
            />
            <button type="button" onClick={() => refreshCerts()}>
              Найти
            </button>
          </div>
          <div className={localStyles.certGrid}>
            {certs.map((cert) => (
              <div key={cert.id} className={localStyles.certCard}>
                {thumbMap[cert.id] ? <img src={thumbMap[cert.id]} alt="" /> : <div className={localStyles.ph} />}
                <div>
                  <b>#{cert.id}</b> · {cert.status}
                  <div>{cert.title || cert.original_filename || cert.nominal || '—'}</div>
                  <div className={localStyles.small}>{cert.link_url || '—'}</div>
                  {cert.file_url && cert.file_url !== cert.link_url ? (
                    <div className={localStyles.small}>{cert.file_url}</div>
                  ) : null}
                  {cert.issued_to_name ? (
                    <div className={localStyles.small}>
                      → {cert.issued_to_name}
                    </div>
                  ) : null}
                </div>
                <div className={localStyles.certActions}>
                  {cert.status !== 'issued' ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const link = window.prompt('Новая ссылка', cert.link_url);
                          if (!link) return;
                          await patchAdminNyCertificate(cert.id, { link_url: link });
                          await refreshCerts();
                        }}
                      >
                        Ссылка
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await patchAdminNyCertificate(cert.id, {
                            status: cert.status === 'disabled' ? 'available' : 'disabled',
                          });
                          await refreshCerts();
                        }}
                      >
                        {cert.status === 'disabled' ? 'Включить' : 'Отключить'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteAdminNyCertificate(cert.id);
                          await refreshCerts();
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Аннулировать выданный сертификат?')) return;
                        await patchAdminNyCertificate(cert.id, { action: 'revoke' });
                        await refreshCerts();
                      }}
                    >
                      Аннулировать
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'stats' && stats ? (
        <div className={localStyles.block}>
          <div className={localStyles.statCards}>
            <div className={localStyles.statCard}>
              Всего: {stats.totals.certificates}
            </div>
            <div className={localStyles.statCard}>
              Выдано: {stats.totals.issued} ({stats.totals.issued_percent}%)
            </div>
            <div className={localStyles.statCard}>
              Осталось: {stats.totals.available}
              {stats.totals.low_stock ? ' ⚠ низкий остаток' : ''}
            </div>
            <div className={localStyles.statCard}>NO_STOCK: {stats.no_stock_count}</div>
          </div>
          <p>
            Воронка: открыли экран {stats.funnel.open_screen} → фото {stats.funnel.photo_uploaded} →
            подарок {stats.funnel.gift_opened}
          </p>
          <button
            type="button"
            className={styles.gridButton}
            onClick={async () => {
              const response = await exportAdminNyStatsCsv();
              await downloadExcelBlob(response, 'ny-event-issued.csv');
            }}
          >
            Экспорт CSV
          </button>
          <div className={localStyles.tableWrap}>
            <table className={localStyles.table}>
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Подразделение</th>
                  <th>Номинал</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {(stats.recipients || []).map((row) => (
                  <tr key={`${row.certificate_id}-${row.user_id}`}>
                    <td>{row.name}</td>
                    <td>{row.department}</td>
                    <td>{row.nominal || '—'}</td>
                    <td>{row.issued_at ? new Date(row.issued_at).toLocaleString('ru-RU') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'photos' ? (
        <div className={localStyles.photoGrid}>
          {photos.map((photo) => (
            <div key={photo.user_id} className={localStyles.photoCard}>
              {thumbMap[photo.user_id] ? (
                <img src={thumbMap[photo.user_id]} alt="" />
              ) : (
                <div className={localStyles.ph} />
              )}
              <div>
                <b>{photo.name}</b>
                <div className={localStyles.small}>{photo.photo_status}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await patchAdminNyPhoto(photo.user_id, photo.photo_status !== 'visible');
                  await refreshPhotos();
                }}
              >
                {photo.photo_status === 'visible' ? 'Скрыть со стены' : 'Вернуть'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default NewYearEventManager;
