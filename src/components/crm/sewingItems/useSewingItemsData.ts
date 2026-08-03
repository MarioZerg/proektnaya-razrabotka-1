import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, fetchWorkshopDetail, type Workshop } from '@/lib/workshopsApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
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

  const isCutter = user?.role === 'cutter';
  const isSewer = user?.role === 'sewer';
  const isPacker = user?.role === 'packer';
  const isProductionRole = isSewer || isCutter || isPacker;

  // Конвейер по ролям:
  //  - закройщик: На раскрое (свои, берёт стеком) → Раскроено → Готовые
  //  - швея: НЕТ вкладки "На раскрое" (это этап закройщика) — В работе (свои) →
  //    Раскроено (очередь, откуда берёт заказ) → Стикеровка (только просмотр, отправила и всё) → Готовые
  //  - упаковщица: НЕТ вкладки "На раскрое" — видит Раскроено (весь материал всех
  //    закройщиков), В работе (ВСЕ заказы всех швей), Стикеровка (свой этап), Готовые
  //  - админ/кладовщик: видят всё, включая "Новый"
  const visibleTabs = useMemo(() => {
    if (isSewer || isPacker) return statusTabs.filter((t) => t.value !== 'Новый' && t.value !== 'На раскрое');
    if (isCutter) return statusTabs.filter((t) => t.value !== 'Новый');
    return statusTabs;
  }, [isSewer, isPacker, isCutter]);

  // Цех/смена ТЕКУЩЕЙ открытой рабочей смены (может отличаться от штатных в гостевом
  // режиме) — именно они используются для взятия стека и фильтрации доступных рулонов,
  // чтобы сотрудник в гостях работал с материалами той смены, куда зашёл.
  const effectiveWorkshopId = user?.activeWorkshopId ?? user?.workshopId ?? null;
  const effectiveShiftNumber = user?.activeShiftNumber ?? user?.shiftNumber ?? null;

  const load = () => {
    setLoading(true);
    Promise.all([fetchOrders(), fetchEmployees(), fetchMaterialsData(), fetchWorkshops(), fetchRolls({ status: 'in_workshop' })])
      .then(([ordersData, employeesData, materialsData, workshopsData, rollsData]) => {
        setOrders(ordersData);
        setEmployees(employeesData);
        // Фильтр материалов на конвейере — это фильтр по заказам, а заказ всегда шьётся из
        // ткани (material_types.name === 'Тюль'), поэтому в выпадающем списке нужна только
        // ткань — тесьма/пакеты/этикетки тут никогда не встретятся и только мешают поиску.
        const fabricTypeId = materialsData.types.find((t) => t.name === 'Тюль')?.id;
        setMaterials(fabricTypeId ? materialsData.materials.filter((m) => m.typeId === fabricTypeId) : materialsData.materials);
        setWorkshops(workshopsData);
        setRolls(rollsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Настройка "печать листа закройщика при взятии стека" — читается из настроек ТЕКУЩЕГО
  // цеха закройщика (переопределение цеха или глобальное значение). По умолчанию включена.
  useEffect(() => {
    if (!isCutter || !effectiveWorkshopId) return;
    fetchWorkshopDetail(effectiveWorkshopId).then((w) => {
      setPrintQrCuttingEnabled((w.settings.print_qr_cutting?.value ?? w.settings.print_qr_cutting?.global ?? 'enabled') !== 'disabled');
    });
  }, [isCutter, effectiveWorkshopId]);

  return {
    user,
    orders,
    employees,
    materials,
    workshops,
    rolls,
    loading,
    load,
    printQrCuttingEnabled,
    isCutter,
    isSewer,
    isPacker,
    isProductionRole,
    visibleTabs,
    effectiveWorkshopId,
    effectiveShiftNumber,
  };
};