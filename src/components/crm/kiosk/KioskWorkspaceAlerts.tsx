import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface Props {
  /** Данные об опоздании — показываем во весь экран сразу после открытия смены. */
  lateInfo: { minutes: number; penalty: number; start: string | null } | null;
  onDismissLate: () => void;
  /** Сообщение о том, что смену нельзя закрыть из-за незавершённых заказов. */
  closeBlocked: string;
  onDismissCloseBlocked: () => void;
  onGoToOrders: () => void;
}

/**
 * Окна во весь экран: опоздание и запрет закрыть смену.
 *
 * Оба случая касаются денег сотрудника и его работы, поэтому показываются
 * поверх всего: на планшете в цеху маленькое уведомление внизу экрана легко
 * пропустить — человек стоит в метре от него и смотрит на свои руки.
 */
const KioskWorkspaceAlerts = ({
  lateInfo,
  onDismissLate,
  closeBlocked,
  onDismissCloseBlocked,
  onGoToOrders,
}: Props) => (
  <>
    {/* Опоздание. Смену открыть дали — работа важнее, но человек должен увидеть,
        на сколько опоздал и что за это удержано. Во весь экран: на планшете в цеху
        маленькое уведомление легко пропустить. */}
    {lateInfo && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
        <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6 text-center">
          <Icon name="Clock" size={48} className="mx-auto text-amber-600" />
          <p className="text-2xl font-bold">Вы опоздали</p>
          <p className="font-mono-tech text-5xl font-bold text-amber-600">
            {lateInfo.minutes >= 60
              ? `${Math.floor(lateInfo.minutes / 60)} ч ${lateInfo.minutes % 60} мин`
              : `${lateInfo.minutes} мин`}
          </p>
          {lateInfo.start && (
            <p className="text-base text-muted-foreground">
              Смена начинается в {lateInfo.start}
            </p>
          )}
          {lateInfo.penalty > 0 && (
            <p className="text-lg font-medium">
              Удержано {lateInfo.penalty.toLocaleString('ru-RU')} ₽
            </p>
          )}
          <Button size="lg" className="h-16 w-full text-lg" onClick={onDismissLate}>
            Понятно, начать работу
          </Button>
        </div>
      </div>
    )}

    {/* Смену не дали закрыть: за швеёй или закройщиком ещё числятся заказы, а у
        упаковщицы не разобрана очередь стикеровки по цеху. Показываем это во весь
        экран — на планшете в цеху всплывашку легко не заметить. */}
    {closeBlocked && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
        <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6">
          <div className="flex items-start gap-3">
            <Icon name="TriangleAlert" size={32} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="text-2xl font-bold">Смену закрыть нельзя</p>
              <p className="mt-1 text-base text-muted-foreground">{closeBlocked}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="h-16 flex-1 text-lg" onClick={onGoToOrders}>
              <Icon name="ClipboardList" size={22} className="mr-2" />
              Мои заказы
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-16 flex-1 text-lg"
              onClick={onDismissCloseBlocked}
            >
              Понятно
            </Button>
          </div>
        </div>
      </div>
    )}
  </>
);

export default KioskWorkspaceAlerts;
