import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  setSupplierPrices,
  CURRENCIES,
  currencySymbols,
  type Supplier,
} from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';

interface SupplierPricesDialogProps {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PriceRow {
  price: string;
  currency: string;
}

/**
 * Прайс поставщика — цена каждого материала именно у него.
 *
 * Один и тот же материал у разных поставщиков стоит по-разному, поэтому себестоимость
 * считается не «вообще по материалу», а по тому, у кого он куплен. Цена может быть
 * в валюте (вуаль 1.4 $ — умножится на курс при приёмке) или фиксированной в рублях
 * (тесьма 5.90 ₽ — курс не применяется).
 */
const SupplierPricesDialog = ({ supplier, onClose, onSaved }: SupplierPricesDialogProps) => {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [rows, setRows] = useState<Record<number, PriceRow>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setLoading(true);
    fetchMaterialsData()
      .then(({ materials: list }) => {
        const active = list.filter((m) => m.status === 'active');
        setMaterials(active);
        // Подставляем уже сохранённые цены, остальным — валюту поставщика по умолчанию.
        const existing: Record<number, PriceRow> = {};
        for (const m of active) {
          const saved = supplier.prices?.find((p) => p.materialId === m.id);
          existing[m.id] = {
            price: saved ? String(saved.price) : '',
            currency: saved?.currency || supplier.currency || 'RUB',
          };
        }
        setRows(existing);
      })
      .catch(() => setMaterials([]))
      .finally(() => setLoading(false));
  }, [supplier]);

  const handleSave = async () => {
    if (!supplier) return;
    const prices = Object.entries(rows)
      .filter(([, r]) => r.price.trim() !== '')
      .map(([materialId, r]) => ({
        materialId: Number(materialId),
        price: Number(r.price.replace(',', '.')),
        currency: r.currency,
      }));

    if (prices.some((p) => Number.isNaN(p.price) || p.price < 0)) {
      toast({
        title: 'Проверьте цены',
        description: 'Цена должна быть числом не меньше нуля',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      await setSupplierPrices(supplier.id, prices);
      toast({ title: 'Прайс сохранён', description: `Цен указано: ${prices.length}` });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить прайс',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!supplier} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Прайс — {supplier?.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Цена за единицу материала у этого поставщика. При приёмке она подставится
          автоматически, администратор сможет её изменить. Валютная цена умножается на курс,
          рублёвая берётся как есть.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка материалов…
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Материал</TableHead>
                  <TableHead className="w-[140px]">Цена за единицу</TableHead>
                  <TableHead className="w-[120px]">Валюта</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">за 1 {m.unit}</p>
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        placeholder="—"
                        value={rows[m.id]?.price ?? ''}
                        onChange={(e) =>
                          setRows((prev) => ({
                            ...prev,
                            [m.id]: { ...prev[m.id], price: e.target.value },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={rows[m.id]?.currency || 'RUB'}
                        onValueChange={(v) =>
                          setRows((prev) => ({
                            ...prev,
                            [m.id]: { ...prev[m.id], currency: v },
                          }))
                        }
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Button onClick={handleSave} disabled={saving || loading} className="w-full">
          {saving ? <Icon name="Loader2" size={16} className="mr-2 animate-spin" /> : null}
          Сохранить прайс
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierPricesDialog;
