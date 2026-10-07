import { useState } from 'react';
import { shopCardImageUrl } from '@/lib/shopCardImage';

interface ShopCardImageProps {
  src: string;
  alt: string;
  /** Первые карточки на экране — грузим сразу, не ждём lazy. */
  priority?: boolean;
  className?: string;
  /** Яндекс: L на витрине, M в списке управления. */
  size?: 'L' | 'M';
}

/**
 * Фото подарка: меньше файл, без отложенной загрузки у видимых карточек
 * и серый фон, пока снимок едет — страница не прыгает пустыми дырами.
 */
const ShopCardImage = ({
  src,
  alt,
  priority = false,
  className = '',
  size = 'L',
}: ShopCardImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const url = shopCardImageUrl(src, size);

  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
      <img
        src={url}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'low'}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      />
    </>
  );
};

export default ShopCardImage;
