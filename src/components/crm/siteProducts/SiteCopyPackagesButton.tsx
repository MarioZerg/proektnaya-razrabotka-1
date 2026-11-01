import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { copySitePackages } from '@/lib/siteOrdersApi';

interface Props {
  actor?: { id?: number; name?: string };
  onDone: () => void;
}

/**
 * Упаковка для доставки — сразу всем товарам сайта с карточек маркетплейсов.
 * Тот же артикул на OZON — берём его коробку и вес; такой высоты там нет — ту же ширину с ближайшей высотой.
 * Вписанное вручную не трогает. Новые товары сайта потом заполняют вручную кнопкой «Упаковка».
 */
const SiteCopyPackagesButton = ({ actor, onDone }: Props) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await copySitePackages(actor);
      toast({
        title: r.pushed ? 'Упаковка перенесена и отправлена на сайт' : 'Упаковка перенесена, но на сайт не ушла',
        description:
          `Обновлено: ${r.changed} (тот же артикул: ${r.exact}, по соседней высоте: ${r.near}). ` +
          `С упаковкой на сайте: ${r.withPackage}.` +
          (r.missing ? ` Не нашлось на маркетплейсах: ${r.missing} — их заполните вручную.` : '') +
          (r.pushed ? '' : ` ${r.pushError ?? ''}`),
        variant: r.pushed ? undefined : 'destructive',
      });
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось перенести упаковку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy}>
      <Icon name={busy ? 'Loader2' : 'Package'} size={16} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Переношу…' : 'Упаковка с маркетплейсов'}
    </Button>
  );
};

export default SiteCopyPackagesButton;
