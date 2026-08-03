const GAZELKA_URL = 'https://functions.poehali.dev/919a040d-f5ad-4fcb-98ee-a0cf8e28b99e';

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
  printUrl: string | null;
}

export const fetchGazelkaPlans = async (): Promise<GazelkaPlan[]> => {
  const res = await fetch(GAZELKA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_plans' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось загрузить заявки Газельки');
  }
  return (data.plans || []) as GazelkaPlan[];
};

/** Прямая ссылка на печать стикеров коробов в ЛК Газельки по id заявки. */
export const gazelkaPrintUrl = (planId: number): string =>
  `https://gazelka.space/print-labels?ids[]=${planId}`;
