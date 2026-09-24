import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchBatchCosts, type BatchCost } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Цена метра — четыре знака: на тираже в тысячи изделий копейки решают. */
const price = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Фактическая цена одного погонного метра по партиям.
 *
 * ЗАЧЕМ. Цена в накладной — не та цена, по которой метр реально достался. Между
 * ними стоят три вещи, каждая из которых съедает метры, но не рубли:
 *
 *   • логистика — заплачена за всю машину и разложена по метрам при приёмке;
 *   • недостача — поставщик намотал меньше, чем написал на этикетке: деньги
 *     за эти метры отданы, метров нет;
 *   • брак — куски, вырезанные из полотна и списанные: дырки, затяжки,
 *     непрокрас. Тоже оплачены и тоже в изделие не пошли.
 *
 * Поэтому все деньги партии делятся не на метраж накладной, а на ГОДНЫЙ метраж.
 * Заплатили за 30 000 м, годных вышло 29 700 — метр стоит не 5.90, а 5.96. На
 * тираже в тысячи изделий эта разница и есть вся разница между «в плюсе» и
 * «в минусе»: считая по накладной, себестоимость всегда занижена.
 *
 * ПОЧЕМУ СТРОКИ ВНУТРИ ПАРТИИ. В одной машине едут и тюль, и тесьма, и пакеты.
 * Средняя цена «по партии» смешала бы метры со штуками и не значила бы ничего —
 * поэтому решения принимают по разбивке на материалы, а шапка партии нужна лишь
 * чтобы увидеть общий масштаб потерь.
 */
const BatchCostTab = () => {
  const { toast } = useToast();
  const [batches, setBatches] = useState<BatchCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    fetchBatchCosts()
      .then((rows) => {
        setBatches(rows);
        // Свежую партию раскрываем сразу: за ней и приходят на эту вкладку —
        // «во сколько обошёлся метр из того, что привезли вчера».
        if (rows.length > 0) setOpenKey(rows[0].key);
      })
      .catch((e) =>
        toast({
          title: 'Не удалось посчитать',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Поиск идёт по материалам внутри партии: человек ищет «бамбук», а не номер
  // приёмки — номера машин никто наизусть не помнит.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(
      (b) =>
        b.lines.some(
          (l) =>
            l.material.toLowerCase().includes(q) ||
            (l.supplier || '').toLowerCase().includes(q),
        ) || (b.shipmentId ? `${b.shipmentId}`.includes(q) : false),
    );
  }, [batches, search]);

  // Итог по всем партиям: сколько денег ушло в метры, которых не существует.
  const totals = useMemo(() => {
    const lost = batches.reduce((s, b) => s + b.shortage + b.defects, 0);
    const initial = batches.reduce((s, b) => s + b.initial, 0);
    // Деньги за потерянные метры считаем по номинальной цене партии: именно
    // столько было заплачено за метраж, который в изделия не ушёл.
    const lostMoney = batches.reduce(
      (s, b) => s + (b.shortage + b.defects) * b.nominalPrice,
      0,
    );
    return { lost, initial, lostMoney, percent: initial > 0 ? (lost / initial) * 100 : 0 };
  }, [batches]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Считаю цену погонного метра…
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Партий с указанной ценой закупки пока нет. Цена появляется при приёмке от
        поставщика — укажите прайс поставщика, и расчёт посчитается сам.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Как считается цена метра</p>
        <p className="mt-1 text-muted-foreground">
          Все деньги партии — товар по накладной плюс логистика — делятся не на
          метраж накладной, а на годный метраж: за вычетом недостач с рулонов и
          вырезанного брака. Это и есть цена метра, который реально можно
          раскроить.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Партий в расчёте</p>
          <p className="text-2xl font-bold">{batches.length}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Закуплено</p>
          <p className="text-2xl font-bold">{formatQuantity(totals.initial)}</p>
          <p className="text-xs text-muted-foreground">по накладным</p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-muted-foreground">Не дошло до изделий</p>
          <p className="text-2xl font-bold">{formatQuantity(totals.lost)}</p>
          <p className="text-xs text-muted-foreground">
            недостачи и брак · {totals.percent.toFixed(2)}%
          </p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-muted-foreground">Оплачено за эти метры</p>
          <p className="text-2xl font-bold">{money(totals.lostMoney)} ₽</p>
        </div>
      </div>

      <Input
        placeholder="Поиск по материалу или поставщику"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ничего не найдено</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Партия</TableHead>
                <TableHead className="text-right">Закуплено</TableHead>
                <TableHead className="text-right">Потери</TableHead>
                <TableHead className="text-right">Годно</TableHead>
                <TableHead className="text-right">Затраты</TableHead>
                <TableHead className="text-right">По накладной</TableHead>
                <TableHead className="text-right">Факт за метр</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((b) => {
                const isOpen = openKey === b.key;
                // Насколько фактическая цена оторвалась от номинальной. Выше 3% —
                // партия съедает заметно больше, чем думали при закупке.
                const overrun =
                  b.nominalPrice > 0
                    ? ((b.realPrice - b.nominalPrice) / b.nominalPrice) * 100
                    : 0;
                return (
                  <Fragment key={b.key}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpenKey(isOpen ? null : b.key)}
                    >
                      <TableCell>
                        <p className="font-medium">
                          {b.shipmentId ? `Приёмка №${b.shipmentId}` : 'Завоз без документа'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(b.date)} · {b.rolls} рул. · {b.materialsCount} мат.
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{formatQuantity(b.initial)}</TableCell>
                      <TableCell className="text-right">
                        <span className={b.lossPercent > 3 ? 'font-medium text-amber-700' : ''}>
                          {formatQuantity(b.shortage + b.defects)}
                        </span>
                        <p className="text-xs text-muted-foreground">{b.lossPercent}%</p>
                      </TableCell>
                      <TableCell className="text-right">{formatQuantity(b.usable)}</TableCell>
                      <TableCell className="text-right">
                        {money(b.totalCost)} ₽
                        {b.logisticsCost > 0 && (
                          <p className="text-xs text-muted-foreground">
                            логистика {money(b.logisticsCost)} ₽
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {price(b.nominalPrice)} ₽
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-base font-bold">{price(b.realPrice)} ₽</span>
                        {overrun > 0.5 && (
                          <p className="text-xs text-amber-700">+{overrun.toFixed(1)}%</p>
                        )}
                      </TableCell>
                      <TableCell className="w-8 text-right">
                        <Icon
                          name={isOpen ? 'ChevronUp' : 'ChevronDown'}
                          size={16}
                          className="text-muted-foreground"
                        />
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-muted/30 p-0">
                          <div className="space-y-2 p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Цена метра по материалам этой партии
                            </p>
                            {b.lines.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                Разбивка недоступна
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {b.lines.map((l, i) => (
                                  <div
                                    key={`${b.key}-${l.material}-${l.supplier}-${i}`}
                                    className="rounded-md border border-border bg-background p-3"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="font-medium">{l.material}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {l.supplier} · {l.rolls} рул. ·{' '}
                                          {l.materialType || 'без типа'}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-lg font-bold">
                                          {price(l.realPrice)} ₽
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          за 1 {l.unit} с учётом потерь
                                        </p>
                                      </div>
                                    </div>

                                    {/* Полная цепочка: от цены накладной до факта.
                                        Без неё цифра выглядит взятой с потолка, и
                                        первый же вопрос — «почему столько». */}
                                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                                      <div>
                                        <span className="text-muted-foreground">
                                          По накладной:{' '}
                                        </span>
                                        {price(l.invoicePrice)} ₽
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">
                                          С логистикой:{' '}
                                        </span>
                                        {price(l.nominalPrice)} ₽
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">
                                          Недостача:{' '}
                                        </span>
                                        {formatQuantity(l.shortage)} {l.unit}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Брак: </span>
                                        {formatQuantity(l.defects)} {l.unit}
                                      </div>
                                    </div>

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <Badge variant="outline" className="font-normal">
                                        закуплено {formatQuantity(l.initial)} {l.unit}
                                      </Badge>
                                      <Badge variant="outline" className="font-normal">
                                        годно {formatQuantity(l.usable)} {l.unit}
                                      </Badge>
                                      <Badge variant="outline" className="font-normal">
                                        затраты {money(l.totalCost)} ₽
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {visible.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpenKey(null)}
          className="text-muted-foreground"
        >
          Свернуть все партии
        </Button>
      )}
    </div>
  );
};

export default BatchCostTab;
