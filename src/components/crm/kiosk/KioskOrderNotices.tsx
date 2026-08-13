import Icon from '@/components/ui/icon';
import type { KioskOrder } from '@/lib/kioskApi';

/**
 * Предупреждения над карточкой заказа: куда класть вещь и на что обратить внимание.
 *
 * Всё, что упаковщица должна увидеть ДО печати ярлыка: контейнер, связка,
 * юридическое лицо. Ошибка на этом шаге стоит дороже всего — вещь уедет не туда.
 */
const KioskOrderNotices = ({ order }: { order: KioskOrder }) => (
  <>
    {/* Куда класть вещь после стикеровки. Контейнеры в цехе разделены:
        FBS едут по отправлениям, FBO — по складам назначения.
        Поставка FBO собирается по артикулу, а он одинаковый у одинаковых изделий
        в разных кластерах: вуаль 200×250 для Хоругвино и для другого города —
        один товар. Система подмену не заметит, город есть только на стикере,
        поэтому пишем его крупно прямо на экране. */}
    {order.orderType === 'FBO' ? (
      <div className="flex items-start gap-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900">
        <Icon name="Container" size={22} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-bold">
            Контейнер FBO
            {order.cluster ? ` · ${order.cluster}` : ''}
          </p>
          <p className="text-sm">
            {order.cluster
              ? `Положите вещь в контейнер склада ${order.cluster}. Сверьте город на стикере: у одинаковых изделий разных городов артикул совпадает, система подмену не заметит`
              : 'Склад назначения указан на стикере — прочитайте город и положите вещь в контейнер этого склада, отдельно от FBS'}
          </p>
        </div>
      </div>
    ) : order.orderType === 'FBS' ? (
      <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
        <Icon name="Container" size={22} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-bold">Контейнер FBS</p>
          <p className="text-sm">
            Положите вещь в контейнер FBS — отдельно от товара FBO
          </p>
        </div>
      </div>
    ) : null}

    {/* Вещь из связки Яндекса: ярлык у каждой вещи свой, но уезжают они вместе.
        Предупреждаем прямо на терминале, иначе упаковщица может напечатать один
        ярлык на всю связку — и остальные пакеты уедут без ярлыков. */}
    {order.groupSize && order.groupSize > 1 && (
      <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
        <Icon name="Layers" size={22} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">
            Связка: вещь {order.groupPosition} из {order.groupSize}
          </p>
          <p className="text-sm">
            Упакуйте вещи заказа вместе, но ярлык печатайте на каждую отдельно —
            у этой вещи свой ярлык «{order.groupPosition} из {order.groupSize}»
          </p>
        </div>
      </div>
    )}
    {/* Покупатель — компания. Шьётся и упаковывается как обычно, но
        упаковщица должна видеть, кому уйдёт вещь. */}
    {order.isLegalEntity && (
      <div className="flex items-start gap-3 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-indigo-900">
        <Icon name="Building2" size={22} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">Заказ юридического лица</p>
          <p className="text-sm">
            {order.legalCompanyName || 'Покупатель — компания'}. Собирается как обычный
            заказ, ярлык отправления печатается так же
          </p>
        </div>
      </div>
    )}
    {order.groupSize && order.groupSize > 1 && (
      <div className="flex items-start gap-3 rounded-md border border-violet-300 bg-violet-50 p-3 text-violet-900">
        <Icon name="Package" size={22} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">
            Заказ из {order.groupSize} вещей — это {order.groupPosition}-я
          </p>
          <p className="text-sm">
            Каждая вещь едет своим пакетом со своим ярлыком. Отгружается заказ только
            целиком — все {order.groupSize} вещи должны попасть в одну поставку
          </p>
        </div>
      </div>
    )}
  </>
);

export default KioskOrderNotices;
