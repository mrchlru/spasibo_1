import { useEffect, useState } from 'react';
import { FaGift } from 'react-icons/fa';
import {
  getDescriptionPreview,
  isDescriptionTruncated,
} from '../utils/productDescription';
import { downloadUrlAsFile, isPrizeImageUrl } from '../utils/prizeAssets';
import styles from './ShopItemModal.module.css';

function ShopItemModal({
  item,
  user,
  isOpen,
  onClose,
  onPurchase,
  onSpecialPurchase,
}) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [issuedCode, setIssuedCode] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDescriptionExpanded(false);
      setPurchasing(false);
      setError('');
      setSuccess('');
      setIssuedCode(null);
      setDownloading(false);
    }
  }, [isOpen, item?.id]);

  if (!isOpen || !item) {
    return null;
  }

  const description = item.description?.trim() ?? '';
  const canExpand = isDescriptionTruncated(description);
  const descriptionText = descriptionExpanded || !canExpand
    ? getDescriptionPreview(description, Number.MAX_SAFE_INTEGER)
    : getDescriptionPreview(description);

  const currentPrice = Number(item.price);
  const originalPrice = Number(item.original_price);
  const hasDiscount = typeof item.original_price === 'number' && item.original_price > item.price;
  const outOfStock = item.stock <= 0;
  const isShared = Boolean(item.is_shared_gift);
  const isLocal = Boolean(item.is_local_purchase);
  const availableBalance = isLocal
    ? (user?.balance ?? 0) - (user?.reserved_balance ?? 0)
    : (user?.balance ?? 0);
  const insufficientBalance = availableBalance < currentPrice;
  const purchaseDone = Boolean(success);

  const buyDisabled = purchasing || outOfStock || insufficientBalance || purchaseDone;

  let buyLabel = 'Купить';
  if (purchasing) {
    buyLabel = 'Покупка…';
  } else if (outOfStock) {
    buyLabel = 'Нет в наличии';
  } else if (isShared) {
    buyLabel = 'Совместный подарок';
  } else if (isLocal) {
    buyLabel = 'Локальный подарок';
  } else if (insufficientBalance) {
    buyLabel = 'Недостаточно спасибок';
  } else if (purchaseDone) {
    buyLabel = 'Куплено';
  }

  async function handlePurchase() {
    if (buyDisabled) {
      return;
    }

    if (isShared || isLocal) {
      onSpecialPurchase?.(item, isShared ? 'shared' : 'local');
      onClose();
      return;
    }

    setError('');
    setSuccess('');
    setIssuedCode(null);
    setPurchasing(true);
    try {
      const result = await onPurchase(item);
      const code = result?.issued_code?.trim() || null;
      setIssuedCode(code);
      setSuccess(code ? 'Покупка оформлена — ваш приз ниже' : 'Покупка успешно оформлена!');
      if (!code) {
        window.setTimeout(() => {
          onClose();
        }, 900);
      }
    } catch (purchaseError) {
      setError(
        purchaseError instanceof Error ? purchaseError.message : 'Не удалось оформить покупку',
      );
    } finally {
      setPurchasing(false);
    }
  }

  async function handleDownloadPrize() {
    if (!issuedCode || !isPrizeImageUrl(issuedCode)) {
      return;
    }
    setDownloading(true);
    setError('');
    try {
      await downloadUrlAsFile(issuedCode, `${item.name || 'prize'}.jpg`);
    } catch {
      setError('Не удалось скачать картинку. Попробуйте ещё раз.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <section
        className={styles.panel}
        role="dialog"
        aria-label={item.name}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Товар</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.media}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.name} className={styles.image} />
            ) : (
              <div className={styles.placeholder}>
                <FaGift size={40} />
              </div>
            )}
          </div>

          <h3 className={styles.itemName}>{item.name}</h3>

          <div className={styles.priceRow}>
            <span className={styles.price}>{currentPrice.toLocaleString('ru-RU')} спасибок</span>
            {hasDiscount && (
              <span className={styles.originalPrice}>
                {originalPrice.toLocaleString('ru-RU')}
              </span>
            )}
          </div>

          <div>
            <button
              type="button"
              className={`${styles.descriptionBtn} ${canExpand && !descriptionExpanded ? styles.descriptionBtnExpandable : ''}`}
              onClick={() => {
                if (canExpand && !descriptionExpanded) {
                  setDescriptionExpanded(true);
                }
              }}
              disabled={!canExpand || descriptionExpanded}
            >
              {descriptionText}
            </button>
            {canExpand && !descriptionExpanded && (
              <p className={styles.descriptionHint}>Нажмите, чтобы прочитать полностью</p>
            )}
          </div>

          {!outOfStock && (
            <p className={styles.stockNote}>В наличии: {item.stock}</p>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}

          {issuedCode && isPrizeImageUrl(issuedCode) && (
            <div className={styles.prizeBox}>
              <img src={issuedCode} alt="Ваш приз" className={styles.prizeImage} />
              <button
                type="button"
                className={styles.downloadBtn}
                disabled={downloading}
                onClick={() => void handleDownloadPrize()}
              >
                {downloading ? 'Скачивание…' : 'Скачать картинку'}
              </button>
            </div>
          )}

          {issuedCode && !isPrizeImageUrl(issuedCode) && (
            <div className={styles.prizeBox}>
              <p className={styles.codeLabel}>Ваш код / ссылка</p>
              <a
                className={styles.codeValue}
                href={issuedCode.startsWith('http') ? issuedCode : undefined}
                target="_blank"
                rel="noreferrer"
              >
                {issuedCode}
              </a>
            </div>
          )}

          {!purchaseDone && (
            <button
              type="button"
              className={`${styles.buyBtn} ${isShared ? styles.buyBtnShared : ''}`}
              disabled={buyDisabled}
              onClick={() => void handlePurchase()}
            >
              {buyLabel}
            </button>
          )}
          {purchaseDone && (
            <button type="button" className={styles.buyBtn} onClick={onClose}>
              Готово
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default ShopItemModal;
