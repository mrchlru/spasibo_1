import React, { createContext, useContext, useMemo } from 'react';
import { resolveSeasonAssets } from '../themeAssetDefaults';

const ThemeAssetsContext = createContext({
  seasonTheme: 'summer',
  themeAssets: null,
});

/**
 * Провайдер сезонной темы и URL картинок оболочки (из app_settings).
 */
export function ThemeAssetsProvider({ seasonTheme, themeAssets, children }) {
  const value = useMemo(
    () => ({
      seasonTheme: seasonTheme || 'summer',
      themeAssets: themeAssets ?? null,
    }),
    [seasonTheme, themeAssets],
  );

  return (
    <ThemeAssetsContext.Provider value={value}>
      {children}
    </ThemeAssetsContext.Provider>
  );
}

/** @returns {{ seasonTheme: string, themeAssets: object | null }} */
export function useThemeAssets() {
  return useContext(ThemeAssetsContext);
}

/** Объединённые URL картинок для активной сезонной темы. */
export function useResolvedSeasonAssets() {
  const { seasonTheme, themeAssets } = useThemeAssets();
  const seasonKey = seasonTheme === 'winter' ? 'winter' : 'summer';
  return useMemo(
    () => resolveSeasonAssets(seasonKey, themeAssets),
    [seasonKey, themeAssets],
  );
}
