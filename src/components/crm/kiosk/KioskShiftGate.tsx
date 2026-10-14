import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import {
  fetchOpenShiftOptions,
  type KioskUser,
  type KioskShift,
  type OpenShiftWorkshop,
} from '@/lib/kioskApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

/** Подписи и иконки должностей, в которых выходят в цех. Тексты простые: сотрудник
 * должен узнать свою работу с одного взгляда, не вчитываясь. */
const ROLE_LABELS: Record<string, { label: string; hint: string; icon: string }> = {
  cutter: { label: 'Закройщик', hint: 'работаю с тканью', icon: 'Scissors' },
  sewer: { label: 'Швея', hint: 'работаю с тесьмой', icon: 'Shirt' },
  packer: { label: 'Упаковщик', hint: 'пакеты и этикетки', icon: 'Package' },
  packer_returns: { label: 'Упаковщица-возвраты', hint: 'перепаковка возвратов', icon: 'PackageOpen' },
};

interface KioskShiftGateProps {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  shiftSaving: boolean;
  onEnterMenu: () => void;
  /** Открыть смену в выбранном цехе, смене и должности. */
  onOpenShift: (
    workshopId: number | null,
    shiftNumber: number | null,
    role: string | null
  ) => void;
  onLogout: () => void;
}

/** Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
 * как сотрудник открыл смену и нажал «Войти в терминал».
 *
 * Цех один — на экране его не выбираем и не показываем. Остаётся выбор смены
 * (и должности, если админ разрешил несколько).
 */
const KioskShiftGate = ({
  user,
  shift,
  workshopId,
  shiftSaving,
  onEnterMenu,
  onOpenShift,
  onLogout,
}: KioskShiftGateProps) => {
  const [workshops, setWorkshops] = useState<OpenShiftWorkshop[]>([]);
  const [workshopsError, setWorkshopsError] = useState<string | null>(null);
  const [selectedWorkshop, setSelectedWorkshop] = useState<number | null>(
    Number(workshopId) || null
  );
  const [selectedShift, setSelectedShift] = useState<number | null>(null);
  // Должность на сегодня. В цехе многие совмещают: Мария числится закройщиком, но
  // часто шьёт. От должности зависит, какой материал покажет терминал — закройщику
  // ткань, швее тесьму. Раньше смена всегда открывалась по должности из карточки,
  // и швея не видела ни одного рулона тесьмы, из-за чего не могла закрыть заказ.
  const [selectedRole, setSelectedRole] = useState<string>(user.role);

  // Выбор показываем только тем, кому админ разрешил больше одной должности.
  // Остальным лишняя кнопка на экране только мешает.
  const roleChoices = (user.allowedRoles || []).filter((r) => ROLE_LABELS[r]);
  const showRoleChoice = roleChoices.length > 1;

  const loadWorkshops = () => {
    fetchOpenShiftOptions()
      .then((list) => {
        setWorkshopsError(null);
        setWorkshops(list);
        // Цех фиксируем с терминала (или единственный из списка) — выбора на экране нет.
        const fallback = Number(workshopId) || list[0]?.id || null;
        const current = list.find((w) => w.id === fallback) || list[0];
        setSelectedWorkshop(current?.id ?? null);
        const shifts = current?.shifts || [];
        setSelectedShift(
          user.shiftFromCode && shifts.includes(user.shiftFromCode)
            ? user.shiftFromCode
            : (shifts[0] ?? null)
        );
      })
      .catch((e) => {
        setWorkshopsError(e instanceof Error ? e.message : 'Не удалось загрузить смены');
      });
  };

  useEffect(() => {
    if (shift?.isOpen) return;
    loadWorkshops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift?.isOpen, workshopId, user.shiftFromCode]);

  const currentWorkshop = workshops.find((w) => w.id === selectedWorkshop);
  const availableShifts = currentWorkshop?.shifts || [];

  return (
    <div className="kiosk-root flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <KioskIdleTimer onTimeout={onLogout} />
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Приветствую, {user.name}!</h1>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-muted-foreground">Смена:</span>
          {shift?.isOpen ? (
            <Badge className="bg-emerald-600 text-base text-white hover:bg-emerald-600">
              Открыта{shift.shiftNumber != null ? ` · №${shift.shiftNumber}` : ''}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-base">
              Закрыта
            </Badge>
          )}
        </div>

        {shift?.isOpen ? (
          // Закрытие смены доступно внутри терминала (плитка «Открытие / Закрытие смены»),
          // поэтому здесь только вход.
          <Button
            size="lg"
            className="h-20 w-full bg-blue-600 text-xl text-white hover:bg-blue-700"
            onClick={onEnterMenu}
          >
            <Icon name="LayoutGrid" size={28} className="mr-2" />
            Войти в терминал
          </Button>
        ) : (
          <>
            {workshopsError && (
              <WarehouseFetchError
                title="Не удалось загрузить смены"
                description={workshopsError}
                onRetry={loadWorkshops}
              />
            )}

            {showRoleChoice && (
              <div className="space-y-2">
                <p className="text-center text-base text-muted-foreground">
                  Кем работаете сегодня?
                </p>
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                  {roleChoices.map((r) => (
                    <Button
                      key={r}
                      variant={selectedRole === r ? 'default' : 'outline'}
                      className="h-auto flex-col gap-1 py-3"
                      onClick={() => setSelectedRole(r)}
                    >
                      <Icon name={ROLE_LABELS[r].icon} size={26} />
                      <span className="text-lg font-semibold">{ROLE_LABELS[r].label}</span>
                      <span className="text-xs font-normal opacity-80">
                        {ROLE_LABELS[r].hint}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {availableShifts.length > 1 && (
              <div className="space-y-2">
                <p className="text-center text-base text-muted-foreground">Смена</p>
                <div className="grid grid-cols-3 gap-2">
                  {availableShifts.map((n) => (
                    <Button
                      key={n}
                      variant={selectedShift === n ? 'default' : 'outline'}
                      className="h-16 text-lg"
                      onClick={() => setSelectedShift(n)}
                    >
                      №{n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button
              size="lg"
              className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
              onClick={() =>
                onOpenShift(
                  selectedWorkshop,
                  selectedShift,
                  showRoleChoice ? selectedRole : null
                )
              }
              disabled={shiftSaving || !!workshopsError}
            >
              <Icon
                name={shiftSaving ? 'Loader2' : 'Play'}
                size={28}
                className={`mr-2 ${shiftSaving ? 'animate-spin' : ''}`}
              />
              Открыть смену
            </Button>
          </>
        )}

        <Button variant="outline" size="lg" className="h-14 w-full" onClick={onLogout}>
          Выход
        </Button>
      </div>
    </div>
  );
};

export default KioskShiftGate;
