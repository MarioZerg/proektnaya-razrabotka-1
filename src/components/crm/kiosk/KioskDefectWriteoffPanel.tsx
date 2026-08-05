import { useEffect, useState } from 'react';
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
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { kioskDefectWriteoff } from '@/lib/kioskApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskDefectWriteoffPanelProps {
  /** Цех, в котором стоит терминал — списываем брак только по его рулонам. */
  workshopId: number;
  /** Сотрудник работает в чужом цехе — сам списать брак не может, нужен штатный работник. */
  isGuest: boolean;
}

/** Плашка списания брака на терминале. Списать брак может только штатный сотрудник цеха:
 * он сканирует свой штрихкод, выбирает рулон и указывает метраж — в том числе за коллег,
 * которые пришли работать в этот цех из другого. */
const KioskDefectWriteoffPanel = ({ workshopId, isGuest }: KioskDefectWriteoffPanelProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [rollId, setRollId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchRolls({ status: 'in_workshop' })
      .then((list) => setRolls(list.filter((r) => r.workshopId === workshopId)))
      .catch(() => setRolls([]));
  }, [open, workshopId]);

  const reset = () => {
    setRollId('');
    setQuantity('');
    setComment('');
    setCode('');
  };

  const handleSubmit = async () => {
    if (!code.trim() || !rollId || !quantity) return;
    setSaving(true);
    try {
      const res = await kioskDefectWriteoff({
        code: code.trim(),
        rollId: Number(rollId),
        quantity: Number(quantity.replace(',', '.')),
        comment: comment.trim() || undefined,
      });
      toast({ title: 'Брак списан', description: `Оформил: ${res.actorName}` });
      reset();
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Не удалось списать брак',
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
          <p className="text-lg font-bold">Списание брака</p>
          <p className="mt-1 text-base text-muted-foreground">
            {isGuest
              ? 'Вы работаете в чужом цехе — позовите штатного сотрудника этого цеха, он отсканирует свой штрихкод и спишет брак за вас.'
              : 'Отсканируйте свой штрихкод, выберите рулон и укажите метраж брака.'}
          </p>
        </div>
      </div>

      {!open ? (
        <Button className="mt-3 h-14 w-full text-lg" variant="outline" onClick={() => setOpen(true)}>
          Списать брак
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
            <Label className="text-sm">Рулон</Label>
            <Select value={rollId} onValueChange={setRollId}>
              <SelectTrigger className="h-14 text-lg">
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {rolls.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    #{r.barcode} — {r.materialName} ({formatQuantity(r.remainingQuantity)} {r.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Метраж брака</Label>
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="h-14 text-lg"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Причина (необязательно)</Label>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: дырка на полотне"
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
              disabled={saving || !code.trim() || !rollId || !quantity}
              onClick={handleSubmit}
            >
              {saving ? <Icon name="Loader2" size={20} className="mr-2 animate-spin" /> : null}
              Списать
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KioskDefectWriteoffPanel;
