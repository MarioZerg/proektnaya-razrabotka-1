import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import {
  fetchSupplies,
  type Supply,
  type OzonDeliveryMethod,
} from '@/lib/marketplaceSuppliesApi';

interface CreateOzonFboDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creating: boolean;
  onSelectExisting: (supplyId: number) => void;
  onCreateDraft: (deliveryMethod: OzonDeliveryMethod) => void;
}

const deliveryMethodOptions: Array<{ value: OzonDeliveryMethod; label: string }> = [
  { value: 'direct', label: 'Прямая поставка' },
  { value: 'cross_docking', label: 'Кросс-докинг' },
];

const CreateOzonFboDialog = ({
  open,
  onOpenChange,
  creating,
  onSelectExisting,
  onCreateDraft,
}: CreateOzonFboDialogProps) => {
  const [existingSupplies, setExistingSupplies] = useState<Supply[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [selectedSupplyId, setSelectedSupplyId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<OzonDeliveryMethod | ''>('');

  useEffect(() => {
    if (!open) return;
    setSelectedSupplyId('');
    setDeliveryMethod('');
    setLoadingExisting(true);
    fetchSupplies({ marketplace: 'OZON', type: 'FBO' })
      .then((data) => setExistingSupplies(data.filter((s) => s.ozonStatus === 'Заполнение данных')))
      .finally(() => setLoadingExisting(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Поставка для маркетплейса OZON</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Загрузить из существующей заявки</h3>
            <div className="space-y-1.5">
              <Label>Заявка на поставку из OZON</Label>
              <Select value={selectedSupplyId} onValueChange={setSelectedSupplyId} disabled={loadingExisting}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingExisting ? 'Загрузка...' : '-- Выберите заявку --'} />
                </SelectTrigger>
                <SelectContent>
                  {existingSupplies.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Нет заявок в статусе «Заполнение данных»
                    </div>
                  ) : (
                    existingSupplies.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        #{s.id} {s.ozonApplicationNumber ? `— ${s.ozonApplicationNumber}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Список актуальных заявок в статусе «Заполнение данных» подгрузится через API OZON
              </p>
            </div>
            <Button
              disabled={!selectedSupplyId || creating}
              onClick={() => onSelectExisting(Number(selectedSupplyId))}
            >
              Выбрать
            </Button>
          </div>

          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Параметры черновика</h3>
            <div className="space-y-1.5">
              <Label>Тип поставки</Label>
              <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as OzonDeliveryMethod)}>
                <SelectTrigger>
                  <SelectValue placeholder="-- Выберите тип --" />
                </SelectTrigger>
                <SelectContent>
                  {deliveryMethodOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!deliveryMethod || creating}
              onClick={() => deliveryMethod && onCreateDraft(deliveryMethod)}
            >
              {creating ? (
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              ) : (
                <Icon name="Plus" size={16} className="mr-2" />
              )}
              Создать черновик
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateOzonFboDialog;
