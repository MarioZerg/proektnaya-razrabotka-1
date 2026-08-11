import { Card } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Supply, SupplyType } from '@/lib/marketplaceSuppliesApi';

/**
 * Плашки по схемам поставки над таблицей.
 *
 * Таблица отвечает на вопрос «что с конкретной поставкой», но не на вопрос
 * «сколько работы каждого вида сегодня». Кладовщик считал строки глазами.
 * Плашки дают ответ сразу: сколько поставок в работе, сколько вещей в них,
 * сколько уже собрано и что сейчас разбирают чужими руками.
 *
 * FBS и FBO — это разная физическая работа, поэтому и плашки разные:
 * FBS собирают поштучно и передают из рук в руки, FBO грузят коробками в машину.
 */

type Group = {
  type: SupplyType;
  title: string;
  subtitle: string;
  image: string;
  /** Мягкая подложка карточки — FBS голубая, FBO фиолетовая, как метки в подборе. */
  accent: string;
  ring: string;
};

const GROUPS: Group[] = [
  {
    type: 'FBS',
    title: 'FBS',
    subtitle: 'Со своего склада — вещь едет своим пакетом',
    image: '/img/supply-fbs.webp',
    accent: 'from-sky-50 to-sky-100/40',
    ring: 'text-sky-700',
  },
  {
    type: 'FBO',
    title: 'FBO',
    subtitle: 'Коробками на склад маркетплейса',
    image: '/img/supply-fbo.webp',
    accent: 'from-violet-50 to-violet-100/40',
    ring: 'text-violet-700',
  },
];

const SupplyTypeWidgets = ({
  supplies,
  activeType,
  onSelectType,
}: {
  supplies: Supply[];
  /** Текущий фильтр по схеме: подсвечиваем выбранную плашку. */
  activeType: string;
  onSelectType: (type: string) => void;
}) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GROUPS.map((g) => {
        const list = supplies.filter((s) => s.type === g.type);
        const items = list.reduce((sum, s) => sum + (s.itemsCount || 0), 0);
        const assembling = list.filter((s) => s.status === 'На сборке').length;
        // Поставку уже держит другой кладовщик — идти туда бессмысленно.
        const locked = list.filter((s) => s.lockedByName).length;
        const isActive = activeType === g.type;

        return (
          <Card
            key={g.type}
            onClick={() => onSelectType(isActive ? 'all' : g.type)}
            className={`relative cursor-pointer overflow-hidden bg-gradient-to-br ${g.accent} p-0 transition-shadow hover:shadow-md ${
              isActive ? 'ring-2 ring-primary' : ''
            }`}
          >
            <div className="flex items-stretch gap-3">
              <div className="flex-1 p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">{g.title}</h3>
                  {isActive && (
                    <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      фильтр
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.subtitle}</p>

                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold leading-none">{list.length}</span>
                  <span className="text-sm text-muted-foreground">
                    {list.length === 1 ? 'поставка' : 'поставок'}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Icon name="Package" size={13} className={g.ring} />
                    <span className="text-muted-foreground">Товаров:</span>
                    <span className="font-semibold">{items} шт</span>
                  </div>
                  {assembling > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Icon name="Boxes" size={13} className={g.ring} />
                      <span className="text-muted-foreground">На сборке:</span>
                      <span className="font-semibold">{assembling}</span>
                    </div>
                  )}
                  {locked > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-700">
                      <Icon name="Lock" size={13} />
                      <span>Заняты другими: {locked}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Иллюстрация прижата к правому краю и обрезается на узких экранах:
                  цифры важнее картинки, они не должны съезжать. */}
              <img
                src={g.image}
                alt=""
                loading="lazy"
                className="w-28 shrink-0 self-end object-contain object-bottom sm:w-36"
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default SupplyTypeWidgets;