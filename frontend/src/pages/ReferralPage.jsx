import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import PageLayout from '../components/PageLayout';
import { getMyReferral, claimReferral } from '../api';
import { useModalAlert } from '../contexts/ModalAlertContext';
import {
  clearPendingReferralCode,
  getPendingReferralCode,
} from '../pwa/referralCampaign.js';
import { copyTextReliable, shareTextReliable } from '../pwa/shareClipboard.js';
import { isSpasiboAndroidApp } from '../pwa/androidNativePush.js';
import styles from './ReferralPage.module.css';

/**
 * Склонение «человек» / «человека» / «человек».
 *
 * @param {number} count
 * @returns {string}
 */
function peopleWord(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return 'человек';
  }
  if (n1 === 1) {
    return 'человек';
  }
  if (n1 >= 2 && n1 <= 4) {
    return 'человека';
  }
  return 'человек';
}

/**
 * Экран реферальной системы: QR, ссылка, статистика, приглашённые.
 */
function ReferralPage({ onBack }) {
  const { showAlert } = useModalAlert();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await getMyReferral();
        if (!cancelled) {
          setSummary(response.data);
        }
        const pending = getPendingReferralCode();
        if (pending && response?.data?.campaign_active) {
          try {
            const claim = await claimReferral(pending);
            clearPendingReferralCode();
            if (claim?.data?.ok && !cancelled) {
              showAlert(claim.data.message, 'success');
              const refreshed = await getMyReferral();
              if (!cancelled) {
                setSummary(refreshed.data);
              }
            }
          } catch {
            /* ignore claim errors on open */
          }
        }
      } catch {
        if (!cancelled) {
          showAlert('Не удалось загрузить реферальную программу.', 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAlert]);

  const shareUrl = useMemo(() => {
    if (!summary?.share_path) {
      return '';
    }
    if (typeof window === 'undefined') {
      return summary.share_path;
    }
    return `${window.location.origin}${summary.share_path}`;
  }, [summary]);

  useEffect(() => {
    let cancelled = false;
    if (!shareUrl) {
      setQrDataUrl('');
      return undefined;
    }
    void QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1f3d1c', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  async function handleCopy() {
    if (busy) {
      return;
    }
    const text = summary?.share_text || shareUrl;
    if (!text) {
      return;
    }
    setBusy(true);
    try {
      const ok = await copyTextReliable(text);
      if (ok) {
        showAlert('Текст приглашения скопирован', 'success');
      } else {
        showAlert('Не удалось скопировать', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    if (busy) {
      return;
    }
    const text = summary?.share_text || (shareUrl ? `Присоединяйся к «Спасибо»: ${shareUrl}` : '');
    if (!text) {
      return;
    }
    setBusy(true);
    try {
      await shareTextReliable({
        title: 'Спасибо — приглашение',
        text,
        url: shareUrl || undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const earned = Number(summary?.earned_spasibki) || 0;
  const registered = Number(summary?.registered_count) || 0;
  const showShareButton = !isSpasiboAndroidApp();

  return (
    <PageLayout title="Бонусы за коллег">
      <button type="button" onClick={onBack} className={styles.backButton}>
        &larr; Назад в профиль
      </button>

      {loading && <p className={styles.muted}>Загрузка...</p>}

      {!loading && summary && (
        <>
          <section className={styles.hero}>
            <p className={styles.heroEyebrow}>
              {summary.campaign_active ? 'Акция активна' : 'Новые приглашения недоступны'}
            </p>
            <h2 className={styles.heroTitle}>Пригласи коллегу — получи спасибки</h2>

            <div className={styles.statsRow}>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{earned}</span>
                <span className={styles.statLabel}>заработано спасибок</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statValue}>{registered}</span>
                <span className={styles.statLabel}>
                  зарегистрировано {peopleWord(registered)}
                </span>
              </div>
            </div>

            <div className={styles.linkBox}>
              {qrDataUrl ? (
                <div className={styles.qrWrap}>
                  <img
                    className={styles.qrImage}
                    src={qrDataUrl}
                    alt="QR-код приглашения в Спасибо"
                    width={220}
                    height={220}
                  />
                  <p className={styles.qrHint}>Покажите QR коллеге или отправьте ссылку</p>
                </div>
              ) : (
                <p className={styles.qrHint}>Готовим QR-код…</p>
              )}
              <code className={styles.linkCode}>{shareUrl}</code>
              {summary.code && (
                <p className={styles.qrHint}>
                  Ваш код: <strong>{summary.code}</strong>
                </p>
              )}
              {summary.share_text && (
                <p className={styles.sharePreview}>{summary.share_text}</p>
              )}
              <div className={styles.linkActions}>
                {showShareButton && (
                  <button type="button" className={styles.primaryBtn} onClick={handleShare} disabled={busy}>
                    Поделиться
                  </button>
                )}
                <button
                  type="button"
                  className={showShareButton ? styles.secondaryBtn : styles.primaryBtn}
                  onClick={handleCopy}
                  disabled={busy}
                >
                  Копировать
                </button>
              </div>
            </div>
            <button
              type="button"
              className={styles.rulesToggle}
              onClick={() => setRulesOpen((open) => !open)}
              aria-expanded={rulesOpen}
            >
              {rulesOpen ? 'Скрыть правила' : 'Правила акции'}
            </button>
            {rulesOpen && (
              <pre className={styles.rules}>{summary.rules}</pre>
            )}
          </section>

          <section className={styles.listSection}>
            <h3 className={styles.listTitle}>Приглашённые</h3>
            {summary.invites.length === 0 ? (
              <p className={styles.muted}>Пока никого нет — отправьте ссылку коллеге.</p>
            ) : (
              <ul className={styles.inviteList}>
                {summary.invites.map((invite) => (
                  <li key={invite.id} className={styles.inviteItem}>
                    <div>
                      <p className={styles.inviteName}>{invite.invitee_name}</p>
                      <p className={styles.inviteMeta}>{invite.kind_label}</p>
                    </div>
                    <div className={styles.inviteStatus}>
                      <span className={styles.statusPill} data-status={invite.status}>
                        {invite.status_label}
                      </span>
                      {invite.status === 'in_progress' && (
                        <span className={styles.progressHint}>
                          дней: {invite.send_days_count}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PageLayout>
  );
}

export default ReferralPage;
