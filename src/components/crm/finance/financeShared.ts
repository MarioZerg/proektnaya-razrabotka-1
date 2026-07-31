export interface FinanceOperation {
  id: number;
  type: 'expense' | 'income';
  accruedFor: string;
  amount: number;
  name: string;
  createdAt: string;
  paidAt: string | null;
}

export interface SalaryPayout {
  id: number;
  paidAt: string;
  amount: number;
  name: string;
}

export const mockOperations: FinanceOperation[] = [
  {
    id: 1,
    type: 'expense',
    accruedFor: '30/07/2026',
    amount: 8.0,
    name: 'ЗП за заказ #5396031013 (Стикеровка) - 2 п.м. (Сорокина В.В.)',
    createdAt: '31/07/2026 00:50',
    paidAt: null,
  },
  {
    id: 2,
    type: 'expense',
    accruedFor: '30/07/2026',
    amount: 12.0,
    name: 'ЗП за заказ #0111953152-0194-1 (Стикеровка) - 3 п.м. (Сорокина В.В.)',
    createdAt: '31/07/2026 00:50',
    paidAt: null,
  },
  {
    id: 3,
    type: 'expense',
    accruedFor: '30/07/2026',
    amount: 8.0,
    name: 'ЗП за заказ #0175328349-0092-3 (Стикеровка) - 2 п.м. (Сорокина В.В.)',
    createdAt: '31/07/2026 00:50',
    paidAt: null,
  },
  {
    id: 4,
    type: 'expense',
    accruedFor: '30/07/2026',
    amount: 12.0,
    name: 'ЗП за заказ #25463263-0238-3 (Стикеровка) - 3 п.м. (Сорокина В.В.)',
    createdAt: '31/07/2026 00:50',
    paidAt: null,
  },
  {
    id: 5,
    type: 'expense',
    accruedFor: '30/07/2026',
    amount: 12.0,
    name: 'ЗП за заказ #25463263-0238-1 (Стикеровка) - 3 п.м. (Сорокина В.В.)',
    createdAt: '31/07/2026 00:50',
    paidAt: null,
  },
];

export const mockPayouts: SalaryPayout[] = [
  { id: 1, paidAt: '29/07/2026', amount: 6000.0, name: 'Выплата сотруднику (Новикова Анастасия Александровна)' },
  { id: 2, paidAt: '28/07/2026', amount: 13250.0, name: 'Выплата сотруднику (Коротков Кирилл Николаевич)' },
  { id: 3, paidAt: '25/07/2026', amount: 41397.25, name: 'Выплата сотруднику (Антипина Екатерина Николаевна)' },
  { id: 4, paidAt: '25/07/2026', amount: 51598.1, name: 'Выплата сотруднику (Шаркунова Надежда Владимировна)' },
  { id: 5, paidAt: '25/07/2026', amount: 47165.0, name: 'Выплата сотруднику (Коротаева Наталья Александровна)' },
];

export const companyMoney = 97593364.1;
export const toPayoutMoney = 325909.45;
export const toPayoutBonuses = 0;

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
