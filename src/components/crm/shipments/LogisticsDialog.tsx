import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { updateShipmentLogistics, type Shipment } from '@/lib/shipmentsApi';

interface Props {
  shipment: Shipment | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Стоимость перевозки для принятой приёмки.
 *
 * Счёт за машину почти всегда приходит позже самой машины: приёмку принимают с
 * нулевой логистикой, а сумма становится известна через день-другой. Без неё
 * себестоимость метра занижена, а по ней считаются недостачи и цены.
 *
 * Раньше это правилось только на отдельной странице приёмки, куда нужно было ещё
 * догадаться зайти. Теперь окно открывается прямо из списка.
 */
const LogisticsDialog = ({ shipment, onClose, onSaved }: Props) => {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const current = shipment?.logisticsCost || 0;

  useEffect(() => {
    if (!shipment) return;
    // Уже указанную сумму подставляем в поле: её правят, а не вводят заново.
    setValue(current ? String(current) : '');
  }, [shipment, current]);

  const handleSave = async () => {
    if (!shipment) return;
    const num = Number(value.replace(',', '.'));
    if (!num || num <= 0) {
      toast({ title: 'Укажите сумму больше нуля', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await updateShipmentLogistics(shipment.id, num);
      toast({
        title: current ? 'Логистика исправлена' : 'Логистика указана',
        description: 'Себестоимость метра пересчитана по всем целым рулонам приёмки',
      });
      onSaved();
      onClose();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!shipment} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Truck" size={20} />
            Логистика приёмки #{shipment?.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Стоимость перевозки, ₽</Label>
            <Input
              autoFocus
              inputMode="decimal"
              placeholder="25450"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Сумма разделится поровну на все метры и штуки приёмки и войдёт в
            себестоимость каждого рулона.
          </p>

          {/* Честно предупреждаем о границе: как только материал уйдёт в раскрой,
              его себестоимость попадёт в чужие расчёты и сумму уже не поправить. */}
          {current > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Сейчас указано <b>{current.toLocaleString('ru-RU')} ₽</b>. Исправить можно,
              пока весь материал приёмки цел на складе — после раскроя сумма
              зафиксируется.
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Отмена
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'Сохранение…' : current ? 'Исправить' : 'Указать логистику'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogisticsDialog;
