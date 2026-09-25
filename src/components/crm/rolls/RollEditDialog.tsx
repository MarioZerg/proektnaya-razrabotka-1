import { useEffect, useState } from 'react';
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setRollQuantity } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface RollEditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rollId: number;
  barcode: string;
  materialName: string;
  unit: string;
  currentQuantity: number;
  onDone: () => void;
}

/**
 * Правка метража рулона администратором.
 *
 * Бирки поставщика врут: на рулоне «50 м», по факту 47. Или опечатка при вводе
 * сотни позиций за разгрузку. Пока рулон целый лежит на складе, цифру нужно
 * поправить — иначе от неверного числа считается и остаток материала, и
 * себестоимость метра, и расчёты с поставщиком.
 *
 * Метраж меняется сразу в двух местах: у рулона на складе и в строке приёмки.
 * Разойдутся — отчёты перестанут сходиться, и расхождение всплывёт на сверке.
 */
const RollEditDialog = ({
  open,
  onOpenChange,
  rollId,
  barcode,
  materialName,
  unit,
  currentQuantity,
  onDone,
}: RollEditDialogProps) => {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(String(currentQuantity ?? ''));
  }, [open, currentQuantity]);

  const parsed = Number((value || '').replace(',', '.'));
  const valid = !!parsed && parsed > 0;
  const diff = valid ? parsed - currentQuantity : 0;

  const handleSave = async () => {
    if (!valid) {
      toast({ title: 'Укажите метраж больше нуля', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await setRollQuantity(rollId, parsed);
      toast({
        title: 'Метраж изменён',
        description: 'Приёмка и себестоимость метра пересчитаны',
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось изменить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Метраж рулона</DialogTitle>
          <DialogDescription>
            {materialName} · <span className="font-mono-tech">{barcode}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Фактический метраж, {unit || 'м'}</Label>
            <Input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Сейчас: {formatQuantity(currentQuantity)} {unit}
            </p>
          </div>

          {/* Разница на глаз: администратор должен видеть, насколько двигает
              остаток склада, прежде чем нажать «Сохранить». */}
          {valid && diff !== 0 && (
            <p
              className={`rounded-md border p-2.5 text-sm ${
                diff < 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-sky-300 bg-sky-50 text-sky-900'
              }`}
            >
              {diff < 0 ? 'Уменьшение' : 'Увеличение'} на{' '}
              <b>
                {formatQuantity(Math.abs(diff))} {unit}
              </b>
              . Столько же изменится в приёмке и на складе.
            </p>
          )}

          <p className="flex items-start gap-2 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
            Менять метраж можно только у целого рулона на складе. Если из рулона
            уже кроили или он уехал в цех, за цифрой стоят чужие списания и
            зарплата за раскрой — такой рулон система не даст изменить.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
            Сохранить метраж
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RollEditDialog;
