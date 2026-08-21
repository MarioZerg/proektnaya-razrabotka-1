import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, fetchWorkshopDetail, type Workshop } from '@/lib/workshopsApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { fetchEmployeeShifts } from '@/lib/shiftSessionsApi';
import { statusTabs } from '@/components/crm/sewingItems/sewingItemsShared';

/** Данные страницы "Товары для пошива": роль пользователя, список заказов и справочников,
 * загрузка/перезагрузка, а также настройка печати листа закройщика. */
export const useSewingItemsData = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);
  const [printQrCuttingEnabled, setPrintQrCuttingEnabled] = useState(true);
  // Штраф за отмену заказа из настроек цеха — показываем сотруднику в подтверждении,
  // чтобы он видел сумму ДО отмены, а не узнавал о списании из расчётки.
  const [cancelOrderPenalty, setCancelOrderPenalty] = useState(0);
  // ID материалов (тканей), присущих цеху закройщика — фильтр тканей на конвейере для него
  // ограничивается только этими материалами (из настроек цеха). null = ограничения нет.
  const [allowedMaterialIds, setAllowedMaterialIds] = useState<number[] | null>(null);

  const isCutter = user?.role === 'cutter';
  const isSewer = user?.role === 'sewer';
  const isPacker = user?.role === 'packer';
  const isProductionRole = isSewer || isCutter || isPacker;

  // Конвейер по ролям:
  //  - закройщик: На раскрое (свои, берёт стеком) → Раскроено → Готовые
  //  - швея: НЕТ вкладок "На раскрое" (этап закройщика) и "Раскроено" — В работе (свои) →
  //    Стикеровка (только просмотр, отправила и всё) → Готовые.
  //    «Раскроено» швее не показываем: выбрать оттуда заказ она всё равно не может —
  //    очередь раздаёт кнопка «Получить новый заказ» строго по времени заказа покупателя.
  //    Вкладка была только витриной чужой работы и путала: швея видела вещи, которые
  //    ей не достанутся.
  //  - упаковщица: НЕТ вкладки "На раскрое" — видит Раскроено (весь материал всех
  //    закройщиков), В работе (ВСЕ заказы всех швей), Стикеровка (свой этап), Готовые
  //  - админ/кладовщик: видят всё, включая "Новый"
  //
  // Вкладку «Со склада» производственникам не показываем совсем: это заказы,
  // закрытые готовой вещью с полки — шить и кроить там нечего. Их собирает
  // кладовщик, а швее они только засоряют конвейер.
  const visibleTabs = useMemo(() => {
    if (isSewer) {
      return statusTabs.filter(
        (t) =>
          t.value !== 'Новый' &&
          t.value !== 'На раскрое' &&
          t.value !== 'Раскроено' &&
          t.value !== 'Со склада'
      );
    }
    if (isPacker) {
      return statusTabs.filter(
        (t) => t.value !== 'Новый' && t.value !== 'На раскрое' && t.value !== 'Со склада'
      );
    }
    if (isCutter) {
      return statusTabs.filter((t) => t.value !== 'Новый' && t.value !== 'Со склада');
    }
    return statusTabs;
  }, [isSewer, isPacker, isCutter]);

  // Цех/смена ТЕКУЩЕЙ открытой рабочей смены (может отличаться от штатных в гостевом
  // режиме) — именно они используются для взятия стека и фильтрации доступных рулонов,
  // чтобы сотрудник в гостях работал с материалами той смены, куда зашёл.
  //
  // Смену спрашиваем у сервера прямо здесь, а не полагаемся только на данные входа:
  // гость открывает смену в чужом цехе на терминале, а на сайте в его сессии остаётся
  // штатный цех. Из-за этого в списке рулонов тесьмы у гостя было пусто — он видел
  // материалы своего цеха, которых рядом с ним физически нет.
  const [sessionWorkshopId, setSessionWorkshopId] = useState<number | null>(null);
  const [sessionShiftNumber, setSessionShiftNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchEmployeeShifts()
      .then((list) => {
        const mine = list.find((e) => e.id === user.id);
        if (mine?.isOpen) {
          setSessionWorkshopId(mine.sessionWorkshopId);
          setSessionShiftNumber(mine.sessionShiftNumber);
        }
      })
      .catch(() => {
        // Нет связи — работаем по данным входа, они уже есть в сессии.
      });
  }, [user?.id]);

  const effectiveWorkshopId =
    sessionWorkshopId ?? user?.activeWorkshopId ?? user?.workshopId ?? null;
  const effectiveShiftNumber =
    sessionShiftNumber ?? user?.activeShiftNumber ?? user?.shiftNumber ?? null;

  const load = () => {
    setLoading(true);
    // forUserId — сервер отдаёт рулоны ТОЛЬКО цеха и смены текущей открытой смены
    // сотрудника и только «его» типа материала (швея — тесьма, закройщик — ткань).
    // Раньше тянулся общий список: он обрезается по лимиту свежими рулонами, и тесьма
    // чужого цеха в него не попадала — швея-гость не могла указать тесьму совсем.
    // Каждый справочник идёт сам по себе: в цехе связь моргает, и раньше единственный
    // недошедший запрос оставлял конвейер полностью пустым.
    fetchEmployees().then(setEmployees).catch(() => {});
    fetchMaterialsData()
      .then((materialsData) => {
        // Фильтр материалов на конвейере — это фильтр по заказам, а заказ всегда шьётся из
        // ткани (material_types.name === 'Тюль'), поэтому в выпадающем списке нужна только
        // ткань — тесьма/пакеты/этикетки тут никогда не встретятся и только мешают поиску.
        const fabricTypeId = materialsData.types.find((t) => t.name === 'Тюль')?.id;
        setMaterials(fabricTypeId ? materialsData.materials.filter((m) => m.typeId === fabricTypeId) : materialsData.materials);
      })
      .catch(() => {});
    fetchWorkshops().then(setWorkshops).catch(() => {});
    fetchRolls(
      isProductionRole && user?.id
        ? // Роль передаём ЯВНО — ту, в которой человек сейчас в приложении.
          // У совместителя (швея + закройщик) в открытой смене может стоять
          // другая должность, и тогда швее подбирался материал закройщика:
          // тюль вместо тесьмы, а выбрать рулон было не из чего.
          { status: 'in_workshop', forUserId: user.id, forRole: user.role }
        : { status: 'in_workshop' }
    )
      .then(setRolls)
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу — списку заказов.
    fetchOrders()
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isProductionRole]);

  // Настройка "печать листа закройщика при взятии стека" + список материалов цеха —
  // читаются из настроек ТЕКУЩЕГО цеха сотрудника. Ткани в фильтре ограничиваем
  // материалами его цеха (allowedMaterials из настроек).
  useEffect(() => {
    // Ткани цеха нужны ВСЕМ производственным ролям, а не только закройщику: швея и
    // упаковщица работают в том же цехе и не должны видеть в фильтре чужие материалы.
    if (!isProductionRole || !effectiveWorkshopId) {
      setAllowedMaterialIds(null);
      return;
    }
    fetchWorkshopDetail(effectiveWorkshopId).then((w) => {
      setPrintQrCuttingEnabled((w.settings.print_qr_cutting?.value ?? w.settings.print_qr_cutting?.global ?? 'enabled') !== 'disabled');
      setAllowedMaterialIds(w.allowedMaterials || []);
      const penaltyRaw = w.settings.cancel_order_penalty?.value ?? w.settings.cancel_order_penalty?.global;
      setCancelOrderPenalty(Number(penaltyRaw) || 0);
    });
  }, [isProductionRole, effectiveWorkshopId]);

  // Итоговый список тканей: у производственных ролей — только материалы их цеха,
  // у админа/менеджера/кладовщика — все ткани (они работают со всеми цехами).
  const visibleMaterials = useMemo(() => {
    if (isProductionRole && allowedMaterialIds) {
      const allowed = new Set(allowedMaterialIds);
      return materials.filter((m) => allowed.has(m.id));
    }
    return materials;
  }, [isProductionRole, allowedMaterialIds, materials]);

  // Сотрудники в фильтре для производственных ролей: только СВОЙ цех и только те
  // должности, что работают на конвейере.
  //
  // Раньше в списке были все подряд — админы, кладовщики, менеджеры и сотрудники
  // чужого цеха, хотя заказов за ними в этом цехе нет и быть не может. Искать в
  // таком списке неудобно.
  //
  // Должности оставляем все производственные, а не только свою: упаковщица
  // фильтрует заказы по ШВЕЯМ (видит, кто что отшил), и список одних упаковщиц был
  // бы для неё бесполезен.
  const visibleEmployees = useMemo(() => {
    if (!isProductionRole) return employees;
    const workshopName = workshops.find((w) => w.id === effectiveWorkshopId)?.name;
    const shopRoles = ['sewer', 'cutter', 'packer'];
    return employees.filter(
      (e) =>
        shopRoles.includes(e.role) &&
        e.isActive &&
        (!workshopName || e.workshop === workshopName)
    );
  }, [isProductionRole, employees, workshops, effectiveWorkshopId]);

  return {
    user,
    orders,
    employees: visibleEmployees,
    materials: visibleMaterials,
    workshops,
    rolls,
    loading,
    load,
    printQrCuttingEnabled,
    cancelOrderPenalty,
    isCutter,
    isSewer,
    isPacker,
    isProductionRole,
    visibleTabs,
    effectiveWorkshopId,
    effectiveShiftNumber,
  };
};