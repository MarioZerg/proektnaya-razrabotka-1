import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/dateUtils';
import { fetchGazelkaPlans, gazelkaPrintUrl, type GazelkaPlan } from '@/lib/gazelkaApi';
import { updateSupply, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface GazelkaShippingCardProps {
  supply: SupplyDetail;
  onReload: () => void;
}

/** Грузоперевозка через Газельку: менеджер вручную выбирает заявку Газельки под поставку,
 * после чего доступна кнопка печати стикеров коробов (упаковочных листов) из ЛК Газельки. */
const GazelkaShippingCard = ({ supply, onReload }: GazelkaShippingCardProps) => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<GazelkaPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(supply.gazelkaPlanId ? String(supply.gazelkaPlanId) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchGazelkaPlans()
      .then(setPlans)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки Газельки'))
      .finally(() => setLoading(false));
  }, []);

  const linkedPlan = plans.find((p) => p.id === supply.gazelkaPlanId);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSupply(supply.id, { gazelkaPlanId: selected ? Number(selected) : null });
      toast({ title: selected ? 'Заявка Газельки привязана' : 'Заявка Газельки отвязана' });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Грузоперевозка Газелька</CardTitle>
        {supply.gazelkaPlanId && (
          <Button
            size="sm"
            className="bg-[#004cdb] text-white hover:bg-[#003bb0]"
            asChild
          >
            <a href={gazelkaPrintUrl(supply.gazelkaPlanId)} target="_blank" rel="noreferrer">
              <Icon name="Printer" size={14} className="mr-1.5" />
              Стикеры коробов
            </a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Заявка Газельки для этой поставки</Label>
          <div className="flex flex-wrap gap-2">
            <Select value={selected} onValueChange={setSelected} disabled={loading}>
              <SelectTrigger className="w-full sm:w-[360px]">
                <SelectValue placeholder={loading ? 'Загрузка заявок Газельки...' : '— Выберите заявку —'} />
              </SelectTrigger>
              <SelectContent>
                {error ? (
                  <div className="px-2 py-1.5 text-sm text-destructive">{error}</div>
                ) : plans.length === 0 && !loading ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет заявок в Газельке</div>
                ) : (
                  plans.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      №{p.id} · {p.deliveryAddress || '—'} · {p.deliveryDate ? formatDate(p.deliveryDate) : ''} ·{' '}
                      {p.boxes ?? 0} кор.
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              onClick={handleSave}
              disabled={saving || String(supply.gazelkaPlanId ?? '') === selected}
            >
              {saving ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Список заявок подгружается напрямую из Газельки. Стикеры печатаются на сайте Газельки —
            для печати нужно быть залогиненным в её личном кабинете.
          </p>
        </div>

        {linkedPlan && (
          <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Статус Газельки</span>
              <Badge variant="secondary">{linkedPlan.statusLabel}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Склад / адрес</span>
              <span className="font-medium">{linkedPlan.deliveryAddress || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Дата доставки</span>
              <span className="font-medium">
                {linkedPlan.deliveryDate ? formatDate(linkedPlan.deliveryDate) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Коробов / паллет</span>
              <span className="font-medium">
                {linkedPlan.boxes ?? 0} / {linkedPlan.pallets ?? 0}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GazelkaShippingCard;
