import { useEffect, useState, type MouseEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  fillWaybillFromGazelka,
  type WaybillDocument,
  type WaybillEditableFields,
} from '@/lib/waybillApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

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

/** Дата с накладной на полоске: «20.10.2026», без сдвига из‑за часового пояса. */
const showDay = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '—';
};

/** Коробов в накладной: сначала места при погрузке, иначе количество мест в грузе. */
const boxCount = (doc: WaybillDocument): string =>
  doc.loadingPlaces?.trim() || doc.cargoPlaces?.trim() || '—';

/**
 * Накладная заполнена, когда в ней уже есть номер, места или даты.
 * Свежий пустой черновик иконку печати не получает.
 */
const isFilled = (doc: WaybillDocument): boolean =>
  !!(
    doc.number?.trim() ||
    doc.loadingPlaces?.trim() ||
    doc.cargoPlaces?.trim() ||
    doc.plannedLoadingAt ||
    doc.plannedUnloadingAt ||
    doc.isReady
  );

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
 */
const WaybillCard = ({ supply, isManager }: WaybillCardProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<WaybillDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
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

  const load = () => {
    setLoading(true);
    fetchWaybill(supply.id)
      .then((d) => {
        setListError(null);
        setDoc(d);
        fillForm(d);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить накладную');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [gazelkaLoading, setGazelkaLoading] = useState(false);
  const handleGazelka = async () => {
    setGazelkaLoading(true);
    try {
      const d = await fillWaybillFromGazelka(supply.id);
      setDoc(d);
      fillForm(d);
      toast({
        title: 'Данные Газельки подставлены',
        description: d.driverDetails
          ? 'Водитель, машина, даты и стоимость — из заявки'
          : 'Водителя Газелька ещё не назначила — подставим, когда заявка встанет в рейс',
      });
    } catch (e) {
      toast({
        title: 'Не удалось получить данные Газельки',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setGazelkaLoading(false);
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
        description: 'Откройте печать ещё раз — в PDF попадут эти правки',
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

  const openPdf = () => {
    window.open(
      `${window.location.origin}/crm/shipments/to-marketplace/${supply.id}/waybill`,
      '_blank',
      'noopener',
    );
  };

  const handleGenerate = () => {
    openPdf();
  };

  const handleReady = async (ready: boolean) => {
    try {
      // Сервер не ставит готовность без файла. Старый файл — Excel на чужом
      // адресе, его не открываем: печатаем PDF на yarplan.ru.
      if (ready && !doc?.fileUrl) {
        const made = await generateWaybill(supply.id);
        setDoc(made);
      }
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

  if (loading && !doc) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" />
          Загрузка транспортной накладной...
        </CardContent>
      </Card>
    );
  }

  if (listError && !doc) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить транспортную накладную"
        description={listError}
        onRetry={load}
      />
    );
  }

  const filled = !!doc && isFilled(doc);
  // Кладовщик печатает только подтверждённый файл. Менеджер видит иконку,
  // как только в накладной есть номер, места или даты.
  const showPrint = filled && (isManager || !!doc?.isReady);

  const printWaybill = (event: MouseEvent) => {
    event.stopPropagation();
    openPdf();
  };

  return (
    <>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left sm:px-4 ${
            isManager ? 'hover:bg-muted/50' : 'cursor-default'
          }`}
          onClick={() => isManager && setOpen(true)}
        >
          <div className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold leading-snug">Транспортная накладная</span>
              {!doc && <Badge variant="destructive">Не заведена</Badge>}
              {doc?.isReady && <Badge>Готова</Badge>}
              {doc && !doc.isReady && <Badge variant="outline">Черновик</Badge>}
              {doc?.number && <span className="font-mono-tech text-xs">№ {doc.number}</span>}
            </span>
            {doc ? (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>Заполнена {formatDateTime(doc.updatedAt)}</span>
                <span>Коробов: {boxCount(doc)}</span>
                <span>В Газельку: {showDay(doc.plannedLoadingAt)}</span>
                <span>На маркетплейс: {showDay(doc.plannedUnloadingAt)}</span>
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {isManager
                  ? 'Нажмите, чтобы завести документ'
                  : 'Накладную заполняет менеджер — без неё груз не отгружаем'}
              </span>
            )}
          </div>
        </button>
        {showPrint && (
          <button
            type="button"
            className="flex shrink-0 items-center border-l border-border px-3 text-primary hover:bg-muted/50"
            title="Печать накладной"
            onClick={printWaybill}
          >
            <Icon name="Printer" size={18} />
          </button>
        )}
      </div>

      {/* Форма живёт в окне: на шаге отгрузки от неё остаётся одна полоска. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Транспортная накладная</DialogTitle>
          </DialogHeader>

          {!doc ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                По этой поставке накладной нет. Документ едет с машиной — водитель
                забирает груз вместе с ним.
              </p>
              <Button onClick={handleCreate} disabled={creating}>
                <Icon
                  name={creating ? 'Loader2' : 'Plus'}
                  size={14}
                  className={`mr-1.5 ${creating ? 'animate-spin' : ''}`}
                />
                Завести накладную
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                Форма по Приложению № 4 к Правилам перевозок грузов автомобильным
                транспортом. PDF открывается на yarplan.ru, длинный текст остаётся
                внутри рамки. После сохранения на полоске обновятся дата, число коробов
                и даты доставки в Газельку и на маркетплейс.
              </p>

              {supply.boxes?.length > 0 && doc.loadingPlaces !== String(supply.boxes.length) && (
                <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
                  В накладной мест: {doc.loadingPlaces || '—'}, а коробов собрано:{' '}
                  {supply.boxes.length}. Проверьте разделы «Груз» и «Приём груза».
                </p>
              )}

              {doc.isReady && (
                <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                  <Icon name="Check" size={15} className="mt-0.5 shrink-0" />
                  Подтвердил: {doc.readyByName || '—'}
                  {doc.readyAt ? `, ${formatDateTime(doc.readyAt)}` : ''}. Кладовщик видит
                  кнопку печати.
                </p>
              )}

              {!isManager && !doc.isReady && (
                <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <Icon name="Clock" size={15} className="mt-0.5 shrink-0" />
                  Менеджер ещё не подтвердил накладную. Отгружать поставку без документа
                  нельзя — дождитесь готовности.
                </p>
              )}

              {isManager && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleGenerate}>
                      <Icon name="FileText" size={14} className="mr-1.5" />
                      Сформировать PDF
                    </Button>
                    {supply.gazelkaPlanId || supply.gazelkaId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={handleGazelka}
                        disabled={gazelkaLoading}
                      >
                        <Icon
                          name={gazelkaLoading ? 'Loader2' : 'Truck'}
                          size={14}
                          className={`mr-1.5 ${gazelkaLoading ? 'animate-spin' : ''}`}
                        />
                        Обновить из Газельки
                      </Button>
                    ) : null}
                    {doc.isReady ? (
                      <Button variant="outline" size="sm" onClick={() => handleReady(false)}>
                        <Icon name="Undo2" size={14} className="mr-1.5" />
                        Снять готовность
                      </Button>
                    ) : (
                      <Button size="sm" className="w-full sm:w-auto" onClick={() => handleReady(true)}>
                        <Icon name="Check" size={14} className="mr-1.5" />
                        Подтвердить для отгрузки
                      </Button>
                    )}
                  </div>

                  {GROUPS.map((group) => (
                    <div key={group} className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">{group}</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {FIELDS.filter((f) => f.group === group).map((f) => (
                          <div
                            key={f.key}
                            className={`space-y-1 ${f.wide ? 'sm:col-span-2' : ''}`}
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
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WaybillCard;