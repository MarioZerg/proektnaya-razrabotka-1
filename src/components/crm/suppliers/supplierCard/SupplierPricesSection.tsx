import { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import { CURRENCIES, currencySymbols, type Supplier } from '@/lib/suppliersApi';
import type { Material, MaterialType } from '@/lib/materialsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import {
  rublesOf,
  type PriceRow,
  type SupplierFormState,
} from '@/components/crm/suppliers/supplierCard/supplierCardShared';

interface SupplierPricesSectionProps {
  supplier: Supplier | null;
  form: SupplierFormState;
  rate: number | null;
  rows: Record<number, PriceRow>;
  setRows: Dispatch<SetStateAction<Record<number, PriceRow>>>;
  materials: Material[];
  grouped: { type: MaterialType; items: Material[] }[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  pricesLoading: boolean;
  pricesError: string | null;
  pricesReady: boolean;
  filledCount: number;
  loadPrices: () => void;
  defaultOpen: boolean;
}

/** Прайс материалов: поиск, цены по группам и пересчёт в рубли. */
const SupplierPricesSection = ({
  supplier,
  form,
  rate,
  rows,
  setRows,
  materials,
  grouped,
  search,
  setSearch,
  pricesLoading,
  pricesError,
  pricesReady,
  filledCount,
  loadPrices,
  defaultOpen,
}: SupplierPricesSectionProps) => (
  <FormSection
    title="Прайс материалов"
    hint={
      supplier
        ? (pricesReady ? filledCount : supplier.prices?.length || 0)
          ? `${pricesReady ? filledCount : supplier.prices.length} в прайсе`
          : 'Прайс пуст'
        : 'После сохранения'
    }
    defaultOpen={defaultOpen}
  >
    {!supplier ? (
      <p className="text-sm text-muted-foreground">
        Сначала сохраните поставщика — затем можно указать цены материалов.
      </p>
    ) : (
      <>
        <p className="text-sm text-muted-foreground">
          Цена за единицу. При приёмке подставится сама. Валютная цена
          умножается на курс, рублёвая берётся как есть.
        </p>
        {rate ? (
          <p className="text-sm">
            Курс:{' '}
            <b>
              1 {currencySymbols[form.currency] || form.currency} = {rate} ₽
            </b>
          </p>
        ) : form.currency !== 'RUB' ? (
          <p className="text-sm text-destructive">
            Нет курса {form.currency} — валютные цены не пересчитаются в рубли.
            Укажите курс в настройках.
          </p>
        ) : null}

        {pricesLoading && materials.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка материалов…
          </div>
        ) : pricesError && materials.length === 0 ? (
          <WarehouseFetchError
            title="Не удалось загрузить материалы"
            description={pricesError}
            onRetry={loadPrices}
          />
        ) : (
          <>
            <div className="relative">
              <Icon
                name="Search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти материал"
                className="h-11 pl-9 sm:h-10"
              />
            </div>
            {grouped.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ничего не нашли.</p>
            ) : (
              grouped.map((group) => (
                <div key={group.type.id} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.type.name}
                  </p>
                  {group.items.map((m) => {
                    const row = rows[m.id];
                    const rub = rublesOf(row, rate);
                    const cur = row?.currency || form.currency || 'RUB';
                    const value = Number((row?.price || '').replace(',', '.'));
                    return (
                      <div
                        key={m.id}
                        className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                      >
                        <div>
                          <p className="font-medium leading-snug">{m.name}</p>
                          <p className="text-xs text-muted-foreground">за 1 {m.unit}</p>
                        </div>
                        <div className="grid min-w-0 grid-cols-[1fr_7.5rem] gap-2">
                          <div className="relative min-w-0">
                            <Input
                              inputMode="decimal"
                              placeholder="—"
                              className="h-11 pr-7 sm:h-10"
                              value={row?.price ?? ''}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [m.id]: {
                                    price: e.target.value,
                                    currency: prev[m.id]?.currency || form.currency || 'RUB',
                                  },
                                }))
                              }
                            />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              {currencySymbols[cur]}
                            </span>
                          </div>
                          <Select
                            value={cur}
                            onValueChange={(v) =>
                              setRows((prev) => ({
                                ...prev,
                                [m.id]: {
                                  price: prev[m.id]?.price || '',
                                  currency: v,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="h-11 min-w-0 [&>span]:min-w-0 [&>span]:flex-1 text-base sm:h-10 sm:text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c} {currencySymbols[c]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-sm">
                          {value ? (
                            cur === 'RUB' ? (
                              <span className="font-medium">{value.toFixed(2)} ₽</span>
                            ) : rub != null ? (
                              <span className="text-muted-foreground">
                                ≈{' '}
                                <span className="font-medium text-foreground">
                                  {rub.toFixed(2)} ₽
                                </span>
                              </span>
                            ) : (
                              <span className="text-destructive">нужен курс</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">Нет цены</span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </>
        )}
      </>
    )}
  </FormSection>
);

export default SupplierPricesSection;
