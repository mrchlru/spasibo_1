// frontend/src/components/PageLayout.jsx

import React from 'react';
import styles from './PageLayout.module.css';
import { useResolvedSeasonAssets } from '../contexts/ThemeAssetsContext';
import { resolveShellDisplayUrl } from '../pwa/shellAssetCache';

function PageLayout({ title, children }) {
  const assets = useResolvedSeasonAssets();
  const headerLogoUrl = resolveShellDisplayUrl(assets.page_header_logo);
  const headerDividerUrl = resolveShellDisplayUrl(assets.page_header_divider);

  return (
    <div className={styles.pageContainer}>
      
      <div className={styles.header}>
        {/* Этот контейнер будет использовать flexbox для точного выравнивания */}
        <div className={styles.headerContent}>
          {/* 1. Логотип "C" */}
          <img
            src={headerLogoUrl}
            alt="Лого"
            className={styles.headerLogo}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          {/* 2. Волнистая линия */}
          <img
            src={headerDividerUrl}
            alt="Разделитель"
            className={styles.headerLine}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          {/* 3. Название раздела */}
          <h1 className={styles.headerTitle}>{title}</h1>
        </div>
      </div>

      <div className={styles.contentArea}>
        {children}
      </div>
    </div>
  );
}

export default PageLayout;
