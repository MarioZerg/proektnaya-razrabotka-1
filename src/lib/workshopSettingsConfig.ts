import { marketplaceClusters } from '@/lib/marketplaceClusters';

export type SettingFieldType = 'time' | 'text' | 'number' | 'select';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingConfigItem {
  key: string;
  label: string;
  type: SettingFieldType;
  options?: SettingOption[];
}

const yesNoOptions: SettingOption[] = [
  { value: 'true', label: 'Да' },
  { value: 'false', label: 'Нет' },
];

/** Настройки цеха, которые видит и меняет админ.
 *
 * Ключи маркетплейсов (WB/OZON) здесь НЕ дублируются — они живут в разделе «Интеграции».
 * Лимиты остатка для закрытия рулонов настраиваются в разделе «Рулоны».
 */
export const workshopSettingsConfig: SettingConfigItem[] = [
  { key: 'working_day_start', label: 'Начало рабочего дня', type: 'time' },
  { key: 'working_day_end', label: 'Конец рабочего дня (позже смену не открыть)', type: 'time' },
  {
    key: 'is_enabled_work_schedule',
    label: 'Соблюдать расписание рабочего дня?',
    type: 'select',
    options: yesNoOptions,
  },
  { key: 'max_quantity_orders_to_seamstress', label: 'Макс. заказов у швеи (в работе + на стикеровке)', type: 'number' },
  {
    key: 'orders_priority',
    label: 'Порядок заказов',
    type: 'select',
    options: [
      { value: 'ozon_first', label: 'Сначала OZON' },
      { value: 'wb_first', label: 'Сначала WB' },
      { value: 'yandex_first', label: 'Сначала Яндекс.Маркет' },
      { value: 'by_date', label: 'По дате заказа' },
    ],
  },
  { key: 'late_opened_shift_penalty', label: 'Штраф за опоздание, руб.', type: 'number' },
  { key: 'unclosed_shift_penalty', label: 'Штраф за не закрытую смену, руб.', type: 'number' },
  { key: 'max_quantity_orders_to_cutter', label: 'Макс. заказов у закройщика', type: 'number' },
  { key: 'cutter_daily_limit', label: 'Метраж в день у закройщика, м', type: 'number' },
  { key: 'cancel_order_penalty', label: 'Штраф за отмену заказа, руб.', type: 'number' },
  { key: 'seamstress_daily_limit', label: 'Метраж в день у швеи, м', type: 'number' },
  { key: 'max_quantity_orders_without_timeout', label: 'Заказов без задержки (в начале смены)', type: 'number' },
  { key: 'timeout_200', label: 'Таймаут на 200 см, сек', type: 'number' },
  { key: 'timeout_300', label: 'Таймаут на 300 см, сек', type: 'number' },
  { key: 'timeout_400', label: 'Таймаут на 400 см, сек', type: 'number' },
  { key: 'timeout_500', label: 'Таймаут на 500 см, сек', type: 'number' },
  { key: 'timeout_600', label: 'Таймаут на 600 см, сек', type: 'number' },
  { key: 'timeout_700', label: 'Таймаут на 700 см, сек', type: 'number' },
  { key: 'timeout_800', label: 'Таймаут на 800 см, сек', type: 'number' },
  {
    key: 'print_qr_cutting',
    label: 'QR-код на листе закройщика',
    type: 'select',
    options: [
      { value: 'enabled', label: 'Включен' },
      { value: 'disabled', label: 'Выключен' },
    ],
  },
  {
    key: 'sticking_otk',
    label: 'Стикеровка упаковщиком',
    type: 'select',
    options: [
      { value: 'scanner', label: 'Разрешена' },
      { value: 'forbidden', label: 'Запрещена' },
    ],
  },
  {
    key: 'sticking_seamstress',
    label: 'Стикеровка швеей',
    type: 'select',
    options: [
      { value: 'scanner', label: 'Разрешена' },
      { value: 'forbidden', label: 'Запрещена' },
    ],
  },
  {
    key: 'orders_filter',
    label: 'Фильтр заказов',
    type: 'select',
    options: [
      { value: 'all', label: 'Все' },
      { value: 'fbo', label: 'Только FBO' },
      { value: 'fbs', label: 'Только FBS' },
    ],
  },
  {
    key: 'orders_cluster_priority',
    label: 'Приоритетный FBO-кластер',
    type: 'select',
    options: marketplaceClusters.map((c) => ({ value: c, label: c })),
  },
  { key: 'max_fabric_rolls_per_shift', label: 'Макс. рулонов ткани на смену, шт', type: 'number' },
  {
    key: 'floating_schedule',
    label: 'Плавающий график (например 2/2)',
    type: 'select',
    options: yesNoOptions,
  },
];