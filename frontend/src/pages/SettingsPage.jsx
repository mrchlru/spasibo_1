// frontend/src/pages/SettingsPage.jsx

import React, { useState, useEffect, useCallback } from 'react';
import styles from './SettingsPage.module.css';
import { FaQuestionCircle, FaHeadset, FaFileContract, FaBookOpen, FaLock, FaSignOutAlt, FaBell, FaPaperPlane } from 'react-icons/fa';
import PageLayout from '../components/PageLayout';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useConfirmation } from '../contexts/ConfirmationContext';
import { changePassword } from '../api';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import {
  arePushSettingsAvailable,
  disablePushForUser,
  enablePushWithTestPush,
  formatPushEnableError,
  isPushEnabledForUser,
  isIosInstallRequiredForPush,
  sendWelcomeTestPush,
} from '../pwa/pushUserControls.js';
import { isSpasiboAndroidApp } from '../pwa/androidNativePush.js';

const isWebBrowser = !window.Telegram?.WebApp;

function SettingsPage({ onBack, onNavigate, onRepeatOnboarding, user }) {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [testPushLoading, setTestPushLoading] = useState(false);

  const isAndroidApp = isSpasiboAndroidApp();
  const pushControlsAvailable = arePushSettingsAvailable();
  const iosInstallRequired = isIosInstallRequiredForPush();

  const loadPushState = useCallback(async () => {
    if (!pushControlsAvailable || iosInstallRequired) {
      setPushEnabled(false);
      return;
    }
    const enabled = await isPushEnabledForUser();
    setPushEnabled(enabled);
  }, [iosInstallRequired, pushControlsAvailable]);

  useEffect(() => {
    void loadPushState();
  }, [loadPushState]);

  useEffect(() => {
    const onPermissionChange = () => {
      void loadPushState();
    };
    window.addEventListener('spasibo:notification-permission', onPermissionChange);
    return () => {
      window.removeEventListener('spasibo:notification-permission', onPermissionChange);
    };
  }, [loadPushState]);

  const handlePushToggle = async () => {
    if (pushLoading) {
      return;
    }

    if (iosInstallRequired) {
      showAlert('Добавьте приложение на экран iPhone через «Поделиться → На экран Домой», затем включите уведомления.', 'error');
      return;
    }

    setPushLoading(true);
    try {
      if (pushEnabled) {
        const result = await disablePushForUser();
        if (result.ok) {
          setPushEnabled(false);
          showAlert('Push-уведомления отключены', 'success');
        } else {
          showAlert('Не удалось отключить уведомления', 'error');
        }
        return;
      }

      const result = await enablePushWithTestPush();
      if (result.ok) {
        setPushEnabled(true);
        showAlert(
          result.detail || 'Уведомления включены! Вы молодец — тестовое сообщение уже отправлено.',
          'success',
        );
        return;
      }

      if (isAndroidApp && result.reason === 'fcm_token_missing') {
        window.SpasiboAndroid?.showNativeToast?.(formatPushEnableError(result));
      } else if (isAndroidApp && result.reason !== 'permission_dismissed') {
        window.SpasiboAndroid?.openAppNotificationSettings?.();
      }
      showAlert(formatPushEnableError(result), 'error');
    } finally {
      setPushLoading(false);
      void loadPushState();
    }
  };

  const handleTestPush = async () => {
    if (!pushEnabled) {
      showAlert('Сначала включите push-уведомления', 'error');
      return;
    }

    setTestPushLoading(true);
    try {
      const result = await sendWelcomeTestPush();
      if (result.sent) {
        showAlert('Тестовое уведомление отправлено', 'success');
      } else {
        showAlert('Сервер не смог доставить push. Попробуйте ещё раз через пару секунд.', 'error');
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      showAlert(
        typeof detail === 'string' ? detail : 'Не удалось отправить тестовое уведомление',
        'error',
      );
    } finally {
      setTestPushLoading(false);
      void loadPushState();
    }
  };

  const supportUrl = 'https://t.me/fix2Form';

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
    setPasswordData((prev) => ({ ...prev, [name]: value }));
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
        confirmPassword: '',
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

        {pushControlsAvailable && (
          <div className={styles.settingsItem}>
            <FaBell className={styles.icon} />
            <div className={styles.pushRow}>
              <div className={styles.pushRowText}>
                <span className={styles.pushRowTitle}>Push-уведомления</span>
                <span className={styles.pushRowHint}>
                  {iosInstallRequired
                    ? 'Сначала добавьте приложение на экран iPhone'
                    : pushEnabled
                      ? 'Уведомления включены'
                      : 'Получайте спасибки и новости на телефон'}
                </span>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  disabled={pushLoading || iosInstallRequired}
                  onChange={() => void handlePushToggle()}
                />
                <span className={styles.toggleSlider} aria-hidden="true" />
              </label>
            </div>
          </div>
        )}

        {pushControlsAvailable && pushEnabled && !iosInstallRequired && (
          <button
            type="button"
            onClick={handleTestPush}
            disabled={testPushLoading || pushLoading}
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
                  type={showPasswords.current ? 'text' : 'password'}
                  value={passwordData.currentPassword}
                  onChange={handlePasswordChange}
                  placeholder="Текущий пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords((prev) => ({ ...prev, current: !prev.current }))}
                >
                  {showPasswords.current ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div className={styles.passwordInputContainer}>
                <input
                  name="newPassword"
                  type={showPasswords.new ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  placeholder="Новый пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords((prev) => ({ ...prev, new: !prev.new }))}
                >
                  {showPasswords.new ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div className={styles.passwordInputContainer}>
                <input
                  name="confirmPassword"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  placeholder="Подтвердите новый пароль"
                  className={styles.input}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPasswords((prev) => ({ ...prev, confirm: !prev.confirm }))}
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
                      confirmPassword: '',
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
