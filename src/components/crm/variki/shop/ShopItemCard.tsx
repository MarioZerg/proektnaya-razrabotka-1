import ShopCardImage from '@/components/crm/variki/ShopCardImage';
import SpaAnimation from '@/components/crm/variki/SpaAnimation';
import HatLootCarousel from '@/components/crm/variki/shop/HatLootCarousel';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { ShopItem } from '@/lib/varikiApi';
import { checkPeriod, isBubbleCase } from '@/components/crm/variki/shop/varikiShopUtils';

interface ShopItemCardProps {
  item: ShopItem;
  index: number;
  balance: number;
  userId?: number;
  onBuy: (item: ShopItem) => void;
}

/** Карточка подарка на витрине: фото, контакты, цена, остаток, срок и кнопка «Купить». */
const ShopItemCard = ({ item, index, balance, userId, onBuy }: ShopItemCardProps) => {
  const enough = balance >= item.price;
  const isCase = isBubbleCase(item);
  // У подарков с записью на дату склада нет вовсе: сертификат
  // бронирует админ под конкретный день. Считать их «закончившимися»
  // из-за пустого склада нельзя — купить можно всегда.
  // Кейс бокс безлимитный: сертификаты не нужны.
  const soldOut = !isCase && !item.needsVisitDate && item.available === 0;
  const period = checkPeriod(item);
  return (
    <div className="relative flex min-h-[19rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Фотография подарка: по одной анимации пузырьков непонятно,
          ЧТО покупаешь. Снимок делает награду наглядной, а пузырьки
          поверх воды на нём оживляют карточку. */}
      {isCase && <HatLootCarousel />}
      {item.imageUrl && !isCase && (
        <div className="relative h-40 shrink-0 overflow-hidden">
          <ShopCardImage
            src={item.imageUrl}
            alt={item.title}
            priority={index < 6}
            className="h-full w-full object-cover"
          />
          {item.animation === 'spa' && <SpaAnimation />}
          {/* Плавный переход от фото к карточке, чтобы снимок не
              обрывался резкой линией. */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card" />
        </div>
      )}
      {!item.imageUrl && !isCase && item.animation === 'spa' && <SpaAnimation />}

      <div className="relative flex flex-1 flex-col p-5">
        {!item.imageUrl && !isCase && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-cyan-200">
            <Icon name={item.icon} size={34} className="text-cyan-600" />
          </div>
        )}

        <h2 className="text-lg font-bold leading-tight">{item.title}</h2>
        {item.description && (
          <p className="mt-1 text-sm text-foreground/80">{item.description}</p>
        )}

        {/* Куда идти и куда звонить — видно ДО покупки: сотрудник
            решает, удобно ли ему добираться, пока не потратил варики.
            Телефон кликабельный: с телефона сразу набор. */}
        {(item.orgAddress || item.orgPhone) && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {item.orgAddress && (
              <p className="flex items-start gap-1.5">
                <Icon name="MapPin" size={13} className="mt-0.5 shrink-0" />
                <span>{item.orgAddress}</span>
              </p>
            )}
            {item.orgPhone && (
              <p className="flex items-center gap-1.5">
                <Icon name="Phone" size={13} className="shrink-0" />
                <a
                  href={`tel:${item.orgPhone.replace(/[^\d+]/g, '')}`}
                  className="hover:text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.orgPhone}
                </a>
              </p>
            )}
          </div>
        )}

        <div className="mt-auto space-y-2 pt-4">
          <div className="flex items-center gap-2">
            <Icon name="Coins" size={20} className="text-amber-500" />
            <span className="whitespace-nowrap text-2xl font-bold">
              {item.price}
            </span>
            <span className="text-sm text-muted-foreground">вариков</span>
          </div>

          {/* Не хватает — говорим СКОЛЬКО именно: так виден понятный
              ориентир, а не глухое «недостаточно средств». */}
          {!enough && !soldOut && period.active && (
            <p className="text-xs font-medium text-muted-foreground">
              Не хватает {item.price - balance} вариков
            </p>
          )}

          {/* Остаток показываем, только когда он МАЛЕНЬКИЙ: «осталось 2»
              подталкивает решиться, а «осталось 47» — просто шум. */}
          {isCase && period.active && (
            <p className="text-xs font-medium text-amber-800">
              Преимущество: 30 дней — 3 заказа в работе вместо 2
            </p>
          )}

          {!soldOut && period.active && !item.needsVisitDate && !isCase
            && item.available <= 3 && (
            <p className="text-xs font-semibold text-amber-700">
              Осталось {item.available}
              {item.stockLimit ? ` из ${item.stockLimit}` : ''}
            </p>
          )}

          {/* Подарок с записью: сотрудник должен понимать заранее,
              что сертификат придёт не сразу, а после брони. */}
          {item.needsVisitDate && period.active && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="CalendarCheck" size={13} className="shrink-0" />
              Выберете дату — администратор забронирует
            </p>
          )}

          {/* Срок продажи. Пока подарок доступен — мягкое напоминание
              «купить до», когда истёк — явная причина, почему нельзя. */}
          {period.note && (
            <p
              className={`flex items-center gap-1.5 text-xs font-semibold ${
                period.active ? 'text-muted-foreground' : 'text-destructive'
              }`}
            >
              <Icon name="CalendarClock" size={13} className="shrink-0" />
              {period.note}
            </p>
          )}

          <Button
            className="w-full"
            disabled={!enough || !userId || soldOut || !period.active}
            onClick={() => onBuy(item)}
          >
            <Icon
              name={
                !period.active
                  ? 'CalendarOff'
                  : soldOut
                    ? 'PackageX'
                    : 'ShoppingBag'
              }
              size={16}
              className="mr-1.5"
            />
            {!period.active
              ? 'Недоступно'
              : soldOut
                ? 'Закончились'
                : 'Купить'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ShopItemCard;
