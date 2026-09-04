/**
 * Дефолтные URL картинок темы (совпадают с index.css и прежними константами HomePage).
 * Подменяются значениями из app_settings.theme_assets при наличии.
 */
/**
 * Объединяет переопределения из API с дефолтами; пустые значения игнорируются.
 */
export function resolveSeasonAssets(seasonKey, themeAssets) {
  const base = THEME_ASSET_DEFAULTS[seasonKey] || THEME_ASSET_DEFAULTS.summer;
  const over = themeAssets?.[seasonKey] || {};
  const merged = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v != null && String(v).trim()) {
      merged[k] = String(v).trim();
    }
  }
  return merged;
}

export const THEME_ASSET_DEFAULTS = {
  summer: {
    header_image_mobile: 'https://i.postimg.cc/rw5Vy6Vk/%D0%BE%D0%B1%D0%BB%D0%BE%D0%B6%D0%BA%D0%B0_%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D1%8C%D0%BD%D0%B0%D1%8F_1.webp',
    header_image_desktop: 'https://i.postimg.cc/9MvKPMj0/%D1%88%D0%B0%D0%BF%D0%BA%D0%B0_%D0%B4%D0%BB%D1%8F_%D0%BF%D0%BA.webp',
    section_header_image: null,
    sidenav_logo: 'https://i.postimg.cc/zvmd8fQr/%D0%BB%D0%BE%D0%B3%D0%BE_%D0%B7%D0%B5%D0%BB%D0%B5%D0%BD%D0%BE%D0%B5_%D1%81%D0%B2.webp',
    thanks_button: 'https://i.postimg.cc/ncfzjKGc/%D0%BA%D0%BD%D0%BE%D0%BF%D0%BA%D0%B0_%D1%81%D0%BF%D0%B0%D1%81%D0%B8%D0%B1%D0%BA%D0%B8.webp',
    thanks_feed_logo: 'https://i.postimg.cc/cLCwXyrL/Frame_2131328056.webp',
    leaderboard_thanks_logo: 'https://i.postimg.cc/cLCwXyrL/Frame-2131328056.webp',
  },
  winter: {
    header_image_mobile: 'https://i.postimg.cc/7PFGNvRb/Gemini-Generated-Image-8bd3bh8bd3bh8bd3.webp',
    header_image_desktop: 'https://i.postimg.cc/HxHpsyT4/sapka-dla-pk-3-sin.webp',
    section_header_image: 'https://i.postimg.cc/6psSrhnR/sapka-ost-razdelov-sinaa.webp',
    sidenav_logo: 'https://i.postimg.cc/RVsHnPHk/LOGO-SP-SIN.webp',
    thanks_button: 'https://i.postimg.cc/kgrZQyKK/knopka-otpr-sp-sinaa.webp',
    thanks_feed_logo: 'https://i.postimg.cc/L5j1PRjr/LOGO-SP-UVED-SIN.webp',
    leaderboard_thanks_logo: 'https://i.postimg.cc/cLCwXyrL/Frame-2131328056.webp',
  },
};
