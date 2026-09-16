/**
 * Подготовка фотографии к загрузке на аватар.
 *
 * Сотрудник ставит фото телефоном, а телефон отдаёт кадр 4000×3000 весом 6 МБ.
 * Отправлять такой файл в облачную функцию нельзя: на цеховом интернете загрузка
 * тянется минуту, а в кружок 40 пикселей от этих 12 миллионов точек всё равно
 * ничего не доходит. Поэтому браузер сам вырезает из кадра центральный квадрат и
 * сжимает его до размера, который реально виден на экране, — уходит около 30 КБ.
 *
 * Заодно это делает загрузку предсказуемой: сервер не гадает, что ему пришлют, и
 * не хранит в бакете десятки мегабайт ради кружка в переписке.
 */

/** Сторона готового квадрата. С запасом на экраны с двойной плотностью точек. */
const AVATAR_SIZE = 256;

/** Качество JPEG: на лице разница с 1.0 не видна, а вес втрое меньше. */
const AVATAR_QUALITY = 0.85;

/**
 * Загружает файл в картинку, которую можно рисовать на canvas.
 *
 * createImageBitmap умеет сразу учесть поворот из EXIF — иначе селфи с телефона
 * встаёт на аватаре набок. Старый Safari на цеховых планшетах этого не умеет,
 * поэтому для него остаётся обычный <img>: современные браузеры разворачивают
 * такие снимки сами при отрисовке.
 */
const loadImage = async (file: File): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Формат браузеру не по зубам (бывает с HEIC у iPhone) — пробуем через <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось открыть изображение'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Вырезает из фотографии центральный квадрат и сжимает его до аватара.
 *
 * @returns строка data:image/jpeg;base64,... готовая к отправке на сервер
 */
export const prepareAvatar = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Это не изображение — выберите фотографию');
  }

  const image = await loadImage(file);
  const width = 'width' in image ? image.width : 0;
  const height = 'height' in image ? image.height : 0;
  if (!width || !height) throw new Error('Не удалось прочитать фотографию');

  // Берём центр кадра: на портретной фотографии лицо почти всегда там, а обрезать
  // «по-умному» без ручной рамки всё равно не получится.
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог обработать фотографию');
  ctx.drawImage(image as CanvasImageSource, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  if ('close' in image) image.close();

  return canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
};

export default prepareAvatar;
