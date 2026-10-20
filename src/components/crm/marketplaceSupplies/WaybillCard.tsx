import { useEffect, useState, type MouseEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
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
import { FIELDS, isFilled, toInput } from './waybill/waybillFields';
import WaybillStrip from './waybill/WaybillStrip';
import WaybillNotices from './waybill/WaybillNotices';
import WaybillManagerForm from './waybill/WaybillManagerForm';

interface WaybillCardProps {
  supply: SupplyDetail;
  /** Менеджер или админ: заполняет накладную и подтверждает готовность. */
  isManager: boolean;
}

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
      <WaybillStrip
        doc={doc}
        isManager={isManager}
        showPrint={showPrint}
        onOpen={() => setOpen(true)}
        onPrint={printWaybill}
      />

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
              <WaybillNotices supply={supply} doc={doc} isManager={isManager} />

              {isManager && (
                <WaybillManagerForm
                  supply={supply}
                  doc={doc}
                  form={form}
                  setForm={setForm}
                  saving={saving}
                  gazelkaLoading={gazelkaLoading}
                  onGenerate={handleGenerate}
                  onGazelka={handleGazelka}
                  onReady={handleReady}
                  onSave={handleSave}
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WaybillCard;
