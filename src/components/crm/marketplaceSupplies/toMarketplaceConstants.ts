import type { SupplyType } from '@/lib/marketplaceSuppliesApi';

export const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

export const statusVariant: Record<string, { className: string }> = {
  Открытая: { className: 'bg-slate-500 text-white hover:bg-slate-500' },
  'На сборке': { className: 'bg-sky-500 text-white hover:bg-sky-500' },
  Отгрузка: { className: 'bg-amber-500 text-white hover:bg-amber-500' },
  Выполнена: { className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

export const createOptions: Array<{ marketplace: string; type: SupplyType; label: string }> = [
  { marketplace: 'OZON', type: 'FBS', label: 'OZON FBS' },
  { marketplace: 'WB', type: 'FBS', label: 'WB FBS' },
  { marketplace: 'Yandex', type: 'FBS', label: 'Яндекс FBS' },
  { marketplace: 'OZON', type: 'FBO', label: 'OZON FBO' },
  { marketplace: 'WB', type: 'FBO', label: 'WB FBO' },
];
