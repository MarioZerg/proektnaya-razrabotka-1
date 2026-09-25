const WAYBILL_URL = 'https://functions.poehali.dev/fea78c5e-3cbe-4335-8e44-6c12c6a15cf8';

/**
 * Транспортная накладная по поставке — форма Приложения № 4 к Правилам перевозок
 * грузов автомобильным транспортом (в ред. ПП РФ от 30.11.2021 № 2116).
 *
 * Едет с машиной на бумаге. ЭТрН здесь не участвует: перевозчик (Газелька)
 * оформляет электронную накладную у себя.
 */
export interface WaybillDocument {
  id: number;
  supplyId: number;

  /** Шапка документа. */
  number: string | null;
  docDate: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  copyNumber: number | null;

  /** 1. Грузоотправитель — мы. */
  shipperDetails: string | null;
  shipperIsForwarder: boolean;

  /** 1а. Заказчик услуг по организации перевозки (при наличии). */
  customerDetails: string | null;
  customerContract: string | null;

  /** 2. Грузополучатель — склад маркетплейса. */
  consigneeDetails: string | null;
  deliveryAddress: string | null;

  /** 3. Груз. */
  cargoName: string | null;
  cargoPlaces: string | null;
  cargoWeight: string | null;
  cargoValue: string | null;
  cargoDanger: string | null;

  /** 4. Сопроводительные документы. */
  accompanyingDocs: string | null;

  /** 5. Особые условия перевозки. */
  specialRoute: string | null;
  specialReaddress: string | null;
  specialRequirements: string | null;
  specialTemperature: string | null;

  /** 6. Перевозчик и водитель. */
  carrierDetails: string | null;
  driverDetails: string | null;

  /** 7. Транспортное средство. */
  vehicleDetails: string | null;
  vehicleNumber: string | null;
  vehicleOwnership: number | null;
  vehicleOwnershipDoc: string | null;
  vehiclePermit: string | null;

  /** 8. Приём груза. */
  loaderDetails: string | null;
  loadingPointOwner: string | null;
  loadingAddress: string | null;
  plannedLoadingAt: string | null;
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  loadingWeight: string | null;
  loadingPlaces: string | null;
  packaging: string | null;
  carrierRemarks: string | null;
  loaderSignature: string | null;
  driverSignature: string | null;

  /** 10. Выдача груза. */
  unloadingAddress: string | null;
  plannedUnloadingAt: string | null;
  cargoCondition: string | null;
  unloadPlaces: string | null;
  unloadWeight: string | null;

  /** 12. Стоимость перевозки. */
  transportCost: string | null;
  transportCostVat: string | null;
  transportCostTotal: string | null;

  /** Готовый файл — его скачивает кладовщик перед отгрузкой. */
  fileUrl: string | null;
  fileName: string | null;
  fileGeneratedAt: string | null;

  /** Менеджер подтвердил: кладовщик может скачивать и отгружать. */
  isReady: boolean;
  readyAt: string | null;
  readyByName: string | null;

  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Поля, которые правит менеджер. Файл и готовность ставит система. */
export type WaybillEditableFields = Partial<
  Omit<
    WaybillDocument,
    | 'id'
    | 'supplyId'
    | 'fileUrl'
    | 'fileName'
    | 'fileGeneratedAt'
    | 'isReady'
    | 'readyAt'
    | 'readyByName'
    | 'createdAt'
    | 'updatedAt'
  >
>;

const actor = (): { actorId?: number; actorName?: string } => {
  try {
    const raw = localStorage.getItem('megatul_user');
    if (!raw) return {};
    const u = JSON.parse(raw);
    return { actorId: u.id, actorName: u.name };
  } catch {
    return {};
  }
};

const post = async (payload: Record<string, unknown>): Promise<WaybillDocument> => {
  const res = await fetch(WAYBILL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actor(), ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data.document;
};

/** Накладная поставки. null — ещё не заводили. */
export const fetchWaybill = async (supplyId: number): Promise<WaybillDocument | null> => {
  const res = await fetch(`${WAYBILL_URL}?supplyId=${supplyId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить накладную');
  return data.document;
};

/** Создать черновик: наши реквизиты, склад назначения и число коробов подставятся сами. */
export const createWaybill = (supplyId: number) => post({ action: 'create', supplyId });

export const updateWaybill = (supplyId: number, fields: WaybillEditableFields) =>
  post({ action: 'update', supplyId, ...fields });

/** Собрать файл XLSX по форме — его и отдают водителю. */
export const generateWaybill = (supplyId: number) => post({ action: 'generate', supplyId });

/**
 * Подтвердить готовность накладной.
 *
 * До подтверждения кладовщик не видит кнопку скачивания: иначе он повёз бы
 * водителю недозаполненный документ.
 */
export const setWaybillReady = (supplyId: number, ready: boolean) =>
  post({ action: 'set_ready', supplyId, ready });
