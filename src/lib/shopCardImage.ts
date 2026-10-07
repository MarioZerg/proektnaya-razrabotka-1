/**
 * Карточка магазина — 160 px в высоту. Оригиналы с Яндекса (orig / XXXL)
 * весят сотни килобайт и тормозят витрину. У их CDN те же фото есть
 * меньшими суффиксами: L ≈ 400 px, как раз под карточку и ретину.
 */
const YANDEX_SIZE = /\/(orig|XXXL|XXL_height|XXL|XL|L|M|S)$/;

export const shopCardImageUrl = (url: string, size: 'L' | 'M' = 'L') => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('yandex.net') && YANDEX_SIZE.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(YANDEX_SIZE, `/${size}`);
      return parsed.toString();
    }
  } catch {
    /* data: или кривая ссылка — отдаём как есть */
  }
  return url;
};
