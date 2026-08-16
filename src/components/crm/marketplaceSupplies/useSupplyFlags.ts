import { supplyStatusFlow, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { useAuth } from '@/context/AuthContext';

/**
 * Режимы отображения и права по карточке поставки.
 *
 * Вынесено из страницы 1:1 — те же условия, тот же порядок вычислений. Логика
 * намеренно не менялась: она определяет, что кладовщик и менеджер могут делать
 * с поставкой.
 */
export const useSupplyFlags = (supply: SupplyDetail) => {
  const { user } = useAuth();

  const isWbFbs = supply.marketplace === 'WB' && supply.type === 'FBS';
  // Для WB FBS сборка и передача в доставку выполняются кнопками на карточке WB (они
  // синхронизируются с WildBerries), поэтому ручной переход статуса в шапке скрыт —
  // остаётся только финальное «Отметить выполненной» после отгрузки.
  const rawNextStatus = supplyStatusFlow[supplyStatusFlow.indexOf(supply.status) + 1];
  const nextStatus = isWbFbs && rawNextStatus !== 'Выполнена' ? undefined : rawNextStatus;
  // FBS-поставку собирает кладовщик — он сканирует товары со своих полок. Менеджер такую
  // поставку только НАБЛЮДАЕТ в реальном времени: сборка идёт на складе, а не за его столом,
  // поэтому редактирование состава ему недоступно. FBO-поставки менеджера это не касается —
  // там товарный состав ведёт именно он.
  const isManagerRole = user?.role === 'manager';
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const canEditItems =
    (supply.status === 'Открытая' || supply.status === 'На сборке') &&
    !(isManagerRole && supply.type === 'FBS');
  // Удалять товар из FBS-поставки кладовщику нельзя: вещь уже отстикерована ярлыком
  // маркетплейса и учтена на площадке. Ошибочное удаление рвёт связь с отправлением и
  // отправляет вещь на полку, хотя покупатель её ждёт. Убрать позицию может только
  // администратор; отменённые заказы кладовщик кладёт на полку отдельной кнопкой.
  const canRemoveItems =
    canEditItems && !(supply.type === 'FBS' && !isManager);

  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  // WB FBO: данные поставки заполняются вручную (у WB нет API заявок FBO), но грузоперевозку
  // так же везём через Газельку — поэтому показываем тот же блок Газельки, что и у OZON FBO.
  const isWbFbo = supply.marketplace === 'WB' && supply.type === 'FBO';
  // Права по ролям для OZON FBO: менеджер (и админ) управляет заявкой Газельки, синхронизацией
  // и загрузкой товарного состава в пошив. Кладовщик — только печать стикеров, и только после
  // того как менеджер выбрал заявку Газельки и синхронизировал данные (появился ID отгрузки).
  const gazelkaReady = !!supply.gazelkaPlanId && !!supply.gazelkaId;

  const nextStatusLabel: Record<string, string> = {
    'На сборке': 'Взять на сборку',
    Отгрузка: supply.type === 'FBS' ? 'Закрыть поставку и передать в доставку' : 'Отгрузить в Газельку',
    Выполнена: 'Отметить выполненной',
  };

  return {
    isWbFbs,
    nextStatus,
    isManagerRole,
    isManager,
    canEditItems,
    canRemoveItems,
    isOzonFbo,
    isWbFbo,
    gazelkaReady,
    nextStatusLabel,
  };
};

export default useSupplyFlags;
