import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dateUtils';
import {
  fetchEtrn,
  createEtrn,
  updateEtrn,
  setEtrnStatus,
  attachSignedEtrn,
  type EtrnDocument,
  type EtrnEditableFields,
} from '@/lib/etrnApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface EtrnCardProps {
  supply: SupplyDetail;
  /** Менеджер или админ: заводит накладную, правит реквизиты, грузит подписанный файл. */
  isManager: boolean;
}

const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (s === 'Подписана') return 'default';
  if (s === 'Аннулирована') return 'destructive';
  if (s === 'На подписи') return 'secondary';
  return 'outline';
};

/** Поля карточки: подпись, ключ и подсказка под полем. */
const FIELDS: {
  key: keyof EtrnEditableFields;
  label: string;
  group: string;
  type?: 'text' | 'date' | 'number' | 'datetime-local';
  hint?: string;
}[] = [
  { key: 'number', label: 'Номер накладной', group: 'Документ', hint: 'Присваивает оператор' },
  { key: 'docDate', label: 'Дата', group: 'Документ', type: 'date' },
  { key: 'operatorDocId', label: 'ID документа в Диадоке', group: 'Документ', hint: 'По нему документ ищут у оператора' },

  { key: 'shipperName', label: 'Грузоотправитель', group: 'Отправитель' },
  { key: 'shipperInn', label: 'ИНН', group: 'Отправитель' },
  { key: 'shipperAddress', label: 'Адрес', group: 'Отправитель' },
  { key: 'pickupAddress', label: 'Адрес погрузки', group: 'Отправитель' },
  { key: 'pickupAt', label: 'Время погрузки', group: 'Отправитель', type: 'datetime-local' },

  { key: 'carrierName', label: 'Перевозчик', group: 'Перевозчик' },
  { key: 'carrierInn', label: 'ИНН перевозчика', group: 'Перевозчик' },
  { key: 'driverName', label: 'Водитель', group: 'Перевозчик' },
  { key: 'driverPhone', label: 'Телефон водителя', group: 'Перевозчик' },
  { key: 'vehicleNumber', label: 'Госномер машины', group: 'Перевозчик' },
  { key: 'vehicleModel', label: 'Марка машины', group: 'Перевозчик' },

  { key: 'consigneeName', label: 'Грузополучатель', group: 'Получатель' },
  { key: 'consigneeAddress', label: 'Адрес СЦ', group: 'Получатель' },
  { key: 'deliveryAt', label: 'Время сдачи', group: 'Получатель', type: 'datetime-local' },

  { key: 'cargoPlaces', label: 'Мест (коробов)', group: 'Груз', type: 'number' },
  { key: 'cargoWeightKg', label: 'Вес, кг', group: 'Груз', type: 'number' },
  { key: 'cargoDescription', label: 'Наименование груза', group: 'Груз' },
];

const GROUPS = ['Документ', 'Отправитель', 'Перевозчик', 'Получатель', 'Груз'];

/** Значение для input: даты обрезаем под формат поля, null превращаем в пустую строку. */
const toInput = (v: unknown, type?: string): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (type === 'date') return s.slice(0, 10);
  if (type === 'datetime-local') return s.slice(0, 16);
  return s;
};

/**
 * Электронная транспортная накладная по поставке FBO.
 *
 * С 01.09 сортировочные центры принимают только электронные транспортные документы,
 * бумажные больше не принимаются, а за нарушение порядка оформления предусмотрена
 * ответственность по ст. 11.14.3 КоАП РФ.
 *
 * ЧТО ЭТА КАРТОЧКА ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Подписание ЭТрН по закону идёт только
 * через аккредитованного оператора ИС ЭПД — у нас это Контур.Диадок. Система готовит
 * реквизиты перевозки, ведёт статус и хранит подписанный файл рядом с поставкой, чтобы
 * при проверке его искали по отгрузке, а не в почте. Подпись ставит руководитель в
 * Диадоке своей КЭП, и «Подписана» здесь включается только вместе с загруженным файлом:
 * иначе система показывала бы юридический статус, которого нет.
 */
const EtrnCard = ({ supply, isManager }: EtrnCardProps) => {
  const { toast } = useToast();
  const [doc, setDoc] = useState<EtrnDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const fillForm = (d: EtrnDocument | null) => {
    if (!d) return;
    const next: Record<string, string> = {};
    FIELDS.forEach((f) => {
      next[f.key] = toInput((d as unknown as Record<string, unknown>)[f.key], f.type);
    });
    next.comment = d.comment || '';
    setForm(next);
  };

  useEffect(() => {
    fetchEtrn(supply.id)
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
      const d = await createEtrn(supply.id);
      setDoc(d);
      fillForm(d);
      toast({
        title: 'Накладная заведена',
        description: 'Реквизиты отправителя и склад подставлены — проверьте водителя и машину',
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
      const d = await updateEtrn(supply.id, fields as EtrnEditableFields);
      setDoc(d);
      toast({ title: 'Накладная сохранена' });
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

  const handleStatus = async (status: EtrnDocument['status']) => {
    try {
      const d = await setEtrnStatus(supply.id, status);
      setDoc(d);
      toast({ title: `Статус: ${status}` });
    } catch (e) {
      toast({
        title: 'Не удалось сменить статус',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const d = await attachSignedEtrn(supply.id, base64, file.name);
      setDoc(d);
      toast({
        title: 'Подписанная накладная загружена',
        description: 'Документ отмечен подписанным и хранится в поставке',
      });
    } catch (e) {
      toast({
        title: 'Не удалось загрузить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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

  // Накладной ещё нет. Кладовщику показываем предупреждение, а не пустоту: без
  // документа груз на СЦ не примут, и узнать об этом лучше до выезда машины.
  if (!doc) {
    return (
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Транспортная накладная (ЭТрН)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            По этой поставке накладная не заведена. С 1 сентября сортировочные центры
            принимают только электронные транспортные документы — бумажные версии
            не принимаются.
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
              Накладную заводит менеджер — без неё груз на складе не примут.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const locked = doc.status === 'Подписана';

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Транспортная накладная (ЭТрН)
          <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
          {doc.number && (
            <span className="font-mono-tech text-xs font-normal text-muted-foreground">
              № {doc.number}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {doc.signedFileUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={doc.signedFileUrl} target="_blank" rel="noreferrer">
                <Icon name="FileCheck2" size={14} className="mr-1.5" />
                Подписанный документ
              </a>
            </Button>
          )}
          {isManager && !locked && doc.status === 'Черновик' && (
            <Button size="sm" variant="secondary" onClick={() => handleStatus('На подписи')}>
              <Icon name="Send" size={14} className="mr-1.5" />
              Отправить на подпись
            </Button>
          )}
          {isManager && !locked && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.xml,.zip,.sig,.p7s"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Icon
                  name={uploading ? 'Loader2' : 'Upload'}
                  size={14}
                  className={`mr-1.5 ${uploading ? 'animate-spin' : ''}`}
                />
                Загрузить подписанную
              </Button>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Главное, что человек должен понять про этот блок: подпись ставится не здесь.
            Без этой строки кладовщик будет искать в системе кнопку «подписать». */}
        <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          Подписание идёт в {doc.operatorName || 'Контур.Диадок'} — по закону ЭТрН
          подписывается только через аккредитованного оператора ИС ЭПД. Здесь готовятся
          реквизиты перевозки; подписанный документ загружается обратно и хранится в поставке.
        </p>

        {doc.status === 'На подписи' && (
          <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <Icon name="Clock" size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
            Ждём подпись руководителя в Диадоке. После подписания загрузите файл сюда —
            машину можно выпускать только с подписанной накладной.
          </p>
        )}

        {locked && (
          <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <Icon name="ShieldCheck" size={15} className="mt-0.5 shrink-0" />
            Подписал: {doc.signedByName || '—'}
            {doc.signedAt ? `, ${formatDateTime(doc.signedAt)}` : ''}. Реквизиты
            подписанной накладной изменить нельзя.
          </p>
        )}

        {GROUPS.map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{group}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.filter((f) => f.group === group).map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    type={f.type || 'text'}
                    value={form[f.key] ?? ''}
                    disabled={!isManager || locked}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, [f.key]: e.target.value }))
                    }
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
            disabled={!isManager || locked}
            onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
          />
        </div>

        {isManager && !locked && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
              ) : null}
              Сохранить накладную
            </Button>
            {doc.status !== 'Аннулирована' && (
              <Button variant="outline" onClick={() => handleStatus('Аннулирована')}>
                Аннулировать
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EtrnCard;