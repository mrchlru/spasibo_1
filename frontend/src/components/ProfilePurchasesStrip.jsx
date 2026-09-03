import { useEffect, useState } from 'react';
import { getMyPurchases } from '../api';
import { downloadUrlAsFile, isPrizeImageUrl } from '../utils/prizeAssets';
import { isHttpUrl, openExternalLink } from '../utils/openExternalLink';
import styles from './ProfilePurchasesStrip.module.css';

/** Загружает и показывает купленные товары в профиле. */
export function ProfilePurchasesStrip() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPurchases() {
      setLoading(true);
      try {
        const response = await getMyPurchases();
        if (!cancelled) {
          setItems(response.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPurchases();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className={styles.block} aria-label="Купленные товары">
        <h2 className={styles.sectionTitle}>Купленные товары</h2>
        <div className={styles.skeleton} />
      </section>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.block} aria-label="Купленные товары">
      <h2 className={styles.sectionTitle}>Купленные товары</h2>
      <div className={styles.scroller}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.card}
            onClick={() => setSelected(item)}
          >
            <div className={styles.imageWrap}>
              {item.image_url ? (
                <img src={item.image_url} alt="" className={styles.image} loading="lazy" />
              ) : (
                <span className={styles.imageFallback} aria-hidden="true" />
              )}
            </div>
            <span className={styles.name}>{item.item_name}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <PurchaseFulfillmentModal
          purchase={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}

/** Модалка: способ получения или автовыданный приз. */
function PurchaseFulfillmentModal({ purchase, onClose }) {
  const code = purchase.issued_code?.trim() || '';
  const isImage = isPrizeImageUrl(code);
  const isLink = isHttpUrl(code);

  function handleOpenLink() {
    openExternalLink(code);
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={purchase.item_name}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.sheetHeader}>
          <h3 className={styles.sheetTitle}>{purchase.item_name}</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        {purchase.is_auto_issuance && code ? (
          <div className={styles.fulfillment}>
            <p className={styles.fulfillmentLabel}>Автовыдача</p>
            {isImage ? (
              <div className={styles.prizeBlock}>
                <img src={code} alt="Приз" className={styles.prizeThumb} />
                <button
                  type="button"
                  className={styles.prizeAction}
                  onClick={() => {
                    void downloadUrlAsFile(code, 'prize.jpg').catch(() => undefined);
                  }}
                >
                  Скачать
                </button>
              </div>
            ) : null}
            {isLink && !isImage ? (
              <button
                type="button"
                className={styles.prizeAction}
                onClick={handleOpenLink}
              >
                Открыть ссылку
              </button>
            ) : null}
            {!isImage && !isLink ? (
              <p className={styles.codeValue}>{code}</p>
            ) : null}
          </div>
        ) : (
          <div className={styles.fulfillment}>
            <p className={styles.fulfillmentLabel}>Как получить</p>
            <p className={styles.instructions}>
              {purchase.delivery_instructions?.trim()
                || 'Свяжитесь с администратором для получения приза.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
