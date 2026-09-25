import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SupplySection from '@/components/crm/marketplaceSupplies/SupplySection';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dateUtils';
import {
  fetchWaybill,
  createWaybill,
  updateWaybill,
  generateWaybill,
  setWaybillReady,
  type WaybillDocument,
  type WaybillEditableFields,
} from '@/lib/waybillApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface WaybillCardProps {
  supply: SupplyDetail;
  /** Менеджер или админ: заполняет накладную и подтверждает готовность. */
  isManager: boolean;
}

type FieldType = 'text' | 'date' | 'number' | 'datetime-local';

/** Поля формы по разделам Приложения № 4 — порядок тот же, что в бумаге. */
const FIELDS: {
  key: keyof WaybillEditableFields;
  label: string;
  group: string;
  type?: FieldType;
  hint?: string;
  wide?: boolean;
}[] = [
  { key: 'number', label: 'Номер накладной', group: 'Документ' },
  { key: 'docDate', label: 'Дата накладной', group: 'Документ', type: 'date' },
  { key: 'orderNumber', label: 'Заказ (заявка) №', group: 'Документ', hint: 'Номер заявки Газельки' },
  { key: 'orderDate', label: 'Дата заявки', group: 'Документ', type: 'date' },
  { key: 'copyNumber', label: 'Экземпляр №', group: 'Документ', type: 'number' },

  { key: 'shipperDetails', label: '1. Грузоотправитель (мы)', group: 'Стороны', wide: true, hint: 'Наименование, ИНН, адрес, телефон одной строкой' },
  { key: 'consigneeDetails', label: '2. Грузополучатель', group: 'Стороны', wide: true, hint: 'Юрлицо маркетплейса с ИНН и адресом' },
  { key: 'deliveryAddress', label: 'Адрес места доставки', group: 'Стороны', wide: true },
  { key: 'customerDetails', label: '1а. Заказчик услуг перевозки', group: 'Стороны', wide: true, hint: 'Если перевозку организует посредник — иначе оставьте пустым' },
  { key: 'customerContract', label: 'Договор с заказчиком услуг', group: 'Стороны' },

  { key: 'cargoName', label: 'Наименование груза', group: '3. Груз', wide: true },
  { key: 'cargoPlaces', label: 'Количество мест, тара', group: '3. Груз', hint: 'Например: 9 коробов' },
  { key: 'cargoWeight', label: 'Масса груза', group: '3. Груз', wide: true, hint: 'Например: Места БРУТТО 120 кг (определено взвешиванием)' },
  { key: 'cargoValue', label: 'Объявленная стоимость', group: '3. Груз' },
  { key: 'accompanyingDocs', label: '4. Сопроводительные документы', group: '3. Груз', wide: true },

  { key: 'carrierDetails', label: '6. Перевозчик', group: 'Перевозчик и машина', wide: true, hint: 'Реквизиты Газельки или другого перевозчика' },
  { key: 'driverDetails', label: 'Водитель', group: 'Перевозчик и машина', wide: true, hint: 'ФИО, паспорт, телефон' },
  { key: 'vehicleDetails', label: '7. Транспортное средство', group: 'Перевозчик и машина', wide: true, hint: 'Тип, марка, грузоподъёмность' },
  { key: 'vehicleNumber', label: 'Госномер', group: 'Перевозчик и машина' },
  { key: 'vehicleOwnership', label: 'Тип владения (1–5)', group: 'Перевозчик и машина', type: 'number', hint: '1 собственность, 3 аренда, 4 лизинг, 5 безвозмездно' },

  { key: 'loaderDetails', label: 'Кто грузит', group: '8. Приём груза', wide: true },
  { key: 'loadingAddress', label: 'Адрес погрузки', group: '8. Приём груза', wide: true },
  { key: 'plannedLoadingAt', label: 'Подача машины под погрузку', group: '8. Приём груза', type: 'datetime-local' },
  { key: 'loadingWeight', label: 'Масса при погрузке', group: '8. Приём груза', wide: true },
  { key: 'loadingPlaces', label: 'Мест при погрузке', group: '8. Приём груза' },
  { key: 'packaging', label: 'Тара, упаковка', group: '8. Приём груза', wide: true },
  { key: 'loaderSignature', label: 'Подпись от нас', group: '8. Приём груза', wide: true, hint: 'Например: Кладовщик Петров И.Г.' },

  { key: 'unloadingAddress', label: 'Адрес выгрузки', group: '10. Выдача груза', wide: true },
  { key: 'plannedUnloadingAt', label: 'Подача под выгрузку', group: '10. Выдача груза', type: 'datetime-local' },
  { key: 'cargoCondition', label: 'Состояние груза', group: '10. Выдача груза', wide: true },
  { key: 'unloadPlaces', label: 'Мест при выгрузке', group: '10. Выдача груза' },

  { key: 'transportCost', label: 'Стоимость без налога', group: '12. Стоимость перевозки' },
  { key: 'transportCostVat', label: 'Сумма налога', group: '12. Стоимость перевозки' },
  { key: 'transportCostTotal', label: 'Стоимость с налогом', group: '12. Стоимость перевозки' },
];

const GROUPS = [
  'Документ',
  'Стороны',
  '3. Груз',
  'Перевозчик и машина',
  '8. Приём груза',
  '10. Выдача груза',
  '12. Стоимость перевозки',
];

/** Значение для input: даты режем под формат поля, null превращаем в пустую строку. */
const toInput = (v: unknown, type?: FieldType): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (type === 'date') return s.slice(0, 10);
  if (type === 'datetime-local') return s.slice(0, 16);
  return s;
};

/**
 * Транспортная накладная поставки — документ, который едет с машиной.
 *
 * Форма Приложения № 4 к Правилам перевозок грузов автомобильным транспортом
 * (в ред. ПП РФ от 30.11.2021 № 2116).
 *
 * КТО ЧТО ДЕЛАЕТ. Менеджер заполняет карточку, формирует файл и подтверждает
 * готовность. Кладовщик видит только кнопку скачивания — и только после
 * подтверждения: иначе он повёз бы водителю недозаполненный документ. Любая
 * правка снимает готовность, чтобы на руках не оказалось устаревшей версии.
 *
 * ЭТрН тут не участвует: электронную накладную оформляет перевозчик у себя.
 */
const WaybillCard = ({ supply, isManager }: WaybillCardProps) => {
  const { toast } = useToast();
  const [doc, setDoc] = useState<WaybillDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const fillForm = (d: WaybillDocument | null) => {
    if (!d) return;
    const next: Record<string, string> = {};
    FIELDS.forEach((f) => {
      next[f.key] = toInput((d as unknown as Record<string, unknown>)[f.key], f.type);
    });
    next.comment = d.comment || '';
    setForm(next);
  };

  useEffect(() => {
    fetchWaybill(supply.id)
      .then((d) => {
        setDoc(d);
        fillForm(d);
      })
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [supply.id]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const d = await createWaybill(supply.id);
      setDoc(d);
      fillForm(d);
      toast({
        title: 'Накладная заведена',
        description: 'Наши реквизиты, склад и число коробов подставлены — проверьте перевозчика и машину',
      });
    } catch (e) {
      toast({
        title: 'Не удалось создать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      FIELDS.forEach((f) => {
        const v = form[f.key] ?? '';
        fields[f.key] = f.type === 'number' ? (v === '' ? null : Number(v)) : v;
      });
      fields.comment = form.comment ?? '';
      const d = await updateWaybill(supply.id, fields as WaybillEditableFields);
      setDoc(d);
      fillForm(d);
      toast({
        title: 'Накладная сохранена',
        description: 'Сформируйте файл заново — правки в старый не попали',
      });
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const d = await generateWaybill(supply.id);
      setDoc(d);
      toast({ title: 'Файл накладной готов', description: 'Можно скачивать и подтверждать' });
    } catch (e) {
      toast({
        title: 'Не удалось сформировать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleReady = async (ready: boolean) => {
    try {
      const d = await setWaybillReady(supply.id, ready);
      setDoc(d);
      toast({
        title: ready ? 'Накладная готова к отгрузке' : 'Готовность снята',
        description: ready
          ? 'Кладовщик видит кнопку скачивания'
          : 'Кладовщик скачать файл не сможет',
      });
    } catch (e) {
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" />
          Загрузка транспортной накладной...
        </CardContent>
      </Card>
    );
  }

  // Накладной нет. Кладовщику показываем предупреждение, а не пустоту: без
  // документа машину выпускать нельзя, и узнать об этом надо до погрузки.
  if (!doc) {
    return (
      <SupplySection
        title="Транспортная накладная"
        summary={<Badge variant="destructive">Не заведена</Badge>}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            По этой поставке накладной нет. Документ едет с машиной — водитель
            забирает груз вместе с ним.
          </p>
          {isManager ? (
            <Button onClick={handleCreate} disabled={creating}>
              <Icon
                name={creating ? 'Loader2' : 'FilePlus2'}
                size={14}
                className={`mr-1.5 ${creating ? 'animate-spin' : ''}`}
              />
              Завести накладную
            </Button>
          ) : (
            <p className="text-sm font-medium text-destructive">
              Накладную заполняет менеджер — без неё груз не отгружаем.
            </p>
          )}
        </div>
      </SupplySection>
    );
  }

  // КЛАДОВЩИК: только скачивание, и только у подтверждённой накладной.
  //
  // Раньше он видел бы всю форму и мог принять за готовое то, что менеджер ещё
  // заполняет. Здесь показываем ровно одно: можно забирать документ или ещё нет.
  if (!isManager) {
    return (
      <SupplySection
        title="Транспортная накладная"
        summary={
          doc.isReady ? (
            <Badge>Готова</Badge>
          ) : (
            <Badge variant="secondary">Заполняет менеджер</Badge>
          )
        }
      >
        {doc.isReady && doc.fileUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Накладная готова. Скачайте, распечатайте и отдайте водителю — после
              этого можно отгружать поставку.
            </p>
            <Button asChild>
              <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                <Icon name="Download" size={14} className="mr-1.5" />
                Скачать накладную
              </a>
            </Button>
            {doc.readyByName && (
              <p className="text-xs text-muted-foreground">
                Подтвердил: {doc.readyByName}
                {doc.readyAt ? `, ${formatDateTime(doc.readyAt)}` : ''}
              </p>
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="Clock" size={15} className="mt-0.5 shrink-0" />
            Менеджер ещё не подтвердил накладную. Отгружать поставку без документа
            нельзя — дождитесь готовности.
          </p>
        )}
      </SupplySection>
    );
  }

  // Файл собран до последней правки — значит в нём старые данные.
  const fileStale =
    !!doc.fileGeneratedAt && new Date(doc.fileGeneratedAt) < new Date(doc.updatedAt);

  return (
    <SupplySection
      title="Транспортная накладная"
      summary={
        <>
          {doc.isReady ? (
            <Badge>Готова</Badge>
          ) : (
            <Badge variant="outline">Черновик</Badge>
          )}
          {doc.number && <span className="font-mono-tech">№ {doc.number}</span>}
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          Форма по Приложению № 4 к Правилам перевозок грузов автомобильным
          транспортом. Документ едет с машиной: заполните поля, сформируйте файл и
          подтвердите готовность — после этого кладовщик сможет скачать накладную и
          отгрузить поставку. Электронную накладную перевозчик оформляет у себя.
        </p>

        {/* Мест в накладной должно быть столько же, сколько коробов собрано:
            принимающая сторона считает груз по местам, и расхождение — это спор
            на приёмке. Заметить его надо здесь, а не у ворот склада. */}
        {supply.boxes?.length > 0 && doc.loadingPlaces !== String(supply.boxes.length) && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
            В накладной мест: {doc.loadingPlaces || '—'}, а коробов собрано:{' '}
            {supply.boxes.length}. Проверьте разделы «Груз» и «Приём груза».
          </p>
        )}

        {fileStale && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="RefreshCw" size={15} className="mt-0.5 shrink-0" />
            Накладную правили после того, как собрали файл. Сформируйте файл заново,
            иначе водителю уедет старая версия.
          </p>
        )}

        {doc.isReady && (
          <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <Icon name="ShieldCheck" size={15} className="mt-0.5 shrink-0" />
            Подтвердил: {doc.readyByName || '—'}
            {doc.readyAt ? `, ${formatDateTime(doc.readyAt)}` : ''}. Кладовщик видит
            кнопку скачивания.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
            <Icon
              name={generating ? 'Loader2' : 'FileSpreadsheet'}
              size={14}
              className={`mr-1.5 ${generating ? 'animate-spin' : ''}`}
            />
            Сформировать файл
          </Button>
          {doc.fileUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                <Icon name="Download" size={14} className="mr-1.5" />
                Скачать
              </a>
            </Button>
          )}
          {doc.isReady ? (
            <Button variant="outline" size="sm" onClick={() => handleReady(false)}>
              <Icon name="Undo2" size={14} className="mr-1.5" />
              Снять готовность
            </Button>
          ) : (
            <Button size="sm" onClick={() => handleReady(true)}>
              <Icon name="Check" size={14} className="mr-1.5" />
              Подтвердить для отгрузки
            </Button>
          )}
        </div>

        {GROUPS.map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{group}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.filter((f) => f.group === group).map((f) => (
                <div
                  key={f.key}
                  className={`space-y-1 ${f.wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}
                >
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    type={f.type || 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                  {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-1">
          <Label className="text-xs">Комментарий</Label>
          <Textarea
            rows={2}
            value={form.comment ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" /> : null}
          Сохранить накладную
        </Button>
      </div>
    </SupplySection>
  );
};

export default WaybillCard;
