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
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState('');
  const [role, setRole] = useState('all');
  const [workshop, setWorkshop] = useState('all');
  const [workshops, setWorkshops] = useState<Workshop[]>([]);

  useEffect(() => {
    fetchWorkshops().then(setWorkshops).catch(() => setWorkshops([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetchMaterialAnalysis({
      from,
      to,
      role: role === 'all' ? '' : role,
      workshop: workshop === 'all' ? '' : workshop,
    })
      .then(setData)
      .catch(() => setData(null))
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
          <h1 className="text-2xl font-bold">Анализ сырья</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Куда девается материал: недостачи и списанный брак в одной картине.
            Недостача считается по факту закрытия рулона — сколько метров числилось,
            но в изделия не ушло.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Период с</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label>по</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Должность</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full sm:w-44">
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
          <div className="space-y-1.5">
            <Label>Цех</Label>
            <Select value={workshop} onValueChange={setWorkshop}>
              <SelectTrigger className="w-full sm:w-44">
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
          <Button variant="outline" onClick={load} disabled={loading}>
            <Icon
              name={loading ? 'Loader2' : 'RefreshCw'}
              size={14}
              className={`mr-1 ${loading ? 'animate-spin' : ''}`}
            />
            Обновить
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Недостача</p>
              <p className="text-2xl font-bold">{num(t?.shortageQty || 0)}</p>
              <p className="text-sm text-muted-foreground">{money(t?.shortageMoney || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Списано в брак</p>
              <p className="text-2xl font-bold">{num(t?.defectQty || 0)}</p>
              <p className="text-sm text-muted-foreground">{money(t?.defectMoney || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Всего потерь</p>
              <p className="text-2xl font-bold">
                {money((t?.shortageMoney || 0) + (t?.defectMoney || 0))}
              </p>
              <p className="text-sm text-muted-foreground">
                закрыто рулонов: {t?.rollsClosed || 0}
              </p>
            </CardContent>
          </Card>
          <Card className={t?.signalsCount ? 'border-amber-400' : undefined}>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Требует внимания</p>
              <p className="text-2xl font-bold">{t?.signalsCount || 0}</p>
              <p className="text-sm text-muted-foreground">найденных отклонений</p>
            </CardContent>
          </Card>
        </div>

        <MaterialSignalsCard people={data?.people || []} />

        <Tabs defaultValue="people">
          <TabsList>
            <TabsTrigger value="people">По сотрудникам</TabsTrigger>
            <TabsTrigger value="materials">По материалам</TabsTrigger>
            <TabsTrigger value="spikes">
              Всплески{data?.spikes.length ? ` (${data.spikes.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="mt-4">
            <MaterialPeopleTable people={data?.people || []} loading={loading} />
          </TabsContent>

          <TabsContent value="materials" className="mt-4">
            <div className="overflow-x-auto rounded-md border border-border">
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
                  {!data?.byMaterial.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {loading ? 'Загрузка…' : 'За период данных нет'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.byMaterial.map((m) => (
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
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
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
            <div className="overflow-x-auto rounded-md border border-border">
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
                  {!data?.spikes.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {loading ? 'Загрузка…' : 'Всплесков за период не было'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.spikes.map((s, i) => (
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
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CrmLayout>
  );
};

export default MaterialAnalysisPage;
