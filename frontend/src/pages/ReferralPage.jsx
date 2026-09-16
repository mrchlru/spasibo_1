import React, { useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { getMyReferral, claimReferral } from '../api';
import { useModalAlert } from '../contexts/ModalAlertContext';
import {
  clearPendingReferralCode,
  getPendingReferralCode,
} from '../pwa/referralCampaign.js';
import styles from './ReferralPage.module.css';

/**
 * Экран реферальной системы: ссылка, приглашённые, правила.
 */
function ReferralPage({ onBack }) {
  const { showAlert } = useModalAlert();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copying, setCopying] = useState(false);

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

  async function handleCopy() {
    if (!shareUrl) {
      return;
    }
    setCopying(true);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('textarea');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      showAlert('Ссылка скопирована', 'success');
    } catch {
      showAlert('Не удалось скопировать ссылку', 'error');
    } finally {
      setCopying(false);
    }
  }

  async function handleShare() {
    if (!shareUrl) {
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Спасибо — приглашение',
          text: 'Присоединяйся к «Спасибо» — получи бонусные спасибки!',
          url: shareUrl,
        });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await handleCopy();
  }

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
            <p className={styles.heroText}>
              Новым — бонус сразу после входа. Вернувшимся после долгого перерыва —
              после нескольких дней с отправкой спасибок.
            </p>
            <div className={styles.linkBox}>
              <code className={styles.linkCode}>{shareUrl}</code>
              <div className={styles.linkActions}>
                <button type="button" className={styles.primaryBtn} onClick={handleShare} disabled={copying}>
                  Поделиться
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={handleCopy} disabled={copying}>
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
