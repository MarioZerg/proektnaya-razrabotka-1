import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import MaterialSignalsCard from '@/components/crm/analytics/MaterialSignalsCard';
import MaterialPeopleTable from '@/components/crm/analytics/MaterialPeopleTable';
import { fetchMaterialAnalysis, type MaterialAnalysis } from '@/lib/rollsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { formatDate } from '@/lib/dateUtils';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const num = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';

/** Первое число текущего месяца — разумный период по умолчанию. */
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/**
 * АНАЛИЗ СЫРЬЯ — куда девается материал.
 *
 * Заменяет две прежние страницы: «Анализ недостач» и «Анализ брака». Они
 * отвечали на один вопрос, но смотреть их приходилось порознь, и связать
 * глазами было невозможно.
 *
 * А связь прямая и денежная. Не оформили брак — обрезки всплывут недостачей.
 * Списали полотном 30 метров — недостача идеальная, потери просто переехали в
 * другую графу. По отдельности обе картины выглядят нормально, вместе — видны.
 * Поэтому система сама ищет такие случаи и выносит их наверх страницы.
 */
const MaterialAnalysisPage = () => {
  const [data, setData] = useState<MaterialAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState('');
  const [role, setRole] = useState('all');
  const [workshop, setWorkshop] = useState('all');
  const [workshops, setWorkshops] = useState<Workshop[]>([]);

  useEffect(() => {
    fetchWorkshops().then(setWorkshops).catch(() => {
      // FRONTEND-ONLY: фильтр цехов вторичен. Сбой не прячет отчёт.
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetchMaterialAnalysis({
      from,
      to,
      role: role === 'all' ? '' : role,
      workshop: workshop === 'all' ? '' : workshop,
    })
      .then((d) => {
        setListError(null);
        setData(d);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить анализ сырья');
      })
      .finally(() => setLoading(false));
  }, [from, to, role, workshop]);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Анализ сырья</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Куда девается материал: недостачи и списанный брак в одной картине.
          </p>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить анализ сырья"
            description={listError}
            onRetry={load}
          />
        )}

        <div className="grid grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap">
          <div className="space-y-1.5">
            <Label className="text-xs">Период с</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-11 w-full sm:h-10 lg:w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">по</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-11 w-full sm:h-10 lg:w-40"
            />
          </div>
          <div className="col-span-2 space-y-1.5 lg:col-span-1">
            <Label className="text-xs">Должность</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-11 w-full sm:h-10 lg:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все должности</SelectItem>
                <SelectItem value="cutter">Закройщики</SelectItem>
                <SelectItem value="sewer">Швеи</SelectItem>
                <SelectItem value="packer">Упаковщики</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 lg:col-span-1">
            <Label className="text-xs">Цех</Label>
            <Select value={workshop} onValueChange={setWorkshop}>
              <SelectTrigger className="h-11 w-full sm:h-10 lg:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все цеха</SelectItem>
                {workshops.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            className="col-span-2 h-11 lg:col-span-1 lg:h-10"
          >
            <Icon
              name={loading ? 'Loader2' : 'RefreshCw'}
              size={14}
              className={`mr-1 ${loading ? 'animate-spin' : ''}`}
            />
            Обновить
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <Card>
            <CardContent className="p-3 sm:py-4">
              <p className="text-xs text-muted-foreground sm:text-sm">Недостача</p>
              <p className="text-xl font-bold sm:text-2xl">{num(t?.shortageQty || 0)}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">{money(t?.shortageMoney || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:py-4">
              <p className="text-xs text-muted-foreground sm:text-sm">Списано в брак</p>
              <p className="text-xl font-bold sm:text-2xl">{num(t?.defectQty || 0)}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">{money(t?.defectMoney || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:py-4">
              <p className="text-xs text-muted-foreground sm:text-sm">Всего потерь</p>
              <p className="text-xl font-bold sm:text-2xl">
                {money((t?.shortageMoney || 0) + (t?.defectMoney || 0))}
              </p>
              <p className="text-xs text-muted-foreground sm:text-sm">
                закрыто рулонов: {t?.rollsClosed || 0}
              </p>
            </CardContent>
          </Card>
          <Card className={t?.signalsCount ? 'border-amber-400' : undefined}>
            <CardContent className="p-3 sm:py-4">
              <p className="text-xs text-muted-foreground sm:text-sm">Требует внимания</p>
              <p className="text-xl font-bold sm:text-2xl">{t?.signalsCount || 0}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">найденных отклонений</p>
            </CardContent>
          </Card>
        </div>

        <MaterialSignalsCard people={data?.people || []} />

        <Tabs defaultValue="people">
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="people" className="min-h-11 px-2 sm:min-h-9">
              Сотрудники
            </TabsTrigger>
            <TabsTrigger value="materials" className="min-h-11 px-2 sm:min-h-9">
              Материалы
            </TabsTrigger>
            <TabsTrigger value="spikes" className="min-h-11 px-1.5 sm:min-h-9">
              Всплески{data?.spikes.length ? ` (${data.spikes.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="mt-4">
            <MaterialPeopleTable people={data?.people || []} loading={loading} />
          </TabsContent>

          <TabsContent value="materials" className="mt-4">
            {!data?.byMaterial.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {loading ? 'Загрузка…' : listError ? 'Не удалось загрузить' : 'За период данных нет'}
              </p>
            ) : (
              <>
                <div className="space-y-2 lg:hidden">
                  {data.byMaterial.map((m) => (
                    <div
                      key={m.materialId}
                      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
                    >
                      <p className="break-words font-semibold leading-snug">{m.material}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {m.rollsClosed} рул.
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <span className="text-muted-foreground">Недостача</span>
                        <span className="text-right tabular-nums">
                          {num(m.shortageQty)} {m.unit}
                          <span className="ml-1.5 text-muted-foreground">
                            {m.shortagePercent.toFixed(1)}%
                          </span>
                        </span>
                        <span className="text-muted-foreground">Брак</span>
                        <span className="text-right tabular-nums">
                          {m.defectQty > 0 ? `${num(m.defectQty)} ${m.unit}` : '—'}
                        </span>
                        <span className="text-muted-foreground">Потери</span>
                        <span className="text-right font-semibold tabular-nums">
                          {money(m.shortageMoney + m.defectMoney)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Материал</TableHead>
                        <TableHead className="text-right text-primary-foreground">Рулонов</TableHead>
                        <TableHead className="text-right text-primary-foreground">Недостача</TableHead>
                        <TableHead className="text-right text-primary-foreground">%</TableHead>
                        <TableHead className="text-right text-primary-foreground">Брак</TableHead>
                        <TableHead className="text-right text-primary-foreground">Потери</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byMaterial.map((m) => (
                        <TableRow key={m.materialId}>
                          <TableCell className="font-medium">{m.material}</TableCell>
                          <TableCell className="text-right">{m.rollsClosed}</TableCell>
                          <TableCell className="text-right">
                            {num(m.shortageQty)} {m.unit}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.shortagePercent.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {m.defectQty > 0 ? `${num(m.defectQty)} ${m.unit}` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">
                            {money(m.shortageMoney + m.defectMoney)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </TabsContent>

          {/* ВСПЛЕСКИ. Разовый крупный кусок сам по себе ни о чём не говорит —
              бывает брак полотна. Важно, что день выбивается из обычного
              поведения ЭТОГО ЖЕ человека: вдвое тяжелее его среднего дня. */}
          <TabsContent value="spikes" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Дни, когда сотрудник списал в брак вдвое больше своего обычного. Часто
              это значит, что брак копили и оформили разом — или списали крупный
              кусок полотна.
            </p>
            {!data?.spikes.length ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {loading ? 'Загрузка…' : 'Всплесков за период не было'}
              </p>
            ) : (
              <>
                <div className="space-y-2 lg:hidden">
                  {data.spikes.map((s, i) => (
                    <div
                      key={`${s.userName}-${s.date}-${i}`}
                      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 break-words font-semibold leading-snug">
                          {s.userName}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(s.date)}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <span className="text-muted-foreground">За день</span>
                        <span className="text-right font-semibold tabular-nums">
                          {num(s.quantity)}
                        </span>
                        <span className="text-muted-foreground">Записей</span>
                        <span className="text-right tabular-nums">{s.count}</span>
                        <span className="text-muted-foreground">Макс. кусок</span>
                        <span
                          className={`text-right tabular-nums ${
                            s.maxPiece >= 15 ? 'font-semibold text-red-700' : ''
                          }`}
                        >
                          {num(s.maxPiece)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Дата</TableHead>
                        <TableHead className="text-primary-foreground">Сотрудник</TableHead>
                        <TableHead className="text-right text-primary-foreground">За день</TableHead>
                        <TableHead className="text-right text-primary-foreground">Записей</TableHead>
                        <TableHead className="text-right text-primary-foreground">
                          Макс. кусок
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.spikes.map((s, i) => (
                        <TableRow key={`${s.userName}-${s.date}-${i}`}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(s.date)}
                          </TableCell>
                          <TableCell className="font-medium">{s.userName}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {num(s.quantity)}
                          </TableCell>
                          <TableCell className="text-right">{s.count}</TableCell>
                          <TableCell className="text-right">
                            <span className={s.maxPiece >= 15 ? 'font-semibold text-red-700' : ''}>
                              {num(s.maxPiece)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </CrmLayout>
  );
};

export default MaterialAnalysisPage;
