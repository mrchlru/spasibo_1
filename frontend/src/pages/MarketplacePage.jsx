// frontend/src/pages/MarketplacePage.jsx

import React, { useState, useEffect } from 'react';
import { getMarketItems, purchaseItem, purchaseLocalItem, createSharedGiftInvitation } from '../api';
import { getCachedData, setCachedData } from '../storage';
import { useModalAlert } from '../contexts/ModalAlertContext';
import { useConfirmation } from '../contexts/ConfirmationContext';
import PageLayout from '../components/PageLayout';
import StatixBonusCard from '../components/StatixBonusCard';
import ColleagueSelector from '../components/ColleagueSelector';
import LocalGiftModal from '../components/LocalGiftModal';
import ShopItemModal from '../components/ShopItemModal';
import { MarketFavoriteButton } from '../components/MarketFavoriteButton';
import { useMarketFavorites } from '../hooks/useMarketFavorites';
import styles from './MarketplacePage.module.css';
import { FaStar, FaUsers } from 'react-icons/fa';

function MarketplacePage({ user, onPurchaseSuccess }) {
  const cachedItems = getCachedData('market');
  const hasCachedItems = Array.isArray(cachedItems) && cachedItems.length > 0;
  const [items, setItems] = useState(hasCachedItems ? cachedItems : []);
  const [isLoading, setIsLoading] = useState(!hasCachedItems);
  const [showColleagueSelector, setShowColleagueSelector] = useState(false);
  const [showLocalGiftModal, setShowLocalGiftModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const {
    loading: favoritesLoading,
    togglingIds,
    isFavorite,
    toggleFavorite,
  } = useMarketFavorites({ enabled: Boolean(user) });

  useEffect(() => {
    let cancelled = false;
    const fetchItems = async () => {
      try {
        const response = await getMarketItems();
        if (cancelled) return;
        setItems(response.data);
        setCachedData('market', response.data);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch market items", error);
        if (!hasCachedItems) {
          showAlert("Не удалось загрузить товары. Попробуйте позже.", 'error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItemStock = (itemId) => {
    setItems((prev) => {
      const next = prev.map((it) =>
        it.id === itemId ? { ...it, stock: Math.max(0, (it.stock ?? 0) - 1) } : it
      );
      setCachedData('market', next);
      return next;
    });
  };

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

      if (modalItem?.id === item.id) {
        setModalItem((prev) => (prev ? { ...prev, stock: Math.max(0, (prev.stock ?? 0) - 1) } : prev));
      }

      return { issued_code };
    } catch (error) {
      const detail = error.response?.data?.detail;
      throw new Error(typeof detail === 'string' ? detail : 'Не удалось оформить покупку');
    }
  };

  const handleLocalGiftConfirm = async (city, websiteUrl) => {
    if (!selectedItem) return;

    const isConfirmed = await confirm(
      `Вы уверены, что хотите купить "${selectedItem.name}" за ${selectedItem.price} спасибок?\n\nГород: ${city}\nСсылка: ${websiteUrl}\n\nСпасибки будут зарезервированы до решения администратора.`
    );

    if (isConfirmed) {
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
        console.error("Local gift failed:", error);
        showAlert(error.response?.data?.detail || "Произошла ошибка при создании заявки.", 'error');
      }
    }
  };

  const handleColleagueSelect = async (colleague) => {
    if (!selectedItem) return;

    const isConfirmed = await confirm(
      `Вы уверены, что хотите пригласить ${colleague.first_name} ${colleague.last_name} разделить "${selectedItem.name}" за ${selectedItem.price} спасибок?`
    );

    if (isConfirmed) {
      try {
        await createSharedGiftInvitation({
          buyer_id: user.id,
          invited_user_id: colleague.id,
          item_id: selectedItem.id
        });

        showAlert(
          `Приглашение отправлено ${colleague.first_name} ${colleague.last_name}!`,
          'success'
        );
      } catch (error) {
        console.error("Failed to create shared gift invitation:", error);
        showAlert(error.response?.data?.detail || "Ошибка при отправке приглашения.", 'error');
      }
    }

    setShowColleagueSelector(false);
    setSelectedItem(null);
  };

  const activeItems = items.filter(item => !item.is_archived);

  return (
    <PageLayout title="Кафетерий">
      <p className={styles.balance}>
        Ваш баланс: <strong>{user?.balance}</strong> спасибок
        {user?.reserved_balance > 0 && (
          <span style={{ marginLeft: '10px', color: '#666' }}>
            (зарезервировано: <strong>{user.reserved_balance}</strong>)
          </span>
        )}
      </p>

      <StatixBonusCard user={user} onPurchaseSuccess={onPurchaseSuccess} />

      {isLoading ? <p>Загрузка товаров...</p> : (
        <div className={styles.itemsGrid}>
          {activeItems.map(item => {
            const currentPrice = Number(item.price);
            const originalPrice = Number(item.original_price);
            const hasDiscount = typeof item.original_price === 'number' && item.original_price > item.price;
            const discountPercent = hasDiscount ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0;

            return (
              <article key={item.id} className={styles.itemCard}>
                {hasDiscount && (
                  <div className={styles.discountBadge}>
                    <FaStar className={styles.discountIcon} />
                    <span className={styles.discountText}>
                      - {discountPercent}%
                    </span>
                  </div>
                )}

                <div className={styles.itemImageWrap}>
                  <button
                    type="button"
                    className={styles.itemOpenBtn}
                    onClick={() => setModalItem(item)}
                    aria-label={`Открыть товар ${item.name}`}
                  >
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className={styles.itemImage} loading="lazy" />
                    ) : (
                      <div className={styles.imagePlaceholder} />
                    )}
                  </button>
                </div>

                <div className={styles.itemMeta}>
                  <button
                    type="button"
                    className={styles.itemBodyBtn}
                    onClick={() => setModalItem(item)}
                  >
                    <h2 className={styles.itemName}>{item.name}</h2>
                    <div className={styles.priceContainer}>
                      <span className={styles.itemPrice}>{currentPrice} спасибок</span>
                      {hasDiscount && (
                        <span className={styles.originalPrice}>
                          {originalPrice}
                        </span>
                      )}
                      {item.is_shared_gift && (
                        <span className={styles.specialBadge}>
                          <FaUsers size={12} /> Совместный
                        </span>
                      )}
                      {item.is_local_purchase && (
                        <span className={styles.specialBadge}>Локальный</span>
                      )}
                    </div>
                  </button>
                  <MarketFavoriteButton
                    active={isFavorite(item.id)}
                    disabled={favoritesLoading || togglingIds.has(item.id)}
                    onToggle={() => void toggleFavorite(item.id)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

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
    </PageLayout>
  );
}

export default MarketplacePage;
