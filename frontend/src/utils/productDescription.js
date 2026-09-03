export const PRODUCT_DESCRIPTION_PREVIEW_LENGTH = 220;

/** Возвращает сокращённое описание товара для превью. */
export function getDescriptionPreview(description, maxLength = PRODUCT_DESCRIPTION_PREVIEW_LENGTH) {
  const text = description?.trim() ?? '';
  if (!text) {
    return 'Описание пока не добавлено.';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** Проверяет, нужно ли показывать раскрытие полного описания. */
export function isDescriptionTruncated(description, maxLength = PRODUCT_DESCRIPTION_PREVIEW_LENGTH) {
  const text = description?.trim() ?? '';
  return text.length > maxLength;
}
