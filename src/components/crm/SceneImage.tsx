/**
 * Иллюстрация живой плитки (главная, склад товара, поставки в маркет).
 *
 * Каждая сцена лежит в двух размерах webp: 480 и 960 px по ширине. Браузер
 * берёт нужный по ширине плитки и плотности экрана — телефон не качает
 * картинку для широкого монитора. Вне экрана картинка не грузится, а
 * расшифровка идёт в фоне и не тормозит первую отрисовку цифр.
 */
interface SceneImageProps {
  /** Имя сцены без размера и расширения, например «prod-sewing». */
  name: string;
  /** Подсказка браузеру, какой ширины будет плитка. */
  sizes?: string;
  className?: string;
}

const BASE = '/warehouse-stations/';

const SceneImage = ({
  name,
  sizes = '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  className = '',
}: SceneImageProps) => (
  <img
    src={`${BASE}${name}-960.webp`}
    srcSet={`${BASE}${name}-480.webp 480w, ${BASE}${name}-960.webp 960w`}
    sizes={sizes}
    width={960}
    height={540}
    alt=""
    loading="lazy"
    decoding="async"
    className={`absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${className}`}
  />
);

export default SceneImage;
