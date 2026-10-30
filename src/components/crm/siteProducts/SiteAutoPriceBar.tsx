import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { runSiteAutoPrices, saveSitePricing, type SitePricing } from '@/lib/siteOrdersApi';

interface Props {
  pricing: SitePricing;
  /** Сколько товаров с ручной ценой. */
  manualCount: number;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onChanged: (p: SitePricing) => void;
}

/** Переключатель автоцены: цены сами следуют за себестоимостью и уходят на сайт. */
const SiteAutoPriceBar = ({ pricing, manualCount, canEdit, actor, onChanged }: Props) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const auto = !!pricing.autoPrice;

  const toggle = async (next: boolean) => {
    if (
      next &&
      !window.confirm(
        'Включить автоцену? Все товары без ручной цены сразу получат рекомендованную цену, и она уйдёт на сайт. ' +
          'Дальше цены будут обновляться сами при изменении себестоимости или настроек.'
      )
    )
      return;
    setBusy(true);
    try {
      const saved = (await saveSitePricing({ ...pricing, autoPrice: next }, actor)) as SitePricing & {
        auto?: { changed: number; pushed?: boolean; pushError?: string | null };
      };
      const a = saved.auto;
      toast(
        !next
          ? { title: 'Автоцена выключена', description: 'Цены на сайте остались как есть, дальше меняются вручную' }
          : a && a.pushed === false && a.changed
            ? { title: `Автоцена включена, но ${a.changed} цен не ушли на сайт`, description: a.pushError || undefined, variant: 'destructive' }
            : { title: 'Автоцена включена', description: `Обновлено цен на сайте: ${a?.changed ?? 0}` }
      );
      onChanged(saved);
    } catch (e) {
      toast({ title: 'Не удалось переключить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const applyOnce = async () => {
    if (!window.confirm('Поставить рекомендованные цены всем товарам без ручной цены и отправить на сайт?')) return;
    setBusy(true);
    try {
      const r = await runSiteAutoPrices(true, actor);
      toast(
        r.pushed === false && r.changed
          ? { title: 'Цены сохранены, на сайт не ушли', description: r.pushError || undefined, variant: 'destructive' }
          : { title: r.changed ? `Обновлено цен: ${r.changed}` : 'Все цены уже рекомендованные' }
      );
      onChanged(pricing);
    } catch (e) {
      toast({ title: 'Не удалось', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
        auto ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-card'
      }`}
    >
      <label className="flex items-start gap-3">
        <Switch checked={auto} disabled={!canEdit || busy} onCheckedChange={toggle} className="mt-0.5" />
        <span>
          <span className="block text-sm font-semibold">
            {auto ? 'Автоцена включена' : 'Автоцена выключена'}
            {busy && <Icon name="Loader2" size={14} className="ml-1.5 inline animate-spin" />}
          </span>
          <span className="block text-xs text-muted-foreground">
            {auto
              ? 'Цена считается сама от себестоимости и цели прибыли и уходит на сайт: при открытии товаров, после сохранения настроек и раз в час. Цена, вписанная руками, закрепляется — её автоцена не трогает.'
              : 'Цены меняются только вручную или кнопкой «поставить» у ширины.'}
            {auto && manualCount > 0 && (
              <span className="text-amber-700"> С ручной ценой: {manualCount} шт.</span>
            )}
          </span>
        </span>
      </label>
      {canEdit && !auto && (
        <Button size="sm" variant="outline" onClick={applyOnce} disabled={busy}>
          <Icon name="Wand2" size={14} className="mr-1.5" />
          Поставить все рекомендованные
        </Button>
      )}
    </div>
  );
};

export default SiteAutoPriceBar;
