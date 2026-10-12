import { useState } from 'react';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import SceneImage from '@/components/crm/SceneImage';
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
}

const tiles: Array<{
  screen: KioskScreen;
  label: string;
  hint: string;
  scene: string;
}> = [
  {
    screen: 'shift',
    label: 'Открытие / Закрытие смены',
    hint: 'Пришёл — открой. Уходишь — закрой',
    scene: 'kiosk4-shift',
  },
  {
    screen: 'orders',
    label: 'Печать заказов',
    hint: 'Стикер на сшитую вещь',
    scene: 'kiosk4-orders',
  },
  {
    screen: 'cutterSheet',
    label: 'Печать закройщиков',
    hint: 'Лист с бирками к стеку',
    scene: 'kiosk4-cutter-sheet',
  },
  {
    screen: 'reviews',
    label: 'Отзывы',
    hint: 'Что написали покупатели',
    scene: 'kiosk4-reviews',
  },
  {
    screen: 'rolls',
    label: 'Работа с рулонами',
    hint: 'Ткань на стеллаже',
    scene: 'kiosk4-rolls',
  },
  {
    screen: 'unlabeled',
    label: 'Товар без стикера',
    hint: 'Найти вещь без бирки',
    scene: 'kiosk4-unlabeled',
  },
  {
    screen: 'defect',
    label: 'Брак из рулона',
    hint: 'Испорченный кусок ткани',
    scene: 'kiosk4-defect',
  },
  {
    screen: 'repack',
    label: 'Перепаковка',
    hint: 'Годная вещь, мятая упаковка',
    scene: 'kiosk4-repack',
  },
  {
    screen: 'flyer',
    label: 'Стикер на листовку',
    hint: 'Наклейка состава на вкладыш',
    scene: 'kiosk4-flyer',
  },
  {
    screen: 'vacation',
    label: 'Отпуск',
    hint: 'Даты, когда вас не будет',
    scene: 'kiosk4-vacation',
  },
];

/** Главное меню терминала — крупные плитки под сенсорный экран. */
const KioskMenu = ({
  onSelect,
  role,
  repackCount = 0,
  returnsPackerOnShift = null,
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

  const visibleTiles = tiles.filter((t) => !hidden.includes(t.screen));

  return (
    <div className="grid grid-cols-3 gap-2">
      {visibleTiles.map((t) => (
        <KioskTile
          key={t.screen}
          label={t.label}
          hint={t.hint}
          scene={t.scene}
          count={t.screen === 'repack' && repackCount > 0 ? repackCount : null}
          onClick={() => onSelect(t.screen)}
        />
      ))}
    </div>
  );
};

/** Плитка терминала в том же виде, что станция склада товара: сцена, название, табло. */
const KioskTile = ({
  label,
  hint,
  scene,
  count,
  onClick,
}: {
  label: string;
  hint: string;
  scene: string;
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
      className={`group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#f7f4ee] text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        pressed ? 'scale-[0.98]' : ''
      } ${count != null ? 'border-violet-200' : 'border-border'}`}
    >
      <div className="relative h-24 w-full shrink-0 overflow-hidden bg-[#f4efe6] sm:h-28">
        <SceneImage name={scene} sizes="33vw" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight sm:text-base">{label}</p>
          <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{hint}</p>
        </div>
        {count != null && <LiveCountBoard value={count} tone="violet" />}
      </div>
    </button>
  );
};

export default KioskMenu;