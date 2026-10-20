import type { WaybillDocument, WaybillEditableFields } from '@/lib/waybillApi';

export type FieldType = 'text' | 'date' | 'number' | 'datetime-local';

/** Поля формы по разделам Приложения № 4 — порядок тот же, что в бумаге. */
export const FIELDS: {
  key: keyof WaybillEditableFields;
  label: string;
  group: string;
  type?: FieldType;
  hint?: string;
  wide?: boolean;
}[] = [
  { key: 'number', label: 'Номер накладной', group: 'Документ' },
  { key: 'docDate', label: 'Дата накладной', group: 'Документ', type: 'date' },
  { key: 'orderNumber', label: 'Заказ (заявка) №', group: 'Документ', hint: 'Номер заявки Газельки' },
  { key: 'orderDate', label: 'Дата заявки', group: 'Документ', type: 'date' },
  { key: 'copyNumber', label: 'Экземпляр №', group: 'Документ', type: 'number' },

  { key: 'shipperDetails', label: '1. Грузоотправитель (мы)', group: 'Стороны', wide: true, hint: 'Наименование, ИНН, адрес, телефон одной строкой' },
  { key: 'consigneeDetails', label: '2. Грузополучатель', group: 'Стороны', wide: true, hint: 'Юрлицо маркетплейса с ИНН и адресом' },
  { key: 'deliveryAddress', label: 'Адрес места доставки', group: 'Стороны', wide: true },
  { key: 'customerDetails', label: '1а. Заказчик услуг перевозки', group: 'Стороны', wide: true, hint: 'Если перевозку организует посредник — иначе оставьте пустым' },
  { key: 'customerContract', label: 'Договор с заказчиком услуг', group: 'Стороны' },

  { key: 'cargoName', label: 'Наименование груза', group: '3. Груз', wide: true },
  { key: 'cargoPlaces', label: 'Количество мест, тара', group: '3. Груз', hint: 'Например: 9 коробов' },
  { key: 'cargoWeight', label: 'Масса груза', group: '3. Груз', wide: true, hint: 'Например: Места БРУТТО 120 кг (определено взвешиванием)' },
  { key: 'cargoValue', label: 'Объявленная стоимость', group: '3. Груз' },
  { key: 'accompanyingDocs', label: '4. Сопроводительные документы', group: '3. Груз', wide: true },

  { key: 'carrierDetails', label: '6. Перевозчик', group: 'Перевозчик и машина', wide: true, hint: 'Реквизиты Газельки или другого перевозчика' },
  { key: 'driverDetails', label: 'Водитель', group: 'Перевозчик и машина', wide: true, hint: 'ФИО, паспорт, телефон' },
  { key: 'vehicleDetails', label: '7. Транспортное средство', group: 'Перевозчик и машина', wide: true, hint: 'Тип, марка, грузоподъёмность' },
  { key: 'vehicleNumber', label: 'Госномер', group: 'Перевозчик и машина' },
  { key: 'vehicleOwnership', label: 'Тип владения (1–5)', group: 'Перевозчик и машина', type: 'number', hint: '1 собственность, 3 аренда, 4 лизинг, 5 безвозмездно' },

  { key: 'loaderDetails', label: 'Кто грузит', group: '8. Приём груза', wide: true },
  { key: 'loadingAddress', label: 'Адрес погрузки', group: '8. Приём груза', wide: true },
  { key: 'plannedLoadingAt', label: 'Подача машины под погрузку', group: '8. Приём груза', type: 'datetime-local' },
  { key: 'loadingWeight', label: 'Масса при погрузке', group: '8. Приём груза', wide: true },
  { key: 'loadingPlaces', label: 'Мест при погрузке', group: '8. Приём груза' },
  { key: 'packaging', label: 'Тара, упаковка', group: '8. Приём груза', wide: true },
  { key: 'loaderSignature', label: 'Подпись от нас', group: '8. Приём груза', wide: true, hint: 'Например: Кладовщик Петров И.Г.' },

  { key: 'unloadingAddress', label: 'Адрес выгрузки', group: '10. Выдача груза', wide: true },
  { key: 'plannedUnloadingAt', label: 'Подача под выгрузку', group: '10. Выдача груза', type: 'datetime-local' },
  { key: 'cargoCondition', label: 'Состояние груза', group: '10. Выдача груза', wide: true },
  { key: 'unloadPlaces', label: 'Мест при выгрузке', group: '10. Выдача груза' },

  { key: 'transportCost', label: 'Стоимость без налога', group: '12. Стоимость перевозки' },
  { key: 'transportCostVat', label: 'Сумма налога', group: '12. Стоимость перевозки' },
  { key: 'transportCostTotal', label: 'Стоимость с налогом', group: '12. Стоимость перевозки' },
];

export const GROUPS = [
  'Документ',
  'Стороны',
  '3. Груз',
  'Перевозчик и машина',
  '8. Приём груза',
  '10. Выдача груза',
  '12. Стоимость перевозки',
];

/** Дата с накладной на полоске: «20.10.2026», без сдвига из‑за часового пояса. */
export const showDay = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '—';
};

/** Коробов в накладной: сначала места при погрузке, иначе количество мест в грузе. */
export const boxCount = (doc: WaybillDocument): string =>
  doc.loadingPlaces?.trim() || doc.cargoPlaces?.trim() || '—';

/**
 * Накладная заполнена, когда в ней уже есть номер, места или даты.
 * Свежий пустой черновик иконку печати не получает.
 */
export const isFilled = (doc: WaybillDocument): boolean =>
  !!(
    doc.number?.trim() ||
    doc.loadingPlaces?.trim() ||
    doc.cargoPlaces?.trim() ||
    doc.plannedLoadingAt ||
    doc.plannedUnloadingAt ||
    doc.isReady
  );

/** Значение для input: даты режем под формат поля, null превращаем в пустую строку. */
export const toInput = (v: unknown, type?: FieldType): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (type === 'date') return s.slice(0, 10);
  if (type === 'datetime-local') return s.slice(0, 16);
  return s;
};
