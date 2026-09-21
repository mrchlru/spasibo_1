// frontend/src/pages/RegistrationPage.jsx

import React, { useEffect, useMemo, useState } from 'react';
import InputMask from 'react-input-mask';
import {
  confirmAccountRecovery,
  getAppSettings,
  registerUser,
  sendAccountRecoveryCode,
} from '../api';
import styles from './RegistrationPage.module.css';
import PageLayout from '../components/PageLayout';
import { useModalAlert } from '../contexts/ModalAlertContext';

import { formatDateForApi } from '../utils/dateFormatter';
import {
  captureReferralCodeFromLocation,
  clearPendingReferralCode,
  getPendingReferralCode,
  isReferralWithinSchedule,
  normalizeReferral,
  storePendingReferralCode,
} from '../pwa/referralCampaign.js';

/**
 * Достаёт payload existing_account_match из ответа axios/FastAPI.
 *
 * @param {unknown} err
 * @returns {object | null}
 */
function extractExistingMatch(err) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && detail.code === 'existing_account_match') {
    return detail;
  }
  return null;
}

/**
 * Достаёт текст ошибки восстановления.
 *
 * @param {unknown} err
 * @returns {string}
 */
function extractRecoveryError(err) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && detail.message) {
    return String(detail.message);
  }
  if (typeof detail === 'string') {
    return detail;
  }
  return 'Не удалось выполнить восстановление.';
}

function RegistrationPage({ telegramUser, onRegistrationSuccess, isWebBrowser = false, onBackToLogin }) {
  const { showAlert } = useModalAlert();
  const [formData, setFormData] = useState({
    firstName: telegramUser?.first_name || '',
    lastName: '',
    department: '',
    position: '',
    phoneNumber: '',
    dateOfBirth: '',
    email: '',
    referralCode: '',
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [campaignActive, setCampaignActive] = useState(false);
  const [matchInfo, setMatchInfo] = useState(null);
  const [recoveryStep, setRecoveryStep] = useState('idle');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    captureReferralCodeFromLocation();
    const pending = getPendingReferralCode();
    if (pending) {
      setFormData((prev) => ({ ...prev, referralCode: pending }));
    }
    let cancelled = false;
    void getAppSettings()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const campaign = normalizeReferral(response?.data?.referral);
        setCampaignActive(isReferralWithinSchedule(campaign));
      })
      .catch(() => {
        if (!cancelled) {
          setCampaignActive(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showReferralField = campaignActive;

  const matchTitle = useMemo(() => {
    if (!matchInfo) {
      return '';
    }
    const name = `${matchInfo.first_name || ''} ${matchInfo.last_name || ''}`.trim();
    return name || 'существующий аккаунт';
  }, [matchInfo]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'referralCode') {
      const next = String(value || '').toUpperCase();
      setFormData((prev) => ({ ...prev, referralCode: next }));
      if (next.trim()) {
        storePendingReferralCode(next);
      }
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'Имя обязательно';
    if (!formData.lastName.trim()) newErrors.lastName = 'Фамилия обязательна';
    if (!formData.department.trim()) newErrors.department = 'Подразделение обязательно';
    if (!formData.position.trim()) newErrors.position = 'Должность обязательна';
    if (formData.phoneNumber.includes('_')) newErrors.phoneNumber = 'Введите телефон полностью';
    if (formData.dateOfBirth.includes('_')) newErrors.dateOfBirth = 'Введите дату полностью';

    if (isWebBrowser) {
      if (!formData.email.trim()) {
        newErrors.email = 'Email обязателен';
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email.trim())) {
          newErrors.email = 'Введите корректный email';
        }
      }
    } else if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        newErrors.email = 'Введите корректный email';
      }
    }

    const formattedDate = formatDateForApi(formData.dateOfBirth);
    if (!formattedDate && !formData.dateOfBirth.includes('_')) {
      newErrors.dateOfBirth = 'Неверный формат даты';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const openManualRecoveryMailto = () => {
    const subject = encodeURIComponent('Восстановление логина и пароля в Спасибо');
    const body = encodeURIComponent(
      `ФИО: ${formData.firstName} ${formData.lastName}\n` +
        `Номер телефона: ${formData.phoneNumber}\n` +
        `Подразделение: ${formData.department}\n` +
        `Должность: ${formData.position}\n` +
        `Email: ${formData.email || 'не указан'}`
    );
    window.location.href = `mailto:masovroma@gmail.com?subject=${subject}&body=${body}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      showAlert('Пожалуйста, заполните все обязательные поля корректно.', 'error');
      return;
    }

    setIsLoading(true);
    setMatchInfo(null);
    setRecoveryStep('idle');

    try {
      const apiDate = formatDateForApi(formData.dateOfBirth);
      const telegramId = isWebBrowser ? null : telegramUser?.id;
      const referralFromField = showReferralField
        ? (formData.referralCode || '').trim().toUpperCase()
        : '';
      const referralCode = referralFromField || getPendingReferralCode() || null;
      if (referralCode) {
        storePendingReferralCode(referralCode);
      }

      const userData = {
        telegram_id: telegramId ? String(telegramId) : null,
        first_name: formData.firstName,
        last_name: formData.lastName,
        department: formData.department,
        position: formData.position,
        username: telegramUser?.username || null,
        telegram_photo_url: telegramUser?.photo_url || null,
        phone_number: formData.phoneNumber,
        date_of_birth: apiDate,
        email: formData.email.trim() || null,
        referral_code: referralCode,
      };

      await registerUser(telegramId || '', userData);
      clearPendingReferralCode();
      showAlert('Ваша заявка отправлена на рассмотрение!', 'success');

      setTimeout(() => {
        onRegistrationSuccess();
      }, 1500);
    } catch (err) {
      const match = extractExistingMatch(err);
      if (match) {
        setMatchInfo(match);
        setRecoveryStep(match.has_email ? 'offer' : 'manual');
        showAlert(match.message || 'Найден существующий аккаунт.', 'success');
      } else {
        showAlert(err.response?.data?.detail || 'Не удалось отправить заявку.', 'error');
        console.error(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendRecoveryCode = async () => {
    if (!matchInfo?.recovery_token) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await sendAccountRecoveryCode(matchInfo.recovery_token);
      setRecoveryStep('code');
      showAlert(response?.data?.message || 'Код отправлен на почту.', 'success');
    } catch (err) {
      const code = err?.response?.data?.detail?.code;
      if (code === 'no_email') {
        setRecoveryStep('manual');
      }
      showAlert(extractRecoveryError(err), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmRecovery = async (e) => {
    e.preventDefault();
    if (!matchInfo?.recovery_token) {
      return;
    }
    if (!recoveryCode.trim()) {
      showAlert('Введите код из письма.', 'error');
      return;
    }
    if (newPassword.trim().length < 6) {
      showAlert('Пароль должен быть не короче 6 символов.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Пароли не совпадают.', 'error');
      return;
    }
    setIsLoading(true);
    try {
      const response = await confirmAccountRecovery(
        matchInfo.recovery_token,
        recoveryCode.trim(),
        newPassword.trim(),
      );
      showAlert(response?.data?.message || 'Пароль обновлён.', 'success');
      setTimeout(() => {
        if (onBackToLogin) {
          onBackToLogin();
        } else {
          onRegistrationSuccess();
        }
      }, 1200);
    } catch (err) {
      showAlert(extractRecoveryError(err), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const referralField = showReferralField ? (
    <>
      <input
        name="referralCode"
        type="text"
        value={formData.referralCode}
        onChange={handleChange}
        placeholder="Реферальный код (если есть)"
        className={styles.input}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <p className={styles.hint}>
        Если вы перешли по пригласительной ссылке, код подставится сам. Можно ввести вручную.
      </p>
    </>
  ) : null;

  const recoveryPanel = matchInfo ? (
    <div className={styles.recoveryPanel}>
      <h3 className={styles.recoveryTitle}>Аккаунт уже есть</h3>
      <p className={styles.recoveryText}>
        Нашли профиль: <strong>{matchTitle}</strong>
        {matchInfo.has_email && matchInfo.email ? (
          <>
            <br />
            Email: <strong>{matchInfo.email}</strong>
          </>
        ) : null}
      </p>

      {recoveryStep === 'offer' && (
        <button
          type="button"
          className={styles.submitButton}
          disabled={isLoading}
          onClick={handleSendRecoveryCode}
        >
          {isLoading ? 'Отправка…' : 'Восстановить доступ'}
        </button>
      )}

      {recoveryStep === 'manual' && (
        <>
          <p className={styles.recoveryText}>
            У аккаунта нет email в системе — отправьте запрос администратору, как раньше.
          </p>
          <button type="button" className={styles.submitButton} onClick={openManualRecoveryMailto}>
            Написать администратору
          </button>
        </>
      )}

      {recoveryStep === 'code' && (
        <form onSubmit={handleConfirmRecovery} className={styles.form}>
          <input
            type="text"
            inputMode="numeric"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="Код из письма"
            className={styles.input}
            autoComplete="one-time-code"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль"
            className={styles.input}
            autoComplete="new-password"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Повторите пароль"
            className={styles.input}
            autoComplete="new-password"
          />
          <button type="submit" disabled={isLoading} className={styles.submitButton}>
            {isLoading ? 'Сохранение…' : 'Сохранить пароль'}
          </button>
          <button
            type="button"
            className={styles.linkButton}
            disabled={isLoading}
            onClick={handleSendRecoveryCode}
          >
            Отправить код ещё раз
          </button>
        </form>
      )}
    </div>
  ) : null;

  if (isWebBrowser) {
    return (
      <div className={styles.page}>
        <div className={styles.registrationContainer}>
          {onBackToLogin && (
            <button onClick={onBackToLogin} className={styles.backButton}>
              &larr; Назад к входу
            </button>
          )}
          <p className={styles.subtitle}>
            Для регистрации в приложении укажите информацию. После отправки заявка уйдёт на рассмотрение.
          </p>
          {recoveryPanel}
          {!matchInfo && (
            <form onSubmit={handleSubmit} className={styles.form}>
              <input name="firstName" type="text" value={formData.firstName} onChange={handleChange} placeholder="Ваше имя" className={styles.input} />
              {errors.firstName && <p className={styles.error}>{errors.firstName}</p>}

              <input name="lastName" type="text" value={formData.lastName} onChange={handleChange} placeholder="Ваша фамилия" className={styles.input} />
              {errors.lastName && <p className={styles.error}>{errors.lastName}</p>}

              <input name="department" type="text" value={formData.department} onChange={handleChange} placeholder="Ваше подразделение" className={styles.input} />
              {errors.department && <p className={styles.error}>{errors.department}</p>}

              <input name="position" type="text" value={formData.position} onChange={handleChange} placeholder="Ваша должность" className={styles.input} />
              {errors.position && <p className={styles.error}>{errors.position}</p>}

              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Email"
                className={styles.input}
              />
              {errors.email && <p className={styles.error}>{errors.email}</p>}

              <InputMask
                mask="+7 (999) 999-99-99"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                className={styles.input}
              >
                {(inputProps) => <input {...inputProps} type="tel" placeholder="Номер телефона" />}
              </InputMask>
              {errors.phoneNumber && <p className={styles.error}>{errors.phoneNumber}</p>}

              <InputMask
                mask="99.99.9999"
                name="dateOfBirth"
                value={formData.dateOfBirth}
                onChange={handleChange}
                className={styles.input}
              >
                {(inputProps) => <input {...inputProps} type="text" placeholder="Дата рождения (ДД.ММ.ГГГГ)" />}
              </InputMask>
              {errors.dateOfBirth && <p className={styles.error}>{errors.dateOfBirth}</p>}

              {referralField}

              <button type="submit" disabled={isLoading} className={styles.submitButton}>
                {isLoading ? 'Отправка...' : 'Отправить на рассмотрение'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <PageLayout title="Регистрация">
      <div className={styles.subtitle}>
        <p>{`Привет, ${telegramUser?.first_name || 'пользователь'}! Для завершения настройки укажите информацию.`}</p>
        {onBackToLogin && (
          <p style={{ marginTop: '10px', fontSize: '0.9em' }}>
            Уже есть аккаунт (регистрировались через веб)?{' '}
            <button type="button" onClick={onBackToLogin} className={styles.linkButton}>
              Войти
            </button>
          </p>
        )}
      </div>
      {recoveryPanel}
      {!matchInfo && (
        <form onSubmit={handleSubmit} className={styles.form}>
          <input name="firstName" type="text" value={formData.firstName} onChange={handleChange} placeholder="Ваше имя" className={styles.input} />
          {errors.firstName && <p className={styles.error}>{errors.firstName}</p>}

          <input name="lastName" type="text" value={formData.lastName} onChange={handleChange} placeholder="Ваша фамилия" className={styles.input} />
          {errors.lastName && <p className={styles.error}>{errors.lastName}</p>}

          <input name="department" type="text" value={formData.department} onChange={handleChange} placeholder="Ваше подразделение" className={styles.input} />
          {errors.department && <p className={styles.error}>{errors.department}</p>}

          <input name="position" type="text" value={formData.position} onChange={handleChange} placeholder="Ваша должность" className={styles.input} />
          {errors.position && <p className={styles.error}>{errors.position}</p>}

          <input
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Email (необязательно)"
            className={styles.input}
          />
          {errors.email && <p className={styles.error}>{errors.email}</p>}

          <InputMask
            mask="+7 (999) 999-99-99"
            name="phoneNumber"
            value={formData.phoneNumber}
            onChange={handleChange}
            className={styles.input}
          >
            {(inputProps) => <input {...inputProps} type="tel" placeholder="Номер телефона" />}
          </InputMask>
          {errors.phoneNumber && <p className={styles.error}>{errors.phoneNumber}</p>}

          <InputMask
            mask="99.99.9999"
            name="dateOfBirth"
            value={formData.dateOfBirth}
            onChange={handleChange}
            className={styles.input}
          >
            {(inputProps) => <input {...inputProps} type="text" placeholder="Дата рождения (ДД.ММ.ГГГГ)" />}
          </InputMask>
          {errors.dateOfBirth && <p className={styles.error}>{errors.dateOfBirth}</p>}

          {referralField}

          <button type="submit" disabled={isLoading} className={styles.submitButton}>
            {isLoading ? 'Отправка...' : 'Отправить на рассмотрение'}
          </button>
        </form>
      )}
    </PageLayout>
  );
}

export default RegistrationPage;
