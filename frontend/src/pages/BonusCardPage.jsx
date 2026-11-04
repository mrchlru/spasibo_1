import React, { useEffect, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { deleteUserCard, getTeamsBonusCard, uploadPkpassFile } from '../api';
import styles from './BonusCardPage.module.css';
import BonusCard from '../components/BonusCard';
import TeamsBonusCard from '../components/TeamsBonusCard';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useConfirmation } from '../contexts/ConfirmationContext';
import { FaUpload, FaSpinner } from 'react-icons/fa';

function BonusCardPage({ user, onBack, onUpdateUser }) {
  const { confirm } = useConfirmation();
  const { showAlert } = useModalAlert();
  const [uploading, setUploading] = useState(false);
  const [teamsCard, setTeamsCard] = useState(null);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const fileInputRef = React.useRef(null);

  const isTelegramWebApp = !!window.Telegram?.WebApp;
  const supportUrl = 'https://t.me/fix2Form';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await getTeamsBonusCard();
        if (!cancelled) {
          setTeamsCard(response.data);
        }
      } catch (error) {
        if (cancelled) return;
        const status = error.response?.status;
        const detail = error.response?.data?.detail;
        if (status === 502 && detail) {
          setTeamsCard({
            integration_enabled: true,
            linked: false,
            integration_error: typeof detail === 'string' ? detail : 'Teams Bonus недоступен',
          });
        } else {
          setTeamsCard({ integration_enabled: false, linked: false, integration_error: '' });
        }
      } finally {
        if (!cancelled) {
          setTeamsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const teamsMode = Boolean(teamsCard?.integration_enabled);

  const handleDelete = async () => {
    const isConfirmed = await confirm(
      'Удаление карты',
      'Вы уверены, что хотите удалить карту из профиля?'
    );
    if (isConfirmed) {
      try {
        const response = await deleteUserCard();
        onUpdateUser(response.data);
        showAlert('Карта успешно удалена.', 'success');
        onBack();
      } catch {
        showAlert('Не удалось удалить карту.', 'error');
      }
    }
  };

  const handleRequestCard = () => {
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Не указано';
    const phoneNumber = user.phone_number || 'Не указан';

    const message = teamsMode
      ? `Здравствуйте! Нужна привязка карты Teams Bonus.\nID Спасибо: ${user.id}\nИмя: ${userName}\nТелефон: ${phoneNumber}`
      : `Здравствуйте! Мне нужна карта Statix. Мои данные для выдачи:\n1. Имя Фамилия - ${userName}\n2. Номер телефона - ${phoneNumber}`;

    const encodedMessage = encodeURIComponent(message);
    const url = `${supportUrl}?text=${encodedMessage}`;

    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.pkpass')) {
      showAlert('Допускается только файл формата .pkpass', 'error');
      return;
    }

    setUploading(true);
    try {
      const response = await uploadPkpassFile(file);
      onUpdateUser(response.data);
      showAlert('Бонусная карта успешно добавлена!', 'success');
    } catch (error) {
      const msg = error.response?.data?.detail || 'Ошибка при загрузке файла';
      showAlert(msg, 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openTeamsCardUrl = () => {
    if (!teamsCard?.card_url) return;
    const url = teamsCard.card_url;
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const fallbackName = `${user.first_name || ''} ${user.last_name || ''}`.trim();

  if (teamsLoading) {
    return (
      <PageLayout title="Бонусная карта">
        <button type="button" onClick={onBack} className={styles.backButton}>
          &larr; Назад в профиль
        </button>
        <p className={styles.infoText}>
          <FaSpinner className={styles.spinIcon} /> Проверяем настройки Teams Bonus…
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Бонусная карта">
      <div className={teamsMode ? styles.pageTeams : undefined}>
        <button type="button" onClick={onBack} className={styles.backButton}>
          &larr; Назад в профиль
        </button>

        {teamsMode && teamsCard?.integration_error && !teamsCard?.linked && (
          <div className={styles.warnBox}>
            Не удалось загрузить карту Teams: {teamsCard.integration_error}
          </div>
        )}

        {teamsMode && teamsCard?.linked && (
          <div className={styles.cardContainer}>
            <TeamsBonusCard card={teamsCard} fallbackName={fallbackName} />
            {teamsCard.card_url && (
              <button type="button" onClick={openTeamsCardUrl} className={styles.openCardButton}>
                Открыть карту в Teams Bonus
              </button>
            )}
            <p className={styles.subText}>
              ID Спасибо для HR: <strong>{user.id}</strong>
            </p>
          </div>
        )}

        {teamsMode && !teamsCard?.linked && !teamsCard?.integration_error && (
          <div className={styles.cardContainer}>
            <p className={styles.infoText}>Карта Teams Bonus ещё не привязана.</p>
            <p className={styles.subText}>
              Передайте HR ваш ID Спасибо: <strong>{user.id}</strong>. После загрузки файла «Коннект»
              карта появится здесь автоматически.
            </p>
            <button type="button" onClick={handleRequestCard} className={styles.requestButton}>
              Написать в поддержку
            </button>
          </div>
        )}

        {!teamsMode && teamsCard?.integration_error === 'teams_not_configured' && user.card_barcode && (
          <p className={styles.hintBox}>
            Показана старая карта Statix: на сервере «Спасибо» не включена интеграция Teams (
            <code>TEAMS_BONUS_ENABLED</code>, URL и ключ). После настройки и перезапуска backend откроется
            карта Teams.
          </p>
        )}

        {!teamsMode && user.card_barcode && (
          <div className={styles.cardContainer}>
            <BonusCard user={user} />
            <button type="button" onClick={handleDelete} className={styles.deleteButton}>
              Удалить карту
            </button>
          </div>
        )}

        {!teamsMode && !user.card_barcode && (
          <div className={styles.cardContainer}>
            <p className={styles.infoText}>У вас пока нет бонусной карты.</p>

            <p className={styles.subText}>
              Загрузите файл <code>.pkpass</code> с вашей бонусной картой или запросите её у поддержки.
              {isTelegramWebApp && <> Также можно отправить файл боту в Telegram.</>}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pkpass"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={styles.uploadButton}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <FaSpinner className={styles.spinIcon} style={{ marginRight: '8px' }} /> Загрузка...
                </>
              ) : (
                <>
                  <FaUpload style={{ marginRight: '8px' }} /> Загрузить карту Statix
                </>
              )}
            </button>

            <button type="button" onClick={handleRequestCard} className={styles.requestButton}>
              Запросить карту
            </button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default BonusCardPage;
