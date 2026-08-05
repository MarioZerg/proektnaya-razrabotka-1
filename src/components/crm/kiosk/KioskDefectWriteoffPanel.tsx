import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useToast } from '@/hooks/use-toast';
import { createDefect, fetchDefectRolls, type DefectRoll } from '@/lib/kioskApi';
import { printDefectSticker } from '@/lib/printDefectSticker';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskDefectWriteoffPanelProps {
  /** Цех, в котором стоит терминал — брак оформляем только по его рулонам. */
  workshopId: number;
  /** Сотрудник работает в чужом цехе — сам оформить брак не может, нужен штатный работник. */
  isGuest: boolean;
}

/**
 * Плашка учёта брака на терминале — для швеи и закройщика.
 *
 * Брак ведём только по ТКАНИ и ТЕСЬМЕ: пакеты и этикетки не считаем, их брак копеечный, а
 * время сотрудника на оформление дороже. Причины подставляются по материалу рулона: у тюля
 * это затяжки, полосы, дырки и брак утяжелителя, у тесьмы — брак петель и заводской брак.
 *
 * После оформления сразу печатается стикер брака 58×40: его клеят на бракованный кусок и
 * откладывают в контейнер, а кладовщик потом сканирует и принимает брак на склад.
 */
const KioskDefectWriteoffPanel = ({ workshopId, isGuest }: KioskDefectWriteoffPanelProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rolls, setRolls] = useState<DefectRoll[]>([]);
  const [rollId, setRollId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchDefectRolls(workshopId)
      .then(setRolls)
      .catch(() => setRolls([]));
  }, [open, workshopId]);

  const selectedRoll = rolls.find((r) => String(r.id) === rollId);
  const isFabric = selectedRoll?.materialType === 'Тюль';

  const reset = () => {
    setRollId('');
    setReasonCode('');
    setQuantity('');
    setComment('');
    setCode('');
  };

  const handleSubmit = async () => {
    if (!code.trim() || !rollId || !quantity || !reasonCode) return;
    setSaving(true);
    try {
      const res = await createDefect({
        code: code.trim(),
        rollId: Number(rollId),
        quantity: Number(quantity.replace(',', '.')),
        reasonCode,
        comment: comment.trim() || undefined,
      });

      // Стикер печатаем сразу: без него кладовщик не сможет принять брак на склад.
      printDefectSticker({
        barcode: res.defectBarcode,
        materialName: selectedRoll?.materialName || 'Материал',
        quantity: Number(quantity.replace(',', '.')),
        unit: res.unit || selectedRoll?.unit,
        reasonLabel: res.reasonLabel,
        userName: res.actorName,
      });

      toast({
        title: `Брак оформлен: ${res.defectBarcode}`,
        description: 'Наклейте стикер и положите брак в контейнер — кладовщик заберёт его на склад',
      });
      reset();
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Не удалось оформить брак',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Icon name="PackageX" size={24} className="mt-0.5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">Брак из рулона</p>
          <p className="mt-1 text-base text-muted-foreground">
            {isGuest
              ? 'Вы работаете в чужом цехе — позовите штатного сотрудника этого цеха, он отсканирует свой штрихкод и оформит брак за вас.'
              : 'Ткань и тесьма: выберите рулон, укажите метраж и причину. Стикер напечатается сам.'}
          </p>
        </div>
      </div>

      {!open ? (
        <Button className="mt-3 h-14 w-full text-lg" variant="outline" onClick={() => setOpen(true)}>
          Указать брак
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Штрихкод сотрудника цеха</Label>
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Отсканируйте штрихкод"
              className="h-14 text-lg"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Рулон (ткань или тесьма)</Label>
            <Select
              value={rollId}
              onValueChange={(v) => {
                setRollId(v);
                // Причины у ткани и тесьмы разные — сбрасываем выбор при смене рулона.
                setReasonCode('');
              }}
            >
              <SelectTrigger className="h-14 text-lg">
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {rolls.length === 0 ? (
                  <SelectItem value="none" disabled>
                    Нет рулонов в цехе
                  </SelectItem>
                ) : (
                  rolls.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      #{r.barcode} — {r.materialName} ({formatQuantity(r.remaining)} {r.unit})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedRoll && (
            <div className="space-y-1.5">
              <Label className="text-sm">
                Причина брака
                <Badge variant="secondary" className="ml-2">
                  {isFabric ? 'ткань' : 'тесьма'}
                </Badge>
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedRoll.reasons.map((r) => (
                  <Button
                    key={r.code}
                    type="button"
                    variant={reasonCode === r.code ? 'default' : 'outline'}
                    className="h-14 text-base"
                    onClick={() => setReasonCode(r.code)}
                  >
                    {reasonCode === r.code && <Icon name="Check" size={18} className="mr-1.5" />}
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm">
              Метраж брака{selectedRoll?.unit ? `, ${selectedRoll.unit}` : ''}
            </Label>
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="h-14 text-lg"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Уточнение (необязательно)</Label>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: по всей длине кромки"
              className="h-14 text-lg"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-14 flex-1 text-lg"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              className="h-14 flex-1 text-lg"
              disabled={saving || !code.trim() || !rollId || !quantity || !reasonCode}
              onClick={handleSubmit}
            >
              {saving ? <Icon name="Loader2" size={20} className="mr-2 animate-spin" /> : null}
              Оформить и печать
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KioskDefectWriteoffPanel;
