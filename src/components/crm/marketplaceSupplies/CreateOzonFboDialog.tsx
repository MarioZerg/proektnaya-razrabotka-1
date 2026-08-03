import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { formatDate } from '@/lib/dateUtils';
import {
  fetchOzonFboApplications,
  type OzonFboApplication,
} from '@/lib/ozonFboApi';
import type { OzonDeliveryMethod } from '@/lib/marketplaceSuppliesApi';

interface CreateOzonFboDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creating: boolean;
  /** Импорт выбранной заявки OZON: создаёт поставку + заказы на конвейер и открывает её. */
  onImportApplication: (orderId: number) => void;
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
  onImportApplication,
  onCreateDraft,
}: CreateOzonFboDialogProps) => {
  const [applications, setApplications] = useState<OzonFboApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<OzonDeliveryMethod | ''>('');

  useEffect(() => {
    if (!open) return;
    setSelectedOrderId('');
    setDeliveryMethod('');
    setError(null);
    setLoading(true);
    fetchOzonFboApplications()
      .then(setApplications)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки OZON'))
      .finally(() => setLoading(false));
  }, [open]);

  const selected = applications.find((a) => String(a.orderId) === selectedOrderId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Заявка на поставку OZON FBO</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Заявки OZON, ожидающие сборки</h3>
            <div className="space-y-1.5">
              <Label>Выберите заявку из OZON</Label>
              <Select value={selectedOrderId} onValueChange={setSelectedOrderId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder={loading ? 'Загрузка заявок из OZON...' : '-- Выберите заявку --'} />
                </SelectTrigger>
                <SelectContent>
                  {error ? (
                    <div className="px-2 py-1.5 text-sm text-destructive">{error}</div>
                  ) : applications.length === 0 && !loading ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Нет заявок в статусе «Заполнение данных»
                    </div>
                  ) : (
                    applications.map((a) => (
                      <SelectItem key={a.orderId} value={String(a.orderId)}>
                        №{a.orderNumber} · {a.warehouse || 'склад —'}
                        {a.supplyId ? ' (уже загружена)' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Список актуальных заявок подгружается напрямую из OZON по API
              </p>
            </div>

            {selected && (
              <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Склад OZON</span>
                  <span className="font-medium">{selected.warehouse || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Дата поставки</span>
                  <span className="font-medium">
                    {selected.timeslotFrom ? formatDate(selected.timeslotFrom.slice(0, 10)) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Заполнить до</span>
                  <span className="font-medium">
                    {selected.deadline ? formatDate(selected.deadline.slice(0, 10)) : '—'}
                  </span>
                </div>
                {selected.supplyId && (
                  <Badge variant="secondary" className="mt-1">Заявка уже загружена в систему</Badge>
                )}
              </div>
            )}

            <Button
              disabled={!selectedOrderId || creating}
              onClick={() => onImportApplication(Number(selectedOrderId))}
            >
              {creating ? (
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              ) : (
                <Icon name="Download" size={16} className="mr-2" />
              )}
              {selected?.supplyId ? 'Открыть поставку' : 'Загрузить заявку в систему'}
            </Button>
          </div>

          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Или создать пустой черновик</h3>
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
              variant="outline"
              disabled={!deliveryMethod || creating}
              onClick={() => deliveryMethod && onCreateDraft(deliveryMethod)}
            >
              <Icon name="Plus" size={16} className="mr-2" />
              Создать черновик
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateOzonFboDialog;
