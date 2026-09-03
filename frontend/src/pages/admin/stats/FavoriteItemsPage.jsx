// frontend/src/pages/admin/stats/FavoriteItemsPage.jsx

import React, { useState, useEffect } from 'react';
import { getFavoriteItemsStats } from '../../../api';
import styles from './PopularItemsPage.module.css';

const FavoriteItemsPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await getFavoriteItemsStats();
        setItems(response.data.items ?? []);
      } catch (err) {
        setError('Не удалось загрузить статистику избранного.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <p>Загрузка избранных товаров…</p>;
  }

  if (error) {
    return <p style={{ color: 'red' }}>{error}</p>;
  }

  return (
    <div>
      <h2>Избранные товары</h2>
      <p style={{ color: '#6E7A85', marginBottom: 16 }}>
        Товары, которые сотрудники чаще всего сохраняют в избранное — ориентир для закупок.
      </p>
      {items.length > 0 ? (
        <ul className={styles.itemList}>
          {items.map(({ item, favorite_count: favoriteCount }, index) => (
            <li key={item.id} className={styles.itemCard}>
              <span className={styles.rank}>{index + 1}</span>
              <img
                src={item.image_url || 'https://via.placeholder.com/60/E9EEF2/6E7A85?text=...'}
                alt={item.name}
                className={styles.itemImage}
                loading="lazy"
              />
              <div className={styles.itemInfo}>
                <div className={styles.itemName}>{item.name}</div>
                <div className={styles.itemPrice}>{item.price} спасибок</div>
              </div>
              <div className={styles.purchaseInfo}>
                <div className={styles.purchaseCount}>{favoriteCount}</div>
                <div className={styles.purchaseLabel}>в избранном</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Пока никто не добавил товары в избранное.</p>
      )}
    </div>
  );
};

export default FavoriteItemsPage;
