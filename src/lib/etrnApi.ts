const ETRN_URL = 'https://functions.poehali.dev/6917fac0-8a1e-4cfa-9bba-0e1e79faa158';

/**
 * Статус электронной транспортной накладной.
 *
 * «Подписана» ставится только по факту загруженного подписанного файла от оператора
 * ЭДО — подпись живёт в Диадоке, у нас хранится её подтверждение.
 */
export type EtrnStatus = 'Черновик' | 'На подписи' | 'Подписана' | 'Аннулирована';

export const etrnStatuses: EtrnStatus[] = [
  'Черновик',
  'На подписи',
  'Подписана',
  'Аннулирована',
];

export interface EtrnDocument {
  id: number;
  supplyId: number;
  number: string | null;
  docDate: string | null;
  status: EtrnStatus;

  /** Грузоотправитель — наши реквизиты, копией на момент отгрузки. */
  shipperName: string | null;
  shipperInn: string | null;
  shipperAddress: string | null;

  /** Перевозчик и машина: без водителя и номера СЦ груз не примет. */
  carrierName: string | null;
  carrierInn: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleNumber: string | null;
  vehicleModel: string | null;

  /** Грузополучатель — сортировочный центр маркетплейса. */
  consigneeName: string | null;
  consigneeAddress: string | null;

  pickupAddress: string | null;
  pickupAt: string | null;
  deliveryAt: string | null;

  cargoPlaces: number | null;
  cargoWeightKg: number | null;
  cargoDescription: string | null;

  /** Оператор ЭДО и номер документа у него — по нему накладную ищут в Диадоке. */
  operatorName: string | null;
  operatorDocId: string | null;

  /** Подписанный файл от оператора — единственное подтверждение подписи. */
  signedFileUrl: string | null;
  signedFileName: string | null;
  signedAt: string | null;
  signedByName: string | null;

  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Поля карточки, которые правит менеджер. */
export type EtrnEditableFields = Partial<
  Pick<
    EtrnDocument,
    | 'number'
    | 'docDate'
    | 'shipperName'
    | 'shipperInn'
    | 'shipperAddress'
    | 'carrierName'
    | 'carrierInn'
    | 'driverName'
    | 'driverPhone'
    | 'vehicleNumber'
    | 'vehicleModel'
    | 'consigneeName'
    | 'consigneeAddress'
    | 'pickupAddress'
    | 'pickupAt'
    | 'deliveryAt'
    | 'cargoPlaces'
    | 'cargoWeightKg'
    | 'cargoDescription'
    | 'operatorName'
    | 'operatorDocId'
    | 'comment'
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

const post = async (payload: Record<string, unknown>): Promise<EtrnDocument> => {
  const res = await fetch(ETRN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actor(), ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data.document;
};

/** Строка очереди на подпись: накладная плюс данные поставки, к которой она относится. */
export interface EtrnPendingItem {
  id: number;
  supplyId: number;
  number: string | null;
  status: EtrnStatus;
  docDate: string | null;
  driverName: string | null;
  vehicleNumber: string | null;
  carrierName: string | null;
  cargoPlaces: number | null;
  deliveryAt: string | null;
  /** Номер документа у оператора — по нему накладная открывается в Диадоке. */
  operatorDocId: string | null;
  updatedAt: string;
  marketplace: string;
  supplyType: string;
  supplyStatus: string;
  cluster: string | null;
  supplyNumber: string | null;
}

/** Накладные, ожидающие подписи руководителя. */
export const fetchPendingEtrn = async (): Promise<EtrnPendingItem[]> => {
  const res = await fetch(`${ETRN_URL}?view=pending`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить очередь на подпись');
  return data.items || [];
};

/** Накладная поставки. null — ещё не заводили. */
export const fetchEtrn = async (supplyId: number): Promise<EtrnDocument | null> => {
  const res = await fetch(`${ETRN_URL}?supplyId=${supplyId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить накладную');
  return data.document;
};

/** Создать черновик: реквизиты отправителя, склад и число мест подставятся сами. */
export const createEtrn = (supplyId: number) => post({ action: 'create', supplyId });

export const updateEtrn = (supplyId: number, fields: EtrnEditableFields) =>
  post({ action: 'update', supplyId, ...fields });

export const setEtrnStatus = (supplyId: number, status: EtrnStatus) =>
  post({ action: 'set_status', supplyId, status });

/** Приложить подписанный файл от оператора — документ становится «Подписана». */
export const attachSignedEtrn = (supplyId: number, fileBase64: string, fileName: string) =>
  post({ action: 'attach_signed', supplyId, fileBase64, fileName });