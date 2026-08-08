import { useEffect, useState } from 'react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  CURRENCIES,
  currencySymbols,
  type Supplier,
} from '@/lib/suppliersApi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SupplierPricesDialog from '@/components/crm/suppliers/SupplierPricesDialog';

interface SupplierFormState {
  name: string;
  phone: string;
  address: string;
  comment: string;
  /** Валюта прайса: цены ткани часто в долларах, тесьма — в рублях. */
  currency: string;
  /** Курс к рублю. Подставится при приёмке, администратор сможет поправить. */
  exchangeRate: string;
  /** Допустимая недостача в рулоне, %. Пусто — штрафы по этому поставщику не начисляются. */
  shortageNormPercent: string;
}

const emptyForm: SupplierFormState = {
  name: '',
  phone: '',
  address: '',
  comment: '',
  currency: 'RUB',
  exchangeRate: '',
  shortageNormPercent: '',
};
const PAGE_SIZE = 10;

const SuppliersSettings = () => {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  // Поставщик, у которого сейчас открыт прайс.
  const [pricesFor, setPricesFor] = useState<Supplier | null>(null);

  const load = () => {
    setLoading(true);
    fetchSuppliers()
      .then(setSuppliers)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      phone: s.phone || '',
      address: s.address || '',
      comment: s.comment || '',
      currency: s.currency || 'RUB',
      exchangeRate: s.exchangeRate != null ? String(s.exchangeRate) : '',
      shortageNormPercent:
        s.shortageNormPercent != null ? String(s.shortageNormPercent) : '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        address: form.address,
        comment: form.comment,
        currency: form.currency,
        // Для рублёвого поставщика курс не нужен — он всегда 1.
        exchangeRate:
          form.currency === 'RUB' || !form.exchangeRate.trim()
            ? null
            : Number(form.exchangeRate.replace(',', '.')),
        // Пустая норма — штрафы за недостачу по этому поставщику не начисляются.
        shortageNormPercent: form.shortageNormPercent.trim()
          ? Number(form.shortageNormPercent.replace(',', '.'))
          : null,
      };
      if (editingId) {
        await updateSupplier(editingId, payload);
      } else {
        await createSupplier(payload);
      }
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(suppliers.length / PAGE_SIZE));
  const pagedSuppliers = suppliers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteSupplier(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Не удалось удалить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Поставщики</h1>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                <Icon name="Plus" size={16} className="mr-1.5" />
                Добавить поставщика
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Изменить поставщика' : 'Новый поставщик'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Название</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Телефон</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Адрес</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Input
                    value={form.comment}
                    onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                  />
                </div>

                {/* Валюта и курс: у валютного поставщика цена умножается на курс при
                    приёмке. У рублёвого курс не нужен — цена фиксированная. */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Валюта прайса</Label>
                    <Select
                      value={form.currency}
                      onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                    >
                      <SelectTrigger>
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
                  {form.currency !== 'RUB' && (
                    <div className="space-y-1.5">
                      {/* Формулировка «Курс к рублю» путала: непонятно, что вводить.
                          Пишем прямо — сколько рублей стоит одна единица валюты. */}
                      <Label>
                        Рублей за 1 {currencySymbols[form.currency] || form.currency}
                      </Label>
                      <Input
                        inputMode="decimal"
                        placeholder="65"
                        value={form.exchangeRate}
                        onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                {form.currency !== 'RUB' && (
                  <p className="text-xs text-muted-foreground">
                    Курс подставится при приёмке — администратор сможет поправить его под
                    реальный курс дня.
                  </p>
                )}

                {/* Норма недостачи. Поставщик мотает рулон с погрешностью: часть метража
                    просто не доложена. Пока недостача в пределах нормы — это нормально,
                    штраф начисляется только за превышение. */}
                <div className="space-y-1.5">
                  <Label>Допустимая недостача в рулоне, %</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="Не задана — штрафов нет"
                    value={form.shortageNormPercent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, shortageNormPercent: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Сколько метров может не хватить в рулоне без штрафа. Например, 2% — в
                    рулоне 100 м допустимо 2 м недостачи. За превышение сотрудники платят
                    по себестоимости рулона. Оставьте пустым, чтобы не штрафовать.
                  </p>
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Поставщиков пока нет.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Телефон</TableHead>
                  <TableHead className="text-primary-foreground">Адрес</TableHead>
                  <TableHead className="text-primary-foreground">Валюта / курс</TableHead>
                  <TableHead className="text-primary-foreground">Цен в прайсе</TableHead>
                  <TableHead className="text-primary-foreground">Норма недостачи</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedSuppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.phone || '—'}</TableCell>
                    <TableCell>{s.address || '—'}</TableCell>
                    {/* Курс пишем формулой «1 $ = 65 ₽»: просто «USD · 65» читается неоднозначно. */}
                    <TableCell>
                      {s.currency && s.currency !== 'RUB' ? (
                        s.exchangeRate ? (
                          <span>
                            1 {currencySymbols[s.currency] || s.currency} ={' '}
                            <b>{s.exchangeRate}</b> ₽
                          </span>
                        ) : (
                          <span className="text-destructive">
                            {s.currency} — курс не указан
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Рубли</span>
                      )}
                    </TableCell>
                    <TableCell>{s.prices?.length || 0}</TableCell>
                    {/* Норма недостачи: видно, по кому штрафы включены, а по кому нет. */}
                    <TableCell>
                      {s.shortageNormPercent != null ? (
                        `${s.shortageNormPercent}%`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          title="Прайс материалов"
                          onClick={() => setPricesFor(s)}
                        >
                          <Icon name="Tags" size={14} />
                        </Button>
                        <Button size="icon" variant="secondary" onClick={() => openEdit(s)}>
                          <Icon name="Pencil" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive" onClick={() => setDeleteId(s.id)}>
                          <Icon name="Trash2" size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              size="icon"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <Icon name="ChevronLeft" size={16} />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                size="icon"
                variant={p === page ? 'default' : 'outline'}
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button
              size="icon"
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <Icon name="ChevronRight" size={16} />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить поставщика?</AlertDialogTitle>
            <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SupplierPricesDialog
        supplier={pricesFor}
        onClose={() => setPricesFor(null)}
        onSaved={load}
      />
    </CrmLayout>
  );
};

export default SuppliersSettings;