const OZON_FBO_URL = 'https://functions.poehali.dev/697620a6-2bfe-40f7-af06-0de882dd0391';

export interface OzonFboApplication {
  orderId: number;
  orderNumber: string | null;
  state: string | null;
  createdDate: string | null;
  deadline: string | null;
  warehouse: string | null;
  timeslotFrom: string | null;
  timeslotTo: string | null;
  /** id нашей поставки, если заявка уже импортирована. */
  supplyId: number | null;
}

export interface OzonFboImportResult {
  supplyId: number;
  created: number;
  skippedNoItem: number;
  totalItems: number;
  unmatched: Array<{ ozonSku: number | null; offerId: string | null; name: string | null }>;
  orderNumber: string | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(OZON_FBO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка OZON FBO');
  }
  return data;
};

export const fetchOzonFboApplications = async (): Promise<OzonFboApplication[]> => {
  const data = await post({ action: 'list_applications' });
  return (data.applications || []) as OzonFboApplication[];
};

export interface OzonFboCompositionCheck {
  totalItems: number;
  totalQty: number;
  matchedItems: number;
  matchedQty: number;
  unmatchedItems: number;
  unmatched: Array<{ ozonSku: number | null; offerId: string | null; name: string | null; quantity: number }>;
}

export const checkOzonFboComposition = (orderId: number): Promise<OzonFboCompositionCheck> =>
  post({ action: 'check_composition', orderId }) as Promise<OzonFboCompositionCheck>;

export const importOzonFboComposition = (
  orderId: number,
  actor?: { id?: number | null; name?: string | null }
): Promise<OzonFboImportResult> =>
  post({
    action: 'import_composition',
    orderId,
    createdBy: actor?.id,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<OzonFboImportResult>;