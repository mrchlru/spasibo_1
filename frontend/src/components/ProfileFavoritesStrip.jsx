import { useCallback, useState } from 'react';
import {
  createSharedGiftInvitation,
  purchaseItem,
  purchaseLocalItem,
} from '../api';
import { useConfirmation } from '../contexts/ConfirmationContext';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useMarketFavorites } from '../hooks/useMarketFavorites';
import ColleagueSelector from './ColleagueSelector';
import LocalGiftModal from './LocalGiftModal';
import { MarketFavoriteButton } from './MarketFavoriteButton';
import ShopItemModal from './ShopItemModal';
import styles from './ProfilePurchasesStrip.module.css';

/** Показывает избранные товары магазина в профиле. */
export function ProfileFavoritesStrip({ user, onPurchaseSuccess }) {
  const [modalItem, setModalItem] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showColleagueSelector, setShowColleagueSelector] = useState(false);
  const [showLocalGiftModal, setShowLocalGiftModal] = useState(false);
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const {
    favoriteItems,
    loading,
    isFavorite,
    toggleFavorite,
  } = useMarketFavorites({ enabled: Boolean(user) });

  const items = favoriteItems.filter((item) => !item?.is_archived);

  const updateItemStock = useCallback((itemId) => {
    // Остаток обновляется локально в модалке; store перечитает при следующем hydrate.
    setModalItem((prev) => (
      prev && prev.id === itemId
        ? { ...prev, stock: Math.max(0, (prev.stock ?? 0) - 1) }
        : prev
    ));
  }, []);

  const handleToggleFavorite = useCallback(async (item) => {
    const wasFavorite = isFavorite(item.id);
    await toggleFavorite(item.id, item);
    if (wasFavorite && modalItem?.id === item.id) {
      setModalItem(null);
    }
  }, [toggleFavorite, modalItem?.id, isFavorite]);

  const handleSpecialPurchase = async (item, type) => {
    if (type === 'shared') {
      setSelectedItem(item);
      setShowColleagueSelector(true);
    } else if (type === 'local') {
      setSelectedItem(item);
      setShowLocalGiftModal(true);
    }
  };

  const handleModalPurchase = async (item) => {
    const isConfirmed = await confirm(
      `Вы уверены, что хотите купить "${item.name}" за ${item.price} спасибок?`
    );
    if (!isConfirmed) {
      throw new Error('Покупка отменена');
    }

    try {
      const response = await purchaseItem(user.telegram_id, item.id);
      const { new_balance, issued_code } = response.data;

      onPurchaseSuccess({ balance: new_balance });
      updateItemStock(item.id);

      return { issued_code };
    } catch (error) {
      const detail = error.response?.data?.detail;
      throw new Error(typeof detail === 'string' ? detail : 'Не удалось оформить покупку');
    }
  };

  const handleLocalGiftConfirm = async (city, websiteUrl) => {
    if (!selectedItem) {
      return;
    }

    const isConfirmed = await confirm(
      `Вы уверены, что хотите купить "${selectedItem.name}" за ${selectedItem.price} спасибок?\n\nГород: ${city}\nСсылка: ${websiteUrl}\n\nСпасибки будут зарезервированы до решения администратора.`
    );

    if (!isConfirmed) {
      return;
    }

    try {
      const response = await purchaseLocalItem(
        user.telegram_id,
        selectedItem.id,
        city,
        websiteUrl
      );
      const { new_balance, reserved_balance } = response.data;

      onPurchaseSuccess({ balance: new_balance, reserved_balance });
      setShowLocalGiftModal(false);
      setSelectedItem(null);

      showAlert(
        `Заявка на локальный подарок создана! Зарезервировано ${reserved_balance} спасибок. Ожидайте решения администратора.`,
        'success'
      );
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Произошла ошибка при создании заявки.', 'error');
    }
  };

  const handleColleagueSelect = async (colleague) => {
    if (!selectedItem) {
      return;
    }

    const isConfirmed = await confirm(
      `Вы уверены, что хотите пригласить ${colleague.first_name} ${colleague.last_name} разделить "${selectedItem.name}" за ${selectedItem.price} спасибок?`
    );

    if (isConfirmed) {
      try {
        await createSharedGiftInvitation({
          buyer_id: user.id,
          invited_user_id: colleague.id,
          item_id: selectedItem.id,
        });

        showAlert(
          `Приглашение отправлено ${colleague.first_name} ${colleague.last_name}!`,
          'success'
        );
      } catch (error) {
        showAlert(error.response?.data?.detail || 'Ошибка при отправке приглашения.', 'error');
      }
    }

    setShowColleagueSelector(false);
    setSelectedItem(null);
  };

  if (loading && items.length === 0) {
    return (
      <section className={styles.block} aria-label="Избранные товары">
        <h2 className={styles.sectionTitle}>Избранные товары</h2>
        <div className={styles.skeleton} />
      </section>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.block} aria-label="Избранные товары">
      <h2 className={styles.sectionTitle}>Избранные товары</h2>
      <div className={styles.scroller}>
        {items.map((item) => (
          <article key={item.id} className={styles.cardArticle}>
            <div className={styles.cardSurface}>
              <button
                type="button"
                className={styles.cardOpenBtn}
                onClick={() => setModalItem(item)}
              >
                <div className={styles.imageWrap}>
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className={styles.image} loading="lazy" />
                  ) : (
                    <span className={styles.imageFallback} aria-hidden="true" />
                  )}
                </div>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.price}>{item.price} спасибок</span>
              </button>
              <div className={styles.favoriteSlot}>
                <MarketFavoriteButton
                  active={isFavorite(item.id)}
                  onToggle={() => void handleToggleFavorite(item)}
                />
              </div>
            </div>
          </article>
        ))}
      </div>

      <ShopItemModal
        item={modalItem}
        user={user}
        isOpen={modalItem !== null}
        onClose={() => setModalItem(null)}
        onPurchase={handleModalPurchase}
        onSpecialPurchase={handleSpecialPurchase}
      />

      <ColleagueSelector
        isOpen={showColleagueSelector}
        onClose={() => {
          setShowColleagueSelector(false);
          setSelectedItem(null);
        }}
        onSelect={handleColleagueSelect}
        currentUserId={user?.id}
      />

      <LocalGiftModal
        isOpen={showLocalGiftModal}
        onClose={() => {
          setShowLocalGiftModal(false);
          setSelectedItem(null);
        }}
        item={selectedItem}
        onConfirm={handleLocalGiftConfirm}
      />
    </section>
  );
}
