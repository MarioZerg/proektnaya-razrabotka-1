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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchCutterAnalysis,
  fetchCutterRolls,
  type CutterAnalysisRow,
  type CutterRollRow,
} from '@/lib/rollsApi';
import { formatDateTime } from '@/lib/dateUtils';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Анализ недостач по закройщицам.
 *
 * ЗАЧЕМ. Штрафы за недостачу разбираются рулон за рулоном, и за этой рутиной не
 * видно главного: у кого метраж уходит в никуда РЕГУЛЯРНО. Один плохой рулон
 * бывает у каждого — поставщик недомотал, ткань пошла с дефектом. А вот когда
 * семь рулонов из десяти закрываются с превышением, дело уже не в поставщике.
 *
 * ЧТО СЧИТАЕТСЯ. Только рулоны, которые человек вёл ОДИН от начала и до конца.
 * Если ткань кроили двое, понять, чей метраж пропал, невозможно: такой рулон
 * никого не характеризует и в личную статистику не идёт — иначе аккуратный
 * закройщик получал бы в статистику чужие огрехи.
 *
 * ПОЧЕМУ УЧИТЫВАЮТСЯ ПРОЩЁННЫЕ РУЛОНЫ. Решение администратора «виноват поставщик»
 * снимает деньги, но не отменяет факт недостачи. Если такие рулоны у одного
 * человека идут раз за разом, списывать их на поставщика больше нельзя — поэтому
 * они остаются в таблице и показаны отдельной колонкой.
 */
const CutterAnalysisTab = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<CutterAnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [shiftFilter, setShiftFilter] = useState('all');
  const [openUser, setOpenUser] = useState<number | null>(null);
  const [detail, setDetail] = useState<CutterRollRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchCutterAnalysis()
      .then(setRows)
      .catch(() => toast({ title: 'Не удалось загрузить анализ', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  const shifts = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.shiftNumber).filter((s): s is number => s != null))).sort(
        (a, b) => a - b,
      ),
    [rows],
  );

  const visible = useMemo(
    () =>
      shiftFilter === 'all'
        ? rows
        : rows.filter((r) => String(r.shiftNumber) === shiftFilter),
    [rows, shiftFilter],
  );

  const toggle = (userId: number) => {
    if (openUser === userId) {
      setOpenUser(null);
      return;
    }
    setOpenUser(userId);
    setDetailLoading(true);
    setDetail([]);
    fetchCutterRolls(userId)
      .then(setDetail)
      .catch(() => toast({ title: 'Не удалось загрузить рулоны', variant: 'destructive' }))
      .finally(() => setDetailLoading(false));
  };

  // Красным подсвечиваем тех, у кого превышение стало нормой жизни, а не случаем.
  const shareColor = (share: number) =>
    share >= 50 ? 'text-destructive' : share >= 25 ? 'text-amber-600' : 'text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium">Как читать таблицу</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Учитываются только рулоны, которые закройщица вела одна от начала до конца — общая
          работа в статистику не идёт. Рулоны, где недостачу списали на поставщика, тоже
          учтены: решение админа снимает деньги, но не отменяет факт.
        </p>
      </div>

      {shifts.length > 1 && (
        <div className="flex items-center gap-2">
          <Select value={shiftFilter} onValueChange={setShiftFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Смена" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все смены</SelectItem>
              {shifts.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Смена {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Пока нет рулонов, закрытых одной закройщицей
        </p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Закройщица</TableHead>
                <TableHead className="text-primary-foreground">Смена</TableHead>
                <TableHead className="text-right text-primary-foreground">Рулонов</TableHead>
                <TableHead className="text-right text-primary-foreground">
                  С недостачей сверх нормы
                </TableHead>
                <TableHead className="text-right text-primary-foreground">
                  Не ушло в изделия
                </TableHead>
                <TableHead className="text-right text-primary-foreground">Сумма</TableHead>
                <TableHead className="text-right text-primary-foreground">
                  Списано на поставщика
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                // Fragment с ключом: строка сотрудника и её раскрытая детализация —
                // два соседних <tr>, обернуть их в <div> нельзя, таблица развалится.
                <Fragment key={r.userId}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => toggle(r.userId)}
                  >
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      {r.shiftNumber != null ? (
                        <Badge variant="secondary">Смена {r.shiftNumber}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.rollsTotal}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-semibold ${shareColor(r.overNormShare)}`}>
                        {r.overNormRolls} из {r.rollsTotal}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({r.overNormShare}%)
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{r.lostQuantity}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {money(r.overNormMoney)} ₽
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.forgivenRolls || '—'}
                    </TableCell>
                    <TableCell>
                      <Icon
                        name={openUser === r.userId ? 'ChevronUp' : 'ChevronDown'}
                        size={16}
                        className="text-muted-foreground"
                      />
                    </TableCell>
                  </TableRow>

                  {/* Раскрытая строка: поимённый список рулонов. Без него цифра
                      «10 из 14» остаётся обвинением без доказательств — админу
                      нужно видеть конкретные рулоны, прежде чем говорить с человеком. */}
                  {openUser === r.userId && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8} className="p-3">
                        {detailLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Icon name="Loader2" size={14} className="animate-spin" />
                            Загрузка рулонов...
                          </div>
                        ) : detail.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Рулонов не найдено</p>
                        ) : (
                          <div className="space-y-1.5">
                            {detail.map((d) => (
                              <div
                                key={d.rollId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    {d.materialName}{' '}
                                    <span className="font-mono-tech text-xs text-muted-foreground">
                                      #{d.barcode}
                                    </span>
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Было {d.initialQuantity} {d.unit} · не ушло{' '}
                                    <b className="text-foreground">
                                      {d.lostQuantity} {d.unit}
                                    </b>
                                    {d.allowed != null && (
                                      <>
                                        {' '}
                                        · норма {d.normPercent}% = {d.allowed} {d.unit}
                                      </>
                                    )}
                                    {d.supplierName && <> · {d.supplierName}</>}
                                  </p>
                                  {d.closedAt && (
                                    <p className="text-xs text-muted-foreground">
                                      Закрыт {formatDateTime(d.closedAt)}
                                    </p>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  {d.excess > 0 ? (
                                    <p className="font-semibold">{money(d.money)} ₽</p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">В норме</p>
                                  )}
                                  {/* Что решил администратор по этому рулону. */}
                                  {d.penaltyTotal === 0 ? (
                                    <Badge variant="outline" className="mt-0.5 font-normal">
                                      Вина поставщика
                                    </Badge>
                                  ) : d.penaltyTotal != null ? (
                                    <Badge variant="secondary" className="mt-0.5 font-normal">
                                      Штраф удержан
                                    </Badge>
                                  ) : d.excess > 0 ? (
                                    <Badge variant="outline" className="mt-0.5 font-normal">
                                      Ждёт решения
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <Button variant="outline" size="sm" onClick={() => setOpenUser(null)}>
          <Icon name="ChevronsUp" size={14} className="mr-1" />
          Свернуть всё
        </Button>
      )}
    </div>
  );
};

export default CutterAnalysisTab;
