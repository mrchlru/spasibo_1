// frontend/src/pages/SettingsPage.jsx

import React, { useState, useEffect } from 'react';
import styles from './SettingsPage.module.css';
import { FaQuestionCircle, FaHeadset, FaFileContract, FaBookOpen, FaLock, FaSignOutAlt, FaBell } from 'react-icons/fa';
import PageLayout from '../components/PageLayout';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useConfirmation } from '../contexts/ConfirmationContext';
import { changePassword, sendTestPush } from '../api';
import { FaEye, FaEyeSlash, FaPaperPlane } from 'react-icons/fa';
import {
  enablePushFromUserGesture,
  getNotificationPermission,
  hasBrowserPushSubscription,
  startNotificationPermissionRequest,
} from '../pwa/pushNotifications.js';
import {
  getPushBlockReason,
  isPushApiAvailable,
  pushBlockReasonMessage,
} from '../pwa/pushEnvironment.js';

// Определяем, является ли это браузером (не Telegram WebApp)
const isWebBrowser = !window.Telegram?.WebApp;

function SettingsPage({ onBack, onNavigate, onRepeatOnboarding, user }) {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [testPushLoading, setTestPushLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPushState() {
      if (!isPushApiAvailable()) {
        return;
      }
      const subscribed = await hasBrowserPushSubscription();
      if (!cancelled) {
        setPushEnabled(subscribed || getNotificationPermission() === 'granted');
      }
    }
    loadPushState();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnablePush = async () => {
    const blockReason = getPushBlockReason();
    if (blockReason) {
      showAlert(pushBlockReasonMessage(blockReason), 'error');
      return;
    }

    setPushLoading(true);
    try {
      const permissionPromise = startNotificationPermissionRequest();
      const result = await enablePushFromUserGesture(permissionPromise);
      if (result.ok) {
        setPushEnabled(true);
        showAlert('Push-уведомления включены', 'success');
      } else {
        showAlert(pushBlockReasonMessage(result.reason), 'error');
      }
    } finally {
      setPushLoading(false);
    }
  };

  const handleTestPush = async () => {
    if (!pushEnabled) {
      showAlert('Сначала включите push-уведомления', 'error');
      return;
    }

    setTestPushLoading(true);
    try {
      const { data } = await sendTestPush({
        title: 'Тест «Спасибо»',
        body: 'Push-канал работает',
        url: '/',
      });
      const delivered = data?.delivered ?? 0;
      if (delivered > 0) {
        showAlert('Тестовое уведомление отправлено', 'success');
      } else {
        showAlert(
          'Сервер не доставил push. Проверьте подписку и VAPID-ключи на сервере.',
          'error',
        );
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      showAlert(
        typeof detail === 'string' ? detail : 'Не удалось отправить тестовое уведомление',
        'error',
      );
    } finally {
      setTestPushLoading(false);
    }
  };

  // Ссылка на ваш аккаунт поддержки в Telegram
  const supportUrl = 'https://t.me/fix2Form'; // <-- НЕ ЗАБУДЬТЕ ЗАМЕНИТЬ НА ВАШ АККАУНТ

  const handleLogout = async () => {
    const isConfirmed = await confirm(
      'Выход из аккаунта',
      'Вы уверены, что хотите выйти из аккаунта?'
    );
    
    if (isConfirmed) {
      localStorage.removeItem('userId');
      localStorage.removeItem('user');
      window.location.reload();
    }
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      showAlert('Пожалуйста, заполните все поля', 'error');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      showAlert('Новый пароль и подтверждение не совпадают', 'error');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      showAlert('Пароль должен содержать минимум 6 символов', 'error');
      return;
    }

    setIsLoading(true);
    try {
      await changePassword(passwordData.currentPassword, passwordData.newPassword);
      showAlert('Пароль успешно изменен', 'success');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setShowChangePassword(false);
    } catch (err) {
      const errorMessage = err.response?.data?.detail || 'Не удалось изменить пароль';
      showAlert(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageLayout title="Настройки">
      <button onClick={onBack} className={styles.backButton}>
        &larr; Назад в профиль
      </button>

      <div className={styles.settingsList}>
        <button onClick={onRepeatOnboarding} className={styles.settingsItem}>
          <FaBookOpen className={styles.icon} />
          <span>Пройти обучение повторно</span>
        </button>
        
        <button onClick={() => onNavigate('faq')} className={styles.settingsItem}>
          <FaQuestionCircle className={styles.icon} />
          <span>Часто задаваемые вопросы (FAQ)</span>
        </button>

        {isPushApiAvailable() && (
          <button
            type="button"
            onClick={handleEnablePush}
            disabled={pushLoading || pushEnabled}
            className={styles.settingsItem}
          >
            <FaBell className={styles.icon} />
            <span>
              {pushEnabled ? 'Push-уведомления включены' : 'Включить push-уведомления'}
            </span>
          </button>
        )}

        {isPushApiAvailable() && pushEnabled && (
          <button
            type="button"
            onClick={handleTestPush}
            disabled={testPushLoading}
            className={styles.settingsItem}
          >
            <FaPaperPlane className={styles.icon} />
            <span>{testPushLoading ? 'Отправка…' : 'Тестовое push-уведомление'}</span>
          </button>
        )}

        <a href={supportUrl} target="_blank" rel="noopener noreferrer" className={styles.settingsItem}>
          <FaHeadset className={styles.icon} />
          <span>Поддержка</span>
        </a>

        {user && user.login && (
          <button onClick={() => setShowChangePassword(true)} className={styles.settingsItem}>
            <FaLock className={styles.icon} />
            <span>Изменить пароль</span>
          </button>
        )}

        {/* Кнопка выхода показывается только в браузере или для пользователей с браузерной авторизацией */}
        {(isWebBrowser || (user && user.login)) && (
          <button onClick={handleLogout} className={styles.settingsItem}>
            <FaSignOutAlt className={styles.icon} />
            <span>Выйти из аккаунта</span>
          </button>
        )}

        <div className={styles.settingsItemDisabled}>
          <FaFileContract className={styles.icon} />
          <span>Юридическая документация</span>
        </div>
      </div>

      {showChangePassword && (
        <div className={styles.passwordModal}>
          <div className={styles.passwordModalContent}>
            <h2>Изменение пароля</h2>
            <form onSubmit={handlePasswordSubmit}>
              <div className={styles.passwordInputContainer}>
                <input
                  name="currentPassword"
                  type={showPasswords.current ? "text" : "password"}
                  value={passwordData.currentPassword}
                  onChange={handlePasswordChange}
                  placeholder="Текущий пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                >
                  {showPasswords.current ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div className={styles.passwordInputContainer}>
                <input
                  name="newPassword"
                  type={showPasswords.new ? "text" : "password"}
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  placeholder="Новый пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                >
                  {showPasswords.new ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div className={styles.passwordInputContainer}>
                <input
                  name="confirmPassword"
                  type={showPasswords.confirm ? "text" : "password"}
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  placeholder="Подтвердите новый пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                >
                  {showPasswords.confirm ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div className={styles.passwordModalButtons}>
                <button type="submit" disabled={isLoading} className={styles.submitButton}>
                  {isLoading ? 'Изменение...' : 'Изменить пароль'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePassword(false);
                    setPasswordData({
                      currentPassword: '',
                      newPassword: '',
                      confirmPassword: ''
                    });
                  }}
                  className={styles.cancelButton}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default SettingsPage;
