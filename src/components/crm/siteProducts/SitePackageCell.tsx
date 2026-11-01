import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setSitePackage, type SiteCatalogItem } from '@/lib/siteOrdersApi';

interface Props {
  /** Одна высота или все высоты ширины — упаковка ставится им всем одинаковой. */
  items: SiteCatalogItem[];
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: () => void;
  /** Строка высоты: мелкий текст вместо кнопки. */
  compact?: boolean;
}

const FIELDS = [
  ['length', 'Длина, см'],
  ['width', 'Ширина, см'],
  ['height', 'Высота, см'],
  ['weight', 'Вес, г'],
] as const;

type Form = Record<(typeof FIELDS)[number][0], string>;

const cm = (mm: number | null | undefined) => (mm ? String(mm / 10) : '');
/** Число из поля с заданным множителем: см -> мм (×10), граммы (×1). Пусто — null. */
const num = (s: string, mult: number) => {
  const v = Number(s.replace(',', '.'));
  return s.trim() && v > 0 ? Math.round(v * mult) : null;
};

type Pack = { lengthMm: number | null; widthMm: number | null; heightMm: number | null; weightG: number | null };

const packOf = (i: SiteCatalogItem) =>
  i.packLengthMm && i.packWidthMm && i.packHeightMm && i.packWeightG
    ? `${cm(i.packLengthMm)}×${cm(i.packWidthMm)}×${cm(i.packHeightMm)} см · ${i.packWeightG} г`
    : null;

/**
 * Упаковка для доставки: по ней сайт считает цену Ozon Доставки.
 * Товарам, которых нет на OZON, габариты вписывают здесь — подтянуть их неоткуда.
 */
const SitePackageCell = ({ items, canEdit, actor, onSaved, compact }: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const first = items[0];
  const [form, setForm] = useState<Form>({ length: '', width: '', height: '', weight: '' });

  const packs = items.map(packOf);
  const missing = packs.filter((p) => !p).length;
  const same = new Set(packs).size === 1;
  const manual = items.some((i) => i.packSource === 'manual');
  const summary =
    missing === items.length
      ? 'нет упаковки'
      : missing
        ? `нет у ${missing} высот`
        : same
          ? packs[0]
          : 'разная по высотам';

  const onOpenChange = (v: boolean) => {
    if (v) {
      setForm({
        length: cm(first?.packLengthMm),
        width: cm(first?.packWidthMm),
        height: cm(first?.packHeightMm),
        weight: first?.packWeightG ? String(first.packWeightG) : '',
      });
    }
    setOpen(v);
  };

  const save = async (clear = false) => {
    const vals: Pack = clear
      ? { lengthMm: null, widthMm: null, heightMm: null, weightG: null }
      : {
          lengthMm: num(form.length, 10),
          widthMm: num(form.width, 10),
          heightMm: num(form.height, 10),
          weightG: num(form.weight, 1),
        };
    if (!clear && Object.values(vals).some((v) => v == null)) {
      toast({ title: 'Заполните длину, ширину, высоту и вес', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await setSitePackage(items.map((i) => i.id), vals, actor);
      toast(
        clear
          ? { title: 'Упаковка снята — подставится с OZON при синхронизации, если товар там есть' }
          : r.pushed
            ? { title: `Упаковка отправлена на сайт (${items.length} шт)` }
            : { title: 'Упаковка сохранена, на сайт не ушла', description: r.pushError || undefined, variant: 'destructive' }
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const label = (
    <span className={missing ? 'text-amber-700' : manual ? '' : 'text-muted-foreground'}>
      {summary}
      {!missing && !compact && (manual ? ' · вручную' : ' · с OZON')}
    </span>
  );

  if (!canEdit) return compact ? label : <p className="text-xs">{label}</p>;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {compact ? (
          <button type="button" className="text-left hover:underline">
            {label}
          </button>
        ) : (
          <Button size="sm" variant="outline" className={missing ? 'border-amber-300' : ''}>
            <Icon name="Package" size={14} className="mr-1" />
            Упаковка
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div>
          <p className="text-sm font-medium">Упаковка для доставки</p>
          <p className="text-xs text-muted-foreground">
            {items.length > 1
              ? `Одинаково для всех ${items.length} высот этой ширины. `
              : ''}
            По ней сайт считает цену доставки. Вписанное здесь синхронизация с OZON не перезапишет.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(([key, title]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{title}</Label>
              <Input
                inputMode="decimal"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                className="h-8"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          {manual ? (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(true)}>
              Брать с OZON
            </Button>
          ) : (
            <span />
          )}
          <Button size="sm" disabled={saving} onClick={() => save()}>
            {saving ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SitePackageCell;
