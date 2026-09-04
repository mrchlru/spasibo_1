import React from 'react';
import styles from './FeedSkeleton.module.css';

/**
 * Skeleton-заглушки для ленты активности.
 *
 * @param {{ count?: number }} props
 */
function FeedSkeleton({ count = 4 }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.item}>
          <div className={styles.avatar} />
          <div className={styles.lines}>
            <div className={styles.lineWide} />
            <div className={styles.lineNarrow} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default FeedSkeleton;
