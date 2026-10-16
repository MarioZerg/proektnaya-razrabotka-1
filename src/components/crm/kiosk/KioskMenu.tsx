import { useState } from 'react';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import Icon from '@/components/ui/icon';
import { isStorekeeperRole, type Role } from '@/lib/roles';

export type KioskScreen =
  | 'menu'
  | 'shift'
  | 'orders'
  | 'reviews'
  | 'rolls'
  | 'unlabeled'
  | 'defect'
  | 'repack'
  | 'flyer'
  | 'cutterSheet'
  | 'vacation';

interface KioskMenuProps {
  onSelect: (screen: KioskScreen) => void;
  /** Роль сотрудника — кладовщику на терминале доступны смена и поиск вещей без стикера. */
  role: Role;
  /**
   * Сколько вещей ждёт перепаковки в ЭТОМ цехе.
   *
   * Число прямо на плитке: упаковщица видит объём работы, не заходя внутрь. Раньше,
   * чтобы понять, есть ли вообще перепаковка, приходилось открывать экран и ждать
   * загрузки списка.
   */
  repackCount?: number;
  /**
   * Имя упаковщицы-возвраты, если она сейчас на смене в этом цехе.
   * Пока она работает, основной упаковщице плитку «Перепаковка» прячем.
   */
  returnsPackerOnShift?: string | null;
  /** Основная упаковщица на смене: без неё упаковщица-возвраты подменяет её. */
  mainPackerOnShift?: string | null;
}

const tiles: Array<{
  screen: KioskScreen;
  label: string;
  hint: string;
  icon: string;
  /** Цвет значка и лёгкого фона плитки. */
  tone: string;
}> = [
  {
    screen: 'shift',
    label: 'Открытие / Закрытие смены',
    hint: 'Пришёл — открой. Уходишь — закрой',
    icon: 'Clock',
    tone: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/25',
  },
  {
    screen: 'orders',
    label: 'Печать заказов',
    hint: 'Стикер на сшитую вещь',
    icon: 'Printer',
    tone: 'bg-sky-500/15 text-sky-700 ring-sky-500/25',
  },
  {
    screen: 'cutterSheet',
    label: 'Печать закройщиков',
    hint: 'Лист с бирками к стеку',
    icon: 'Scissors',
    tone: 'bg-amber-500/15 text-amber-800 ring-amber-500/25',
  },
  {
    screen: 'reviews',
    label: 'Отзывы',
    hint: 'Что написали покупатели',
    icon: 'Star',
    tone: 'bg-yellow-500/15 text-yellow-800 ring-yellow-500/30',
  },
  {
    screen: 'rolls',
    label: 'Работа с рулонами',
    hint: 'Ткань на стеллаже',
    icon: 'Layers',
    tone: 'bg-teal-500/15 text-teal-800 ring-teal-500/25',
  },
  {
    screen: 'unlabeled',
    label: 'Товар без стикера',
    hint: 'Найти вещь без бирки',
    icon: 'PackageSearch',
    tone: 'bg-orange-500/15 text-orange-800 ring-orange-500/25',
  },
  {
    screen: 'defect',
    label: 'Брак из рулона',
    hint: 'Испорченный кусок ткани',
    icon: 'TriangleAlert',
    tone: 'bg-rose-500/15 text-rose-700 ring-rose-500/25',
  },
  {
    screen: 'repack',
    label: 'Перепаковка',
    hint: 'Годная вещь, мятая упаковка',
    icon: 'PackageOpen',
    tone: 'bg-violet-500/15 text-violet-800 ring-violet-500/25',
  },
  {
    screen: 'flyer',
    label: 'Стикер на листовку',
    hint: 'Наклейка состава на вкладыш',
    icon: 'FileText',
    tone: 'bg-cyan-500/15 text-cyan-800 ring-cyan-500/25',
  },
  {
    screen: 'vacation',
    label: 'Отпуск',
    hint: 'Даты, когда вас не будет',
    icon: 'Calendar',
    tone: 'bg-slate-500/15 text-slate-700 ring-slate-500/25',
  },
];

/** Главное меню терминала — крупные плитки под сенсорный экран. */
const KioskMenu = ({
  onSelect,
  role,
  repackCount = 0,
  returnsPackerOnShift = null,
  mainPackerOnShift = null,
}: KioskMenuProps) => {
  // Кто что видит на терминале:
  //
  // «Товар без стикера» — зона кладовщика: он ищет вещи, оставшиеся без стикера хранения.
  //   Приём брака с киоска убран: брак из цеха кладовщик сканирует у себя на складе,
  //   на компьютере (Инвентаризация → Приём брака из цеха), а не на планшете в цехе.
  // «Перепаковка» — вещи вернулись от покупателя годными, но с мятой упаковкой.
  //   Доступна упаковщице И кладовщику: возвраты приходят на склад, и кладовщик
  //   разбирает их сам, не относя вещи в цех. Швея и закройщик упаковкой не
  //   занимаются — им плитка только мешает.
  // «Брак из рулона» — видят все, кто работает с материалом, но каждый по своему:
  //   закройщик режет ткань, швея шьёт тесьмой, упаковщица портит пакеты и этикетки.
  // «Стикер на листовку» — работа упаковщицы: она клеит наклейку с составом на
  //   рекламную листовку, которая идёт в посылку. Кладовщик, швея и закройщик
  //   листовки не собирают.
  // «Отзывы» — доступны всем ролям на терминале.
  // «Печать закройщиков» — плитка закройщика: он берёт стек на компьютере, а лист
  //   с бирками печатает у принтера в цехе. Швея, упаковщица и кладовщик стеки не
  //   берут, и чужой лист им печатать незачем.
  const hiddenByRole: Record<string, KioskScreen[]> = {
    storekeeper: ['orders', 'rolls', 'defect', 'flyer', 'cutterSheet'],
    sewer: ['unlabeled', 'repack', 'flyer', 'cutterSheet'],
    cutter: ['unlabeled', 'repack', 'flyer'],
    // Возвраты: только перепаковка. Стикеровка основной продукции и листовки —
    // зона основной упаковщицы.
    packer_returns: ['orders', 'flyer', 'unlabeled', 'cutterSheet'],
  };

  // Администратору на терминале доступно ВСЁ, включая «Товар без стикера».
  //
  // Раньше его роли не было в списке, и он попадал под правило «по умолчанию» — плитка
  // пряталась. На практике админ подходит к терминалу ровно тогда, когда у кладовщика
  // что-то не сходится: вещь без стикера, и разобраться надо на месте, а не искать
  // свободного кладовщика, чтобы тот открыл экран под своим входом.
  const hidden: KioskScreen[] = [
    ...(role === 'admin'
      ? []
      : isStorekeeperRole(role)
        ? hiddenByRole.storekeeper
        : hiddenByRole[role] || ['unlabeled', 'cutterSheet']),
  ];

  // Пока в цехе на смене упаковщица-возвраты — основную к перепаковке не пускаем.
  // Иначе обе возьмут одну очередь, а основная отвлечётся от стикеровки.
  if (role === 'packer' && returnsPackerOnShift && !hidden.includes('repack')) {
    hidden.push('repack');
  }

  // Основной упаковщицы нет на смене — возвраты подменяет её на стикеровке.
  if (role === 'packer_returns' && !mainPackerOnShift) {
    const i = hidden.indexOf('orders');
    if (i >= 0) hidden.splice(i, 1);
  }

  const visibleTiles = tiles.filter((t) => !hidden.includes(t.screen));

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {visibleTiles.map((t) => (
        <KioskTile
          key={t.screen}
          label={t.label}
          hint={t.hint}
          icon={t.icon}
          tone={t.tone}
          count={t.screen === 'repack' && repackCount > 0 ? repackCount : null}
          onClick={() => onSelect(t.screen)}
        />
      ))}
    </div>
  );
};

/** Плитка: значок + текст по центру, без иллюстраций — читается с расстояния. */
const KioskTile = ({
  label,
  hint,
  icon,
  tone,
  count,
  onClick,
}: {
  label: string;
  hint: string;
  icon: string;
  tone: string;
  count: number | null;
  onClick: () => void;
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`relative flex min-h-[9.5rem] w-full min-w-0 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-2xl border bg-white px-3 py-4 text-center shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:min-h-[10.5rem] ${
        pressed ? 'scale-[0.98]' : ''
      } ${count != null ? 'border-violet-200' : 'border-slate-200/90'}`}
    >
      <span
        className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ${tone}`}
        aria-hidden
      >
        <Icon name={icon} size={28} strokeWidth={2.15} />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-balance text-sm font-bold leading-snug text-slate-900 sm:text-[0.95rem]">{label}</p>
        <p className="text-pretty text-xs leading-snug text-slate-500">{hint}</p>
      </div>
      {count != null && (
        <span className="absolute right-2.5 top-2.5">
          <LiveCountBoard value={count} tone="violet" />
        </span>
      )}
    </button>
  );
};

export default KioskMenu;
