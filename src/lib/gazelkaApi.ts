const GAZELKA_URL = 'https://functions.poehali.dev/919a040d-f5ad-4fcb-98ee-a0cf8e28b99e';

/** POEHALI: заявки Газельки. FRONTEND-ONLY: сбой GET не писать как «менеджер не заполнил поля». */

export interface GazelkaPlan {
  id: number;
  applicationDate: string | null;
  status: number | null;
  statusLabel: string;
  marketplaceId: number | null;
  marketplaceLabel: string;
  deliveryAddress: string | null;
  deliveryDate: string | null;
  boxes: number | null;
  pallets: number | null;
  cargoPickup: boolean | null;
  onBehalf: number | null;
  payer: number | null;
  palleting: number | null;
  shipDate: string | null;
}

const loadPlans = async (supplyId?: number) => {
  const res = await fetch(GAZELKA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_plans', ...(supplyId ? { supplyId } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось загрузить заявки Газельки');
  }
  return { plans: (data.plans || []) as GazelkaPlan[], allCount: Number(data.allCount) || 0 };
};

export const fetchGazelkaPlans = async (): Promise<GazelkaPlan[]> => (await loadPlans()).plans;

/** Только заявки, подходящие поставке: та же площадка, тот же город, не занятые другой поставкой. */
export const fetchGazelkaPlansForSupply = (supplyId: number) => loadPlans(supplyId);
