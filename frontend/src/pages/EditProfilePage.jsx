// frontend/src/pages/EditProfilePage.jsx

import React, { useState } from 'react';
import { requestProfileUpdate } from '../api';
import styles from './RegistrationPage.module.css';
import PageLayout from '../components/PageLayout';

function EditProfilePage({ user, onBack, onSaveSuccess }) {
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [position, setPosition] = useState(user?.position || '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phone_number || '');
  const [email, setEmail] = useState(user?.email || '');

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!lastName || !department || !position) {
      setError('Фамилия, подразделение и должность обязательны.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const updatedData = {
        last_name: lastName,
        department,
        position,
        phone_number: phoneNumber || '',
        email: email || '',
      };

      await requestProfileUpdate(updatedData);
      onSaveSuccess();
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось отправить запрос. Попробуйте снова.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageLayout title="Редактирование профиля">
      <button type="button" onClick={onBack} className={styles.backButton}>&larr; Назад в профиль</button>
      <p className={styles.subtitle}>
        Ваши изменения будут отправлены на проверку администратору.
      </p>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ваша фамилия" className={styles.input} required />
        <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Ваше подразделение" className={styles.input} required />
        <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Ваша должность" className={styles.input} required />
        <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Номер телефона (необязательно)" className={styles.input} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (для покупок и поддержки)" className={styles.input} />

        <button type="submit" disabled={isLoading} className={styles.submitButton}>
          {isLoading ? 'Отправка...' : 'Отправить на согласование'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </PageLayout>
  );
}

export default EditProfilePage;
