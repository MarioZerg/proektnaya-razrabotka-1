import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { formatDate, formatMoney, accrualTypeLabels, financeOrderLabel } from '@/components/crm/finance/financeShared';
import {
  formatMeters,
  type DayOrderRow,
  type DayExtraRow,
  type WorkedDay,
} from '@/components/crm/finance/workedDay';

interface WorkedDaySheetProps {
  day: WorkedDay;
  /** На киоске плашка крупнее — с планшета читают на ходу. */
  large?: boolean;
  /**
   * Сворачиваемый день с папками внутри.
   * На киоске после смены (`large`) всегда раскрыт целиком.
   */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

const moneyClass = (amount: number, type?: string) =>
  type === 'penalty' ? 'text-destructive' : amount < 0 ? 'text-amber-700' : 'text-emerald-700';

const plural = (n: number, one: string, few: string, many: string) => {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
};

type Folder = {
  key: string;
  title: string;
  count: number;
  total: number;
  kind: 'orders' | 'extra';
  orders?: DayOrderRow[];
  extras?: DayExtraRow[];
  tone?: 'bonus' | 'deduction' | 'salary';
};

/** Папки внутри дня: пошив / раскрой / оклад / надбавки / вычеты. */
const buildFolders = (day: WorkedDay): Folder[] => {
  const byType = new Map<string, DayOrderRow[]>();
  for (const row of day.orders) {
    const list = byType.get(row.type) || [];
    list.push(row);
    byType.set(row.type, list);
  }

  const folders: Folder[] = [];
  for (const [type, rows] of byType) {
    folders.push({
      key: `order:${type}`,
      title: accrualTypeLabels[type] || type,
      count: rows.length,
      total: rows.reduce((s, r) => s + r.amount, 0),
      kind: 'orders',
      orders: rows,
    });
  }
  if (day.salaries.length > 0) {
    folders.push({
      key: 'salaries',
      title: 'Оклад',
      count: day.salaries.length,
      total: day.salaries.reduce((s, r) => s + r.amount, 0),
      kind: 'extra',
      extras: day.salaries,
      tone: 'salary',
    });
  }
  if (day.bonuses.length > 0) {
    folders.push({
      key: 'bonuses',
      title: 'Надбавки',
      count: day.bonuses.length,
      total: day.bonuses.reduce((s, r) => s + r.amount, 0),
      kind: 'extra',
      extras: day.bonuses,
      tone: 'bonus',
    });
  }
  if (day.deductions.length > 0) {
    folders.push({
      key: 'deductions',
      title: 'Вычеты',
      count: day.deductions.length,
      total: day.deductionsTotal,
      kind: 'extra',
      extras: day.deductions,
      tone: 'deduction',
    });
  }
  return folders;
};

const FolderBlock = ({
  folder,
  open,
  onToggle,
  large,
}: {
  folder: Folder;
  open: boolean;
  onToggle: () => void;
  large: boolean;
}) => {
  const toneClass =
    folder.tone === 'deduction'
      ? 'text-destructive'
      : folder.tone === 'bonus'
        ? 'text-emerald-700'
        : moneyClass(folder.total);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <Icon
          name="Folder"
          size={14}
          className={`shrink-0 transition-colors ${open ? 'text-amber-600' : 'text-muted-foreground'}`}
        />
        <Icon
          name="ChevronRight"
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{folder.title}</p>
          <p className="text-xs text-muted-foreground">
            {folder.count}{' '}
            {plural(folder.count, 'начисление', 'начисления', 'начислений')}
          </p>
        </div>
        <span className={`shrink-0 tabular-nums text-sm font-semibold ${toneClass}`}>
          {formatMoney(folder.total)} ₽
        </span>
      </button>

      {open && (
        <div className="border-t border-border bg-background">
          {folder.kind === 'orders' && folder.orders && (
            <div className="divide-y divide-border">
              <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-2 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                <span>Заказ</span>
                <span className="min-w-[4.5rem] text-right">Метраж</span>
                <span className="min-w-[5.75rem] text-right">Сумма</span>
              </div>
              {folder.orders.map((row) => {
                const orderLabel = financeOrderLabel(row.orderNumber);
                return (
                  <div
                    key={row.id}
                    className="flex flex-col gap-1 px-2.5 py-2 text-sm sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-baseline sm:gap-2 sm:py-1.5"
                  >
                    <div className="min-w-0">
                      {/* break-all: длинный номер OZON/WB на телефоне не должен
                          уезжать в truncate за край колонки с метражом/суммой. */}
                      <p className="break-all font-medium leading-snug">
                        {orderLabel
                          ? `Заказ ${orderLabel}`
                          : accrualTypeLabels[row.type] || row.type}
                      </p>
                      {orderLabel ? (
                        <p className="text-[11px] text-muted-foreground">
                          {accrualTypeLabels[row.type] || row.type}
                        </p>
                      ) : row.description ? (
                        <p className="break-words text-[11px] text-muted-foreground">
                          {row.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-baseline justify-between gap-3 sm:contents">
                      <span className="tabular-nums text-muted-foreground sm:min-w-[4.5rem] sm:text-right">
                        <span className="mr-1 text-[11px] sm:hidden">Метраж</span>
                        {row.meters != null ? formatMeters(row.meters) : '—'}
                      </span>
                      <span className="tabular-nums font-medium sm:min-w-[5.75rem] sm:text-right">
                        {formatMoney(row.amount)} ₽
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {folder.kind === 'extra' && folder.extras && (
            <div className="divide-y divide-border">
              {folder.extras.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 px-2.5 py-2 text-sm"
                >
                  <p className="min-w-0 leading-snug">
                    <span className="font-medium">
                      {accrualTypeLabels[row.type] || row.type}
                    </span>
                    {row.description ? (
                      <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                        {row.description}
                      </span>
                    ) : null}
                  </p>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${moneyClass(row.amount, row.type)}`}
                  >
                    {formatMoney(row.amount)} ₽
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Отработанный день сотрудника.
 *
 * Во вкладке «Финансы» день — папка: свёрнут по умолчанию, внутри ещё папки
 * по виду работы (пошив, раскрой, оклад…). Иначе за смену из 40 заказов
 * получается портянка на весь экран. На киоске после закрытия смены (`large`)
 * день сразу раскрыт — человек смотрит итог на ходу.
 */
const WorkedDaySheet = ({
  day,
  large = false,
  collapsible = !large,
  open: openProp,
  onToggle,
}: WorkedDaySheetProps) => {
  const folders = useMemo(() => buildFolders(day), [day]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());

  const controlled = typeof openProp === 'boolean';
  const [localOpen, setLocalOpen] = useState(!collapsible);
  const dayOpen = collapsible ? (controlled ? openProp : localOpen) : true;

  const folderKey = folders.map((f) => f.key).join(',');
  useEffect(() => {
    // Одна папка в дне — сразу раскрыта; иначе не разворачиваем портянку.
    setOpenFolders(folders.length === 1 ? new Set([folders[0].key]) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.date, folderKey]);

  const toggleDay = () => {
    if (!collapsible) return;
    if (onToggle) onToggle();
    else setLocalOpen((v) => !v);
  };

  const toggleFolder = (key: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const itemsCount =
    day.orders.length + day.salaries.length + day.bonuses.length + day.deductions.length;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={toggleDay}
        disabled={!collapsible}
        className={`flex w-full min-w-0 items-start justify-between gap-3 border-b border-border bg-muted/50 px-3 py-2.5 text-left ${
          collapsible ? 'transition-colors hover:bg-muted/70' : ''
        } ${!collapsible ? 'cursor-default' : ''}`}
      >
        <div className="flex min-w-0 items-start gap-2">
          {collapsible && (
            <Icon
              name="ChevronRight"
              size={16}
              className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${
                dayOpen ? 'rotate-90' : ''
              }`}
            />
          )}
          <div className="min-w-0">
            <p className={`font-bold ${large ? 'text-lg' : 'text-sm'}`}>{formatDate(day.date)}</p>
            {day.shiftLabel ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{day.shiftLabel}</p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {itemsCount} {plural(itemsCount, 'начисление', 'начисления', 'начислений')}
                {folders.length > 0
                  ? ` · ${folders.length} ${plural(folders.length, 'папка', 'папки', 'папок')}`
                  : ''}
              </p>
            )}
          </div>
        </div>
        <p
          className={`shrink-0 tabular-nums font-bold ${moneyClass(day.net)} ${
            large ? 'text-xl' : 'text-base'
          }`}
        >
          {formatMoney(day.net)} ₽
        </p>
      </button>

      {dayOpen && (
        <div className={`space-y-2 ${large ? 'p-4' : 'p-3'}`}>
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">За этот день начислений нет</p>
          ) : (
            folders.map((folder) => (
              <FolderBlock
                key={folder.key}
                folder={folder}
                open={openFolders.has(folder.key)}
                onToggle={() => toggleFolder(folder.key)}
                large={large}
              />
            ))
          )}

          <div className="space-y-1 border-t border-border pt-2">
            {day.metersTotal > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Метраж за день</span>
                <span className="tabular-nums font-medium">
                  {formatMeters(day.metersTotal)} пог.м.
                </span>
              </div>
            )}
            {day.deductionsTotal < 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Вычеты</span>
                <span className="tabular-nums font-medium text-destructive">
                  {formatMoney(day.deductionsTotal)} ₽
                </span>
              </div>
            )}
            {day.bonuses.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Надбавки</span>
                <span className="tabular-nums font-medium text-emerald-700">
                  {formatMoney(day.bonuses.reduce((s, r) => s + r.amount, 0))} ₽
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="font-semibold">Итого за день</span>
              <span
                className={`tabular-nums font-bold ${large ? 'text-xl' : 'text-lg'} ${moneyClass(day.net)}`}
              >
                {formatMoney(day.net)} ₽
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkedDaySheet;
