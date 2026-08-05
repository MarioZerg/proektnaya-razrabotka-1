import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  fetchShortageStats,
  type ShortageByMaterial,
  type ShortageByUser,
  type ShortageRoll,
} from '@/lib/rollsApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
const pct = (v: number) => `${v.toFixed(2)}%`;
const num = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU') : '—';

/**
 * ВРЕМЕННАЯ страница: сбор статистики недостач по рулонам. Нужна, чтобы за месяц накопить
 * реальные цифры — сколько метров в среднем «не хватает» в целом рулоне по каждой ткани.
 * На основе этих данных потом зададим нормы недостачи и включим списание за перерасход.
 * После ввода норм страницу можно удалить.
 */
const RollShortageAnalysis = () => {
  const [byMaterial, setByMaterial] = useState<ShortageByMaterial[]>([]);
  const [byUser, setByUser] = useState<ShortageByUser[]>([]);
  const [rolls, setRolls] = useState<ShortageRoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    setLoading(true);
    fetchShortageStats({ from, to })
      .then((data) => {
        setByMaterial(data.byMaterial);
        setByUser(data.byUser);
        setRolls(data.rolls);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRolls = byMaterial.reduce((a, m) => a + m.rollsClosed, 0);
  const totalCost = byMaterial.reduce((a, m) => a + m.costTotal, 0);
  const totalShortageRolls = byMaterial.reduce((a, m) => a + m.rollsWithShortage, 0);
  const avgPercent =
    byMaterial.length > 0
      ? byMaterial.reduce((a, m) => a + m.avgPercent, 0) / byMaterial.length
      : 0;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Анализ недостач по рулонам</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сбор статистики: сколько ткани в среднем не хватает в целом рулоне. Пока никто не
            штрафуется — копим данные, чтобы задать справедливые нормы.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Период с</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label>по</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
          <Button onClick={load} disabled={loading}>
            <Icon name={loading ? 'Loader2' : 'Search'} size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
            Показать
          </Button>
          {(from || to) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Сбросить период
            </Button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Закрыто рулонов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{totalRolls}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                С недостачей
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{totalShortageRolls}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Средняя недостача
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{pct(avgPercent)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Потери по себестоимости
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{money(totalCost)}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="materials">
          <TabsList>
            <TabsTrigger value="materials">По материалам</TabsTrigger>
            <TabsTrigger value="users">По закройщикам</TabsTrigger>
            <TabsTrigger value="rolls">Все рулоны</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="mt-4">
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Материал</TableHead>
                    <TableHead className="text-right">Себестоимость</TableHead>
                    <TableHead className="text-right">Рулонов</TableHead>
                    <TableHead className="text-right">С недостачей</TableHead>
                    <TableHead className="text-right">Средняя</TableHead>
                    <TableHead className="text-right">Максимум</TableHead>
                    <TableHead className="text-right">Всего не хватило</TableHead>
                    <TableHead className="text-right">Потери</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byMaterial.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        {loading ? 'Загрузка…' : 'Закрытых рулонов за период нет'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    byMaterial.map((m) => (
                      <TableRow key={m.materialId}>
                        <TableCell className="font-medium">{m.material}</TableCell>
                        <TableCell className="text-right">{money(m.cost)} / {m.unit}</TableCell>
                        <TableCell className="text-right">{m.rollsClosed}</TableCell>
                        <TableCell className="text-right">{m.rollsWithShortage}</TableCell>
                        <TableCell className="text-right font-semibold">{pct(m.avgPercent)}</TableCell>
                        <TableCell className="text-right">{pct(m.maxPercent)}</TableCell>
                        <TableCell className="text-right">
                          {num(m.shortageTotal)} {m.unit}
                        </TableCell>
                        <TableCell className="text-right">{money(m.costTotal)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Закройщик</TableHead>
                    <TableHead className="text-right">Закрыл рулонов</TableHead>
                    <TableHead className="text-right">Средняя недостача</TableHead>
                    <TableHead className="text-right">Всего не хватило</TableHead>
                    <TableHead className="text-right">Потери</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byUser.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {loading ? 'Загрузка…' : 'Данных пока нет'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    byUser.map((u) => (
                      <TableRow key={`${u.userId}-${u.userName}`}>
                        <TableCell className="font-medium">{u.userName}</TableCell>
                        <TableCell className="text-right">{u.rollsClosed}</TableCell>
                        <TableCell className="text-right font-semibold">{pct(u.avgPercent)}</TableCell>
                        <TableCell className="text-right">{num(u.shortageTotal)}</TableCell>
                        <TableCell className="text-right">{money(u.costTotal)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="rolls" className="mt-4">
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Штрихкод</TableHead>
                    <TableHead>Материал</TableHead>
                    <TableHead className="text-right">В рулоне было</TableHead>
                    <TableHead className="text-right">Недостача</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead>Закрыл</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Потери</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rolls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        {loading ? 'Загрузка…' : 'Закрытых рулонов за период нет'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rolls.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono-tech">{r.barcode}</TableCell>
                        <TableCell>{r.material}</TableCell>
                        <TableCell className="text-right">
                          {num(r.initialQuantity)} {r.unit}
                        </TableCell>
                        <TableCell className="text-right">{num(r.shortage)}</TableCell>
                        <TableCell className="text-right">
                          {r.shortagePercent > 0 ? (
                            <Badge
                              variant="secondary"
                              className={
                                r.shortagePercent >= 5
                                  ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                  : 'bg-amber-100 text-amber-700 hover:bg-amber-100'
                              }
                            >
                              {pct(r.shortagePercent)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{r.closedBy || '—'}</TableCell>
                        <TableCell>{formatDate(r.completedAt)}</TableCell>
                        <TableCell className="text-right">{money(r.cost)}</TableCell>
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

export default RollShortageAnalysis;
