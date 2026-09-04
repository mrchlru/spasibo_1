import { FaHeart } from 'react-icons/fa';
import styles from './MarketFavoriteButton.module.css';

/** Кнопка «в избранное» для карточки товара. */
export function MarketFavoriteButton({ active, disabled = false, onToggle }) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active ? styles.buttonActive : ''}`}
      aria-label={active ? 'Убрать из избранного' : 'Добавить в избранное'}
      aria-pressed={active}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onToggle();
      }}
    >
      <FaHeart size={15} aria-hidden="true" />
    </button>
  );
}
