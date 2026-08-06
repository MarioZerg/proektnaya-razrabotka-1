import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchRolls, createRoll, type Roll, type RollStatus } from '@/lib/rollsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { formatDateTime as formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import { shiftLabel } from '@/components/crm/shipments/toWorkshopShared';

const statusLabels: Record<RollStatus, { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  in_storage: { label: 'На складе', variant: 'secondary' },
  in_workshop: { label: 'В цехе', variant: 'default' },
  completed: { label: 'Завершён', variant: 'outline' },
};

const Rolls = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    barcode: '',
    materialId: '',
    initialQuantity: '',
    workshopId: '',
    shiftNumber: '',
  });

  // Швея, закройщик и упаковщик видят рулоны только своего цеха (сервер фильтрует по
  // цеху их открытой смены) и не могут заводить новые — это работа кладовщика.
  const isProductionRole =
    user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  // Рулоны заводятся только приёмкой от поставщика (Отгрузки → Отгрузка от поставщика):
  // так у каждого рулона есть документ прихода, поставщик и цена. Ручное создание оставлено
  // администратору на случай исправления данных.
  const canCreateRoll = user?.role === 'admin';

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchRolls(isProductionRole && user ? { forUserId: user.id } : undefined),
      fetchMaterialsData(),
      fetchWorkshops(),
    ])
      .then(([rollsData, materialsData, workshopsData]) => {
        setRolls(rollsData);
        setMaterials(materialsData.materials);
        setWorkshops(workshopsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = rolls.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (materialFilter !== 'all' && String(r.materialId) !== materialFilter) return false;
    if (search && !r.barcode.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openCreate = () => {
    setForm({ barcode: '', materialId: '', initialQuantity: '', workshopId: '', shiftNumber: '' });
    setDialogOpen(true);
  };

  const selectedWorkshop = workshops.find((w) => String(w.id) === form.workshopId);

  const handleSave = async () => {
    if (!form.barcode.trim() || !form.materialId || !form.initialQuantity) return;
    // Рулон, отправляемый сразу в цех, обязан принадлежать конкретной смене — "ничейных"
    // рулонов в цехе быть не может (проверяется и на сервере, и на уровне БД).
    if (form.workshopId && !form.shiftNumber) {
      toast({ title: 'Укажите смену', description: 'При выборе цеха смена обязательна', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createRoll({
        barcode: form.barcode.trim(),
        materialId: Number(form.materialId),
        initialQuantity: Number(form.initialQuantity),
        workshopId: form.workshopId ? Number(form.workshopId) : undefined,
        shiftNumber: form.workshopId && form.shiftNumber ? Number(form.shiftNumber) : undefined,
        actorRole: user?.role,
      });
      toast({ title: 'Рулон добавлен' });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось сохранить', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Рулоны материалов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isProductionRole
                ? 'Рулоны вашего цеха: остаток, статус и штрихкод'
                : canCreateRoll
                  ? 'Партии материалов со штрихкодом, остатком и статусом'
                  : 'Партии материалов со штрихкодом, остатком и статусом. Новые рулоны заводятся приёмкой в разделе «Отгрузка от поставщика»'}
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            {canCreateRoll && (
              <DialogTrigger asChild>
                <Button onClick={openCreate}>
                  <Icon name="Plus" size={16} className="mr-2" />
                  Добавить рулон
                </Button>
              </DialogTrigger>
            )}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новый рулон</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Штрихкод</Label>
                  <Input
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    placeholder="Например: 1-004824"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Материал</Label>
                  <Select
                    value={form.materialId}
                    onValueChange={(v) => setForm((f) => ({ ...f, materialId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите материал" />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name} ({m.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Начальное количество</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.initialQuantity}
                    onChange={(e) => setForm((f) => ({ ...f, initialQuantity: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Цех (необязательно)</Label>
                  <Select
                    value={form.workshopId || 'none'}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, workshopId: v === 'none' ? '' : v, shiftNumber: '' }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Склад" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Склад (без цеха)</SelectItem>
                      {workshops.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.workshopId && (
                  <div className="space-y-1.5">
                    <Label>Смена</Label>
                    <Select
                      value={form.shiftNumber}
                      onValueChange={(v) => setForm((f) => ({ ...f, shiftNumber: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите смену" />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedWorkshop?.shiftNames || []).map((name, idx) => (
                          <SelectItem key={idx + 1} value={String(idx + 1)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Рулон в цехе обязательно должен принадлежать смене
                    </p>
                  </div>
                )}
                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="in_storage">На складе</SelectItem>
              <SelectItem value="in_workshop">В цехе</SelectItem>
              <SelectItem value="completed">Завершён</SelectItem>
            </SelectContent>
          </Select>

          <Select value={materialFilter} onValueChange={setMaterialFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все материалы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все материалы</SelectItem>
              {materials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Поиск по штрихкоду"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Рулонов не найдено</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Штрихкод</TableHead>
                  <TableHead className="text-primary-foreground">Материал</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Смена</TableHead>
                  <TableHead className="text-primary-foreground">Остаток</TableHead>
                  <TableHead className="text-primary-foreground">Недостача</TableHead>
                  <TableHead className="text-primary-foreground">Создан</TableHead>
                  <TableHead className="text-primary-foreground">Завершён</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/crm/inventory/rolls/${r.id}`)}
                  >
                    <TableCell>{r.id}</TableCell>
                    <TableCell>
                      <Badge variant={statusLabels[r.status].variant}>
                        {statusLabels[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono-tech">{r.barcode}</TableCell>
                    <TableCell>{r.materialName || '—'}</TableCell>
                    <TableCell>{r.workshopName || '—'}</TableCell>
                    <TableCell>{shiftLabel(workshops, r.workshopId, r.shiftNumber)}</TableCell>
                    <TableCell>
                      {formatQuantity(r.remainingQuantity)} из {formatQuantity(r.initialQuantity)} {r.unit}
                    </TableCell>
                    <TableCell>
                      {r.shortageQuantity && r.shortageQuantity > 0 ? (
                        <Badge variant="destructive" className="font-normal">
                          {formatQuantity(r.shortageQuantity)} {r.unit}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{formatDate(r.createdAt)}</TableCell>
                    <TableCell>{r.completedAt ? formatDate(r.completedAt) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default Rolls;