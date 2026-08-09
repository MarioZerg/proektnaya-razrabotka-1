import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dateUtils';
import { savePassport, type PersonalData } from '@/lib/personalDataApi';

interface PassportSectionProps {
  data: PersonalData;
  userId: number;
  actorId: number;
  onChanged: () => void;
}

interface FormState {
  passportSeries: string;
  passportNumber: string;
  passportIssuedBy: string;
  passportIssuedDate: string;
  passportDepartmentCode: string;
  birthDate: string;
  registrationAddress: string;
  snils: string;
  inn: string;
}

const fromData = (d: PersonalData): FormState => ({
  passportSeries: d.passportSeries || '',
  passportNumber: d.passportNumber || '',
  passportIssuedBy: d.passportIssuedBy || '',
  passportIssuedDate: d.passportIssuedDate || '',
  passportDepartmentCode: d.passportDepartmentCode || '',
  birthDate: d.birthDate || '',
  registrationAddress: d.registrationAddress || '',
  snils: d.snils || '',
  inn: d.inn || '',
});

/** Паспортные данные для договора. Вносит администратор, сверяя со сканом:
 * ошибка в номере паспорта делает договор недействительным, поэтому отвечает
 * за эти поля человек, а не автоматическое распознавание. */
const PassportSection = ({ data, userId, actorId, onChanged }: PassportSectionProps) => {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(fromData(data));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(fromData(data));
  }, [data]);

  const set = (key: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  // Эти поля попадают в текст договора. Без них документ будет с прочерками.
  const required: (keyof FormState)[] = [
    'passportSeries',
    'passportNumber',
    'passportIssuedBy',
    'passportIssuedDate',
    'registrationAddress',
  ];
  const filled = required.every((k) => form[k].trim());

  const scans = data.documents.filter((d) => d.fileUrl);

  const handleSave = async (verified: boolean) => {
    setSaving(true);
    try {
      await savePassport({ userId, actorId, verified, ...form });
      toast({
        title: verified ? 'Данные проверены' : 'Черновик сохранён',
        description: verified
          ? 'Теперь можно сформировать договор'
          : 'Отметку о проверке поставьте, когда всё сверите',
      });
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">Данные для договора</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Откройте скан рядом и перенесите данные точно как в паспорте
          </p>
        </div>
        {data.personalDataVerified ? (
          <Badge variant="secondary">Проверены</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            Не проверены
          </Badge>
        )}
      </div>

      {scans.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {scans.map((d) => (
            <Button key={d.docType} variant="outline" size="sm" asChild>
              <a href={d.fileUrl || '#'} target="_blank" rel="noreferrer">
                <Icon name="Eye" size={14} className="mr-1.5" />
                {d.label}
              </a>
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0" />
          <p>
            Сотрудник ещё не загрузил сканы. Вносить данные со слов нельзя — сверять
            будет не с чем
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Серия</Label>
          <Input
            value={form.passportSeries}
            onChange={(e) => set('passportSeries')(e.target.value)}
            placeholder="7815"
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Номер</Label>
          <Input
            value={form.passportNumber}
            onChange={(e) => set('passportNumber')(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Кем выдан</Label>
        <Input
          value={form.passportIssuedBy}
          onChange={(e) => set('passportIssuedBy')(e.target.value)}
          placeholder="ГУ МВД России по Ярославской области"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Дата выдачи</Label>
          <Input
            type="date"
            value={form.passportIssuedDate}
            onChange={(e) => set('passportIssuedDate')(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Код подразделения</Label>
          <Input
            value={form.passportDepartmentCode}
            onChange={(e) => set('passportDepartmentCode')(e.target.value)}
            placeholder="760-001"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Дата рождения</Label>
          <Input
            type="date"
            value={form.birthDate}
            onChange={(e) => set('birthDate')(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Адрес регистрации</Label>
        <Input
          value={form.registrationAddress}
          onChange={(e) => set('registrationAddress')(e.target.value)}
          placeholder="г. Ярославль, ул. Свободы, д. 10, кв. 5"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>СНИЛС</Label>
          <Input
            value={form.snils}
            onChange={(e) => set('snils')(e.target.value)}
            placeholder="123-456-789 00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>ИНН</Label>
          <Input
            value={form.inn}
            onChange={(e) => set('inn')(e.target.value)}
            placeholder="760212345678"
          />
        </div>
      </div>

      {data.personalDataVerified && data.personalDataVerifiedAt && (
        <p className="text-xs text-muted-foreground">
          Проверено {formatDateTime(data.personalDataVerifiedAt)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={saving || !filled}
          onClick={() => handleSave(true)}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {saving ? (
            <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Icon name="ShieldCheck" size={14} className="mr-1.5" />
          )}
          Данные проверены
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => handleSave(false)}>
          Сохранить черновик
        </Button>
      </div>

      {!filled && (
        <p className="text-xs text-muted-foreground">
          Для отметки о проверке заполните серию, номер, кем и когда выдан паспорт и
          адрес регистрации — эти данные печатаются в договоре
        </p>
      )}
    </div>
  );
};

export default PassportSection;
