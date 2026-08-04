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

export const workshopSettingsConfig: SettingConfigItem[] = [
  { key: 'working_day_start', label: 'Начало рабочего дня', type: 'time' },
  { key: 'working_day_end', label: 'Конец рабочего дня', type: 'time' },
  { key: 'is_enabled_work_schedule', label: 'Расписание включено?', type: 'select', options: yesNoOptions },
  { key: 'api_key_wb', label: 'WB api key', type: 'text' },
  { key: 'api_key_ozon', label: 'OZON api key', type: 'text' },
  { key: 'seller_id_ozon', label: 'OZON seller id', type: 'text' },
  { key: 'max_quantity_orders_to_seamstress', label: 'Макс. кол-во заказов у швеи', type: 'number' },
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
  { key: 'late_opened_shift_penalty', label: 'Штраф за опоздание', type: 'number' },
  { key: 'unclosed_shift_penalty', label: 'Штраф за не закрытую смену', type: 'number' },
  { key: 'is_enabled_work_shift', label: 'Функционал смен включен?', type: 'select', options: yesNoOptions },
  { key: 'max_quantity_orders_to_cutter', label: 'Макс. кол-во заказов у закройщика', type: 'number' },
  { key: 'cutter_daily_limit', label: 'Метраж в день у закройщика', type: 'number' },
  { key: 'cancel_order_penalty', label: 'Штраф за отмену заказа', type: 'number' },
  { key: 'seamstress_daily_limit', label: 'Метраж в день у швеи', type: 'number' },
  { key: 'max_quantity_orders_without_timeout', label: 'Макс. кол-во заказов без таймаута', type: 'number' },
  { key: 'timeout_200', label: 'Таймаут на 200', type: 'number' },
  { key: 'timeout_300', label: 'Таймаут на 300', type: 'number' },
  { key: 'timeout_400', label: 'Таймаут на 400', type: 'number' },
  { key: 'timeout_500', label: 'Таймаут на 500', type: 'number' },
  { key: 'timeout_600', label: 'Таймаут на 600', type: 'number' },
  { key: 'timeout_700', label: 'Таймаут на 700', type: 'number' },
  { key: 'timeout_800', label: 'Таймаут на 800', type: 'number' },
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
      { value: 'scanner', label: 'Сканером по QR-коду' },
      { value: 'manual', label: 'Вручную по фильтру' },
      { value: 'forbidden', label: 'Запрещена' },
    ],
  },
  {
    key: 'sticking_seamstress',
    label: 'Стикеровка швеей',
    type: 'select',
    options: [
      { value: 'scanner', label: 'Сканером по QR-коду' },
      { value: 'manual', label: 'Вручную по фильтру' },
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
  { key: 'max_fabric_rolls_per_shift', label: 'Макс. рулонов ткани на смену', type: 'number' },
  {
    key: 'min_remaining_to_close_fabric',
    label: 'Мин. остаток для закрытия рулона тюля (м)',
    type: 'number',
  },
  {
    key: 'min_remaining_to_close_trim',
    label: 'Мин. остаток для закрытия рулона тесьмы (м)',
    type: 'number',
  },
  {
    key: 'floating_schedule',
    label: 'Плавающий график (например 2/2)',
    type: 'select',
    options: yesNoOptions,
  },
];