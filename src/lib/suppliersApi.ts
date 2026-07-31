const SUPPLIERS_URL = 'https://functions.poehali.dev/eb3fba8a-def9-443a-a867-97243dacc9f8';

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export const fetchSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch(SUPPLIERS_URL);
  const data = await res.json();
  return data.suppliers || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SUPPLIERS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const createSupplier = (payload: {
  name: string;
  phone?: string;
  address?: string;
  comment?: string;
}) => postAction({ action: 'create', ...payload });

export const updateSupplier = (
  id: number,
  fields: Partial<{ name: string; phone: string; address: string; comment: string }>
) => postAction({ action: 'update', id, ...fields });

export const deleteSupplier = (id: number) => postAction({ action: 'delete', id });
