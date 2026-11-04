import React, { useState, useEffect } from 'react';
import { purchaseStatixBonus, getStatixBonusItem, getTeamsBonusCard } from '../api';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useConfirmation } from '../contexts/ConfirmationContext';
import styles from './StatixBonusCard.module.css';

function StatixBonusCard({ user, onPurchaseSuccess }) {
  const [statixItem, setStatixItem] = useState(null);
  const [bonusAmount, setBonusAmount] = useState(100);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [teamsCard, setTeamsCard] = useState(null);
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();

  useEffect(() => {
    getTeamsBonusCard()
      .then((response) => setTeamsCard(response.data))
      .catch(() => setTeamsCard({ integration_enabled: false, linked: false }));
  }, [user?.id]);

  useEffect(() => {
    const fetchStatixItem = async () => {
      try {
        const response = await getStatixBonusItem();
        // Нет данных / неактивен — блок просто не показываем, без уведомлений
        if (!response.data || response.status === 204 || !response.data.is_active) {
          setStatixItem(null);
          return;
        }
        setStatixItem(response.data);
        setBonusAmount(response.data.min_bonus_per_step);
      } catch (error) {
        // Отключён, 500 от старого бага 204+GZip, сеть — всегда тихо скрываем карточку
        setStatixItem(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStatixItem();
  }, []);

  const handleSliderChange = (event) => {
    const value = parseInt(event.target.value);
    setBonusAmount(value);
  };

  const calculateThanksCost = () => {
    if (!statixItem) return 0;
    return Math.round((bonusAmount / 100) * statixItem.thanks_to_statix_rate);
  };

  const teamsMode = Boolean(teamsCard?.integration_enabled);
  const bonusProductLabel = teamsMode ? 'Teams Bonus' : 'Statix';

  const handlePurchase = async () => {
    if (!statixItem) return;
    
    const thanksCost = calculateThanksCost();
    const isConfirmed = await confirm(
      `Вы уверены, что хотите купить ${bonusAmount} бонусов ${bonusProductLabel} за ${thanksCost} спасибок?`
    );
    
    if (isConfirmed) {
      setIsPurchasing(true);
      try {
        const response = await purchaseStatixBonus(bonusAmount);
        const { new_balance, purchased_bonus_amount } = response.data;
        
        onPurchaseSuccess({ balance: new_balance });
        
        showAlert(
          `Успешно приобретено ${purchased_bonus_amount} бонусов ${bonusProductLabel}!`,
          'success'
        );
        
        // Сбрасываем ползунок к минимальному значению
        setBonusAmount(statixItem.min_bonus_per_step);
        
      } catch (error) {
        console.error("Statix Bonus purchase failed:", error);
        showAlert(error.response?.data?.detail || "Произошла ошибка при покупке бонусов.", 'error');
      } finally {
        setIsPurchasing(false);
      }
    }
  };

  // Пока грузим или товар выключен — ничего не показываем и не алертим
  if (isLoading || !statixItem || !statixItem.is_active) {
    return null;
  }

  const thanksCost = calculateThanksCost();
  const canAfford = user?.balance >= thanksCost;
  const teamsReady = teamsCard !== null;
  const hasCard = teamsMode
    ? teamsReady && teamsCard.linked
    : Boolean(user?.card_barcode);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>{statixItem.name}</h2>
        <p className={styles.description}>{statixItem.description}</p>
      </div>

      {statixItem.image_url && (
        <div className={styles.imageContainer}>
          <img 
            src={statixItem.image_url} 
            alt={statixItem.name} 
            className={styles.image}
            loading="lazy"
          />
        </div>
      )}

      {teamsMode && !teamsReady && (
        <div className={styles.noCardWarning}>Проверяем привязку карты Teams…</div>
      )}

      {((teamsMode && teamsReady && !hasCard) || (!teamsMode && !hasCard)) && (
        <div className={styles.noCardWarning}>
          {teamsMode
            ? `⚠️ Привяжите карту Teams Bonus (ID Спасибо: ${user?.id}) через HR`
            : '⚠️ Для покупки бонусов необходимо добавить карту Statix в профиль'}
        </div>
      )}

      <div className={styles.bonusSelector}>
        <div className={styles.amountDisplay}>
          <span className={styles.bonusAmount}>{bonusAmount}</span>
          <span className={styles.bonusLabel}>бонусов {bonusProductLabel}</span>
        </div>
        
        <div className={styles.sliderContainer}>
          <input
            type="range"
            min={statixItem.min_bonus_per_step}
            max={statixItem.max_bonus_per_step}
            step={statixItem.bonus_step}
            value={bonusAmount}
            onChange={handleSliderChange}
            className={styles.slider}
            disabled={isPurchasing}
          />
          <div className={styles.sliderLabels}>
            <span>{statixItem.min_bonus_per_step}</span>
            <span>{statixItem.max_bonus_per_step}</span>
          </div>
        </div>
      </div>

      <div className={styles.priceInfo}>
        <div className={styles.priceRow}>
          <span>Стоимость:</span>
          <span className={styles.price}>{thanksCost} спасибок</span>
        </div>
        <div className={styles.rateInfo}>
          Курс: {statixItem.thanks_to_statix_rate} спасибок за 100 бонусов
        </div>
      </div>

      <button
        onClick={handlePurchase}
        disabled={!canAfford || !hasCard || isPurchasing}
        className={`${styles.purchaseButton} ${(!canAfford || !hasCard) ? styles.disabled : ''}`}
      >
        {isPurchasing ? 'Покупка...' : 'Купить бонусы'}
      </button>

      {!canAfford && (
        <div className={styles.insufficientFunds}>
          Недостаточно спасибок для покупки
        </div>
      )}
    </div>
  );
}

export default StatixBonusCard;