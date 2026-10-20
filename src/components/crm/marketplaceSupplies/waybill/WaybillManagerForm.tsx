import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import type { WaybillDocument } from '@/lib/waybillApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { FIELDS, GROUPS } from './waybillFields';

interface WaybillManagerFormProps {
  supply: SupplyDetail;
  doc: WaybillDocument;
  form: Record<string, string>;
  setForm: Dispatch<SetStateAction<Record<string, string>>>;
  saving: boolean;
  gazelkaLoading: boolean;
  onGenerate: () => void;
  onGazelka: () => void;
  onReady: (ready: boolean) => void;
  onSave: () => void;
}

/** Часть окна для менеджера: кнопки PDF/Газелька/готовность, поля формы и сохранение. */
const WaybillManagerForm = ({
  supply,
  doc,
  form,
  setForm,
  saving,
  gazelkaLoading,
  onGenerate,
  onGazelka,
  onReady,
  onSave,
}: WaybillManagerFormProps) => (
  <>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onGenerate}>
        <Icon name="FileText" size={14} className="mr-1.5" />
        Сформировать PDF
      </Button>
      {supply.gazelkaPlanId || supply.gazelkaId ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={onGazelka}
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
        <Button variant="outline" size="sm" onClick={() => onReady(false)}>
          <Icon name="Undo2" size={14} className="mr-1.5" />
          Снять готовность
        </Button>
      ) : (
        <Button size="sm" className="w-full sm:w-auto" onClick={() => onReady(true)}>
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

    <Button onClick={onSave} disabled={saving}>
      {saving ? <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" /> : null}
      Сохранить накладную
    </Button>
  </>
);

export default WaybillManagerForm;
