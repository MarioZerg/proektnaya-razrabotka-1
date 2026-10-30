import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { addRollToClosedSupply, type ShipmentDetail } from '@/lib/shipmentsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatQuantity } from '@/lib/formatQuantity';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: ShipmentDetail;
  onAdded: () => void;
}

/**
 * Довнести рулон в уже принятую приёмку — только администратор.
 *
 * Рулон пропустили при разгрузке или поставщик довёз его по той же накладной.
 * Новая приёмка ради одного рулона разорвала бы документ, поэтому добавляем его
 * в эту же: новый штрихкод, рулон сразу на складе, цена — из прайса поставщика.
 */
const AddRollToClosedDialog = ({ open, onOpenChange, detail, onAdded }: Props) => {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [materialId, setMaterialId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  // Поставщики, которые уже есть в приёмке, — их предлагаем первыми.
  const docSupplierIds = useMemo(() => {
    const ids = new Set<number>();
    if (detail.supplierId) ids.add(detail.supplierId);
    detail.items.forEach((i) => i.supplierId && ids.add(i.supplierId));
    return ids;
  }, [detail]);

  useEffect(() => {
    if (!open) return;
    setMaterialId('');
    setQuantity('');
    setPrice('');
    setSearch('');
    const first = [...docSupplierIds][0];
    setSupplierId(first ? String(first) : '');
    setLoading(true);
    Promise.all([fetchMaterialsData(), fetchSuppliers()])
      .then(([m, s]) => {
        setMaterials(m.materials);
        setSuppliers(s);
      })
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить справочники',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }, [open, docSupplierIds, toast]);

  const supplier = suppliers.find((s) => String(s.id) === supplierId);
  const material = materials.find((m) => String(m.id) === materialId);
  const listPrice = supplier?.prices.find((p) => String(p.materialId) === materialId);

  // Материалы из прайса поставщика — наверх: это и есть то, что он возит.
  const materialOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inPrice = new Set((supplier?.prices || []).map((p) => p.materialId));
    return materials
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => Number(inPrice.has(b.id)) - Number(inPrice.has(a.id)) || a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [materials, search, supplier]);

  const sortedSuppliers = useMemo(
    () =>
      [...suppliers].sort(
        (a, b) => Number(docSupplierIds.has(b.id)) - Number(docSupplierIds.has(a.id)) || a.name.localeCompare(b.name),
      ),
    [suppliers, docSupplierIds],
  );

  const qtyNum = Number(quantity.replace(',', '.'));
  const priceNum = price.trim() ? Number(price.replace(',', '.')) : null;
  const canSave =
    !!materialId && qtyNum > 0 && (priceNum == null || (Number.isFinite(priceNum) && priceNum >= 0)) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await addRollToClosedSupply({
        id: detail.id,
        materialId: Number(materialId),
        quantity: qtyNum,
        supplierId: supplierId ? Number(supplierId) : null,
        ...(priceNum != null
          ? { price: priceNum, currency: listPrice?.currency || supplier?.currency || 'RUB' }
          : {}),
      });
      toast({
        title: `Рулон ${r.barcode} добавлен в приёмку`,
        description: r.accountantReopened
          ? 'Приёмка вернулась бухгалтеру на проверку — сумма изменилась'
          : 'Рулон уже на складе. Наклейте стикер',
      });
      printBarcodes(
        [
          {
            code: r.barcode,
            label: `${r.materialName} — ${formatQuantity(r.quantity)} ${r.unit || ''}`,
            supplier: supplier?.name || detail.supplierName,
            receivedAt: detail.completedAt || detail.createdAt,
          },
        ],
        `Приёмка #${detail.id}`,
      );
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast({
        title: 'Рулон не добавлен',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить рулон в приёмку #{detail.id}</DialogTitle>
          <DialogDescription>
            Рулон сразу встанет на склад с новым штрихкодом — стикер откроется на печать.
            Логистика приёмки пересчитается и на него.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Загрузка...</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Поставщик</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите поставщика" />
                </SelectTrigger>
                <SelectContent>
                  {sortedSuppliers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                      {docSupplierIds.has(s.id) ? ' · в этой приёмке' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Материал</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию"
              />
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите материал" />
                </SelectTrigger>
                <SelectContent>
                  {materialOptions.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Метраж{material?.unit ? `, ${material.unit}` : ''}</Label>
                <Input
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Например, 50"
                />
              </div>
              <div className="space-y-1">
                <Label>Цена за ед.</Label>
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={listPrice ? String(listPrice.price) : 'из прайса'}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {listPrice
                ? `По прайсу поставщика: ${listPrice.price} ${listPrice.currency}. Оставьте поле пустым — возьмётся она.`
                : materialId
                  ? 'В прайсе поставщика этой цены нет — укажите её, иначе рулон встанет без себестоимости.'
                  : 'Цена берётся из прайса поставщика, если поле пустое.'}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!canSave}>
            <Icon name={saving ? 'Loader2' : 'Plus'} size={16} className={saving ? 'mr-1 animate-spin' : 'mr-1'} />
            Добавить рулон
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddRollToClosedDialog;
