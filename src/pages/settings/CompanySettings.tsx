import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchCompanyRequisites,
  saveCompanyRequisites,
  type CompanyRequisites,
} from '@/lib/contractsApi';

const EMPTY: CompanyRequisites = {
  name: '',
  ogrnip: '',
  inn: '',
  address: '',
  phone: '',
  city: '',
};

interface FieldDef {
  key: keyof CompanyRequisites;
  label: string;
  placeholder: string;
  hint?: string;
  /** Без этого поля в договоре встанет прочерк. */
  required?: boolean;
  wide?: boolean;
}

const FIELDS: FieldDef[] = [
  {
    key: 'name',
    label: 'ФИО предпринимателя',
    placeholder: 'Левкин Александр Сергеевич',
    hint: 'Полностью, как в свидетельстве о регистрации',
    required: true,
    wide: true,
  },
  {
    key: 'ogrnip',
    label: 'ОГРНИП',
    placeholder: '322774600341432',
    required: true,
  },
  {
    key: 'inn',
    label: 'ИНН',
    placeholder: '760218194200',
    required: true,
  },
  {
    key: 'city',
    label: 'Город заключения договора',
    placeholder: 'Ярославль',
    hint: 'Ставится в шапке договора рядом с датой',
    required: true,
  },
  {
    key: 'phone',
    label: 'Телефон',
    placeholder: '+7 999 786-35-25',
  },
  {
    key: 'address',
    label: 'Адрес',
    placeholder: '150000, г. Ярославль, ул. Свободы, д. 1, оф. 10',
    hint: 'Адрес регистрации ИП — печатается в разделе с реквизитами сторон',
    required: true,
    wide: true,
  },
];

/** Реквизиты ИП для договоров. Подставляются в каждый формируемый документ:
 * пока поле пустое, в договоре на его месте стоит прочерк. */
const CompanySettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState<CompanyRequisites>(EMPTY);
  const [initial, setInitial] = useState<CompanyRequisites>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    fetchCompanyRequisites(user.id)
      .then((d) => {
        setForm(d);
        setInitial(d);
      })
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        })
      )
      .finally(() => setLoading(false));
  }, [user?.id, toast]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const missing = FIELDS.filter((f) => f.required && !form[f.key].trim());

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await saveCompanyRequisites(user.id, form);
      setInitial(form);
      toast({
        title: 'Реквизиты сохранены',
        description: 'Новые договоры будут формироваться с ними',
      });
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
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Реквизиты ИП</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Подставляются в каждый договор с сотрудником
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            {missing.length > 0 && (
              <Card className="border-amber-300 bg-amber-50 shadow-none">
                <CardContent className="flex items-start gap-3 py-4">
                  <Icon
                    name="TriangleAlert"
                    size={22}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  <div>
                    <p className="font-bold text-amber-900">
                      Заполните {missing.length === 1 ? 'поле' : 'поля'}:{' '}
                      {missing.map((f) => f.label.toLowerCase()).join(', ')}
                    </p>
                    <p className="text-sm text-amber-900">
                      Пока поле пустое, в договоре на его месте стоит прочерк — такой
                      документ подписывать нельзя
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="shadow-none">
              <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className={`space-y-1.5 ${f.wide ? 'sm:col-span-2' : ''}`}
                  >
                    <Label>
                      {f.label}
                      {f.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Input
                      value={form[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                    {f.hint && (
                      <p className="text-xs text-muted-foreground">{f.hint}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={saving || !dirty} onClick={handleSave}>
                {saving ? (
                  <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
                ) : (
                  <Icon name="Check" size={16} className="mr-1.5" />
                )}
                Сохранить реквизиты
              </Button>
              {dirty && (
                <span className="text-sm text-muted-foreground">
                  Есть несохранённые изменения
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Изменения применяются к договорам, которые вы сформируете после
              сохранения. Уже подписанные документы остаются как есть.
            </p>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default CompanySettings;
