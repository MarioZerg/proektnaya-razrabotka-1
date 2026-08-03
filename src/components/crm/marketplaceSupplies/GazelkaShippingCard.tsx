import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatDate } from '@/lib/dateUtils';
import { fetchGazelkaPlans, gazelkaPrintUrl, type GazelkaPlan } from '@/lib/gazelkaApi';
import { updateSupply, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { printGazelkaLabels } from '@/lib/gazelkaPackingLabel';

interface GazelkaShippingCardProps {
  supply: SupplyDetail;
  onReload: () => void;
}

/** Грузоперевозка через Газельку: менеджер вручную выбирает заявку Газельки под поставку,
 * после чего можно распечатать упаковочные листы коробов — прямо в нашей системе (штрихкод
 * Code128) либо ссылкой на печать в ЛК Газельки. */
const GazelkaShippingCard = ({ supply, onReload }: GazelkaShippingCardProps) => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<GazelkaPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(supply.gazelkaPlanId ? String(supply.gazelkaPlanId) : '');
  const [saving, setSaving] = useState(false);
  const [ids, setIds] = useState(String(supply.gazelkaIds ?? 0));
  const [idm, setIdm] = useState(String(supply.gazelkaIdm ?? 0));
  const [savingIds, setSavingIds] = useState(false);

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

  const handleSaveIds = async () => {
    setSavingIds(true);
    try {
      await updateSupply(supply.id, { gazelkaIds: Number(ids) || 0, gazelkaIdm: Number(idm) || 0 });
      toast({ title: 'Коды склада сохранены' });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingIds(false);
    }
  };

  const handlePrintOurLabels = () => {
    if (!linkedPlan) return;
    const boxesCount = linkedPlan.boxes || supply.boxes.length || 1;
    printGazelkaLabels({ plan: linkedPlan, supply, boxesCount });
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Грузоперевозка Газелька</CardTitle>
        {supply.gazelkaPlanId && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-[#004cdb] text-white hover:bg-[#003bb0]"
              onClick={handlePrintOurLabels}
              disabled={!linkedPlan}
            >
              <Icon name="Printer" size={14} className="mr-1.5" />
              Печать стикеров
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={gazelkaPrintUrl(supply.gazelkaPlanId)} target="_blank" rel="noreferrer">
                <Icon name="ExternalLink" size={14} className="mr-1.5" />
                В ЛК Газельки
              </a>
            </Button>
          </div>
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
            «Печать стикеров» формирует упаковочные листы коробов прямо у нас (со штрихкодом). Кнопка
            «В ЛК Газельки» открывает их печать на сайте Газельки.
          </p>
        </div>

        {linkedPlan && (
          <>
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

            <div className="space-y-1.5">
              <Label className="text-xs">
                Коды склада для штрихкода (IDS и IDM) — уточните в Газельке, если стикеры не считываются
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  className="w-24"
                  value={ids}
                  onChange={(e) => setIds(e.target.value)}
                  placeholder="IDS"
                />
                <Input
                  type="number"
                  className="w-24"
                  value={idm}
                  onChange={(e) => setIdm(e.target.value)}
                  placeholder="IDM"
                />
                <Button
                  variant="outline"
                  onClick={handleSaveIds}
                  disabled={savingIds || (Number(ids) === supply.gazelkaIds && Number(idm) === supply.gazelkaIdm)}
                >
                  {savingIds ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить коды'}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GazelkaShippingCard;
