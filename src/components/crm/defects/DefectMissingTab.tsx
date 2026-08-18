import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMissingDefects,
  resolveMissingDefect,
  type MissingDefect,
} from '@/lib/kioskApi';
import { roleLabels, formatQty, formatDate } from './defectShared';

/**
 * Вкладка «Не найдено при приёмке».
 *
 * Куски, которые оформили в цехе, но до склада они не доехали. Решение принимает
 * только администратор: удержать стоимость с сотрудника или списать как потерянный.
 * Кладовщик такие записи не удаляет — иначе пропажу можно было бы скрыть.
 */
const DefectMissingTab = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<MissingDefect[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<MissingDefect | null>(null);
  const [mode, setMode] = useState<'penalty' | 'writeoff'>('writeoff');
  const [comment, setComment] = useState('');

  const load = () => {
    setLoading(true);
    fetchMissingDefects()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleResolve = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const res = await resolveMissingDefect(
        target.id,
        mode,
        comment.trim(),
        user?.id,
        user?.name,
      );
      toast({
        title: mode === 'penalty' ? 'Удержание начислено' : 'Списано как потерянное',
        description:
          mode === 'penalty'
            ? `С сотрудника ${target.userName} удержано ${res.penaltyAmount} ₽`
            : undefined,
      });
      setTarget(null);
      setComment('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить решение',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const waiting = items.filter((i) => !i.resolvedAt);
  const done = items.filter((i) => i.resolvedAt);

  // Сумма удержания = метраж куска × цена материала из рулона.
  const penaltyOf = (d: MissingDefect) =>
    d.costPerUnit != null ? Math.round(d.quantity * d.costPerUnit * 100) / 100 : null;

  const renderCard = (d: MissingDefect) => {
    const sum = penaltyOf(d);
    return (
      <Card
        key={d.id}
        className={`shadow-none ${d.resolvedAt ? 'border-border opacity-70' : 'border-destructive/40'}`}
      >
        <CardContent className="space-y-2 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold">
                {d.materialName} — {formatQty(d.quantity)} {d.unit || ''}
              </p>
              <p className="text-sm text-muted-foreground">
                {d.reasonLabel} · оформил {d.userName}
                {d.userRole && ` (${roleLabels[d.userRole] || d.userRole})`}
              </p>
            </div>
            <Badge variant="secondary" className="font-mono-tech">
              {d.barcode}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {d.rollBarcode && <span>Рулон: {d.rollBarcode}</span>}
            {d.supplierName && <span>Поставщик: {d.supplierName}</span>}
            {d.workshopName && <span>{d.workshopName}</span>}
            <span>Не нашёл: {d.missingByName || '—'} · {formatDate(d.missingAt)}</span>
          </div>
          {d.comment && <p className="text-xs text-muted-foreground">{d.comment}</p>}

          {d.resolvedAt ? (
            <div className="rounded-md border border-border bg-muted/40 p-2 text-sm">
              <span className="font-semibold">
                {d.resolution === 'penalty' ? 'Удержано с сотрудника' : 'Списано как потерянное'}
              </span>
              <span className="text-muted-foreground">
                {' '}· {d.resolvedByName || '—'} · {formatDate(d.resolvedAt)}
              </span>
              {d.resolutionComment && (
                <p className="text-xs text-muted-foreground">{d.resolutionComment}</p>
              )}
            </div>
          ) : isAdmin ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={sum == null}
                onClick={() => {
                  setTarget(d);
                  setMode('penalty');
                  setComment('');
                }}
              >
                <Icon name="BadgeRussianRuble" size={16} className="mr-1.5" />
                Удержать{sum != null ? ` ${sum} ₽` : ' (нет цены рулона)'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTarget(d);
                  setMode('writeoff');
                  setComment('');
                }}
              >
                <Icon name="Trash2" size={16} className="mr-1.5" />
                Списать как потерянное
              </Button>
            </div>
          ) : (
            <p className="border-t border-border pt-2 text-sm text-muted-foreground">
              Ждёт решения администратора
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold">Ждут решения</span>
        <Badge variant={waiting.length ? 'destructive' : 'secondary'}>
          {waiting.length} шт.
        </Badge>
      </div>

      {waiting.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Icon name="PackageCheck" size={40} className="text-muted-foreground" />
          <p className="text-base font-semibold">Все пропавшие куски разобраны</p>
        </div>
      ) : (
        <div className="space-y-2">{waiting.map(renderCard)}</div>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <p className="text-base font-bold">Решённые</p>
          {done.map(renderCard)}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === 'penalty' ? 'Удержать с сотрудника' : 'Списать как потерянное'}
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="font-mono-tech font-bold">{target.barcode}</p>
                <p className="text-sm">
                  {target.materialName} — {formatQty(target.quantity)} {target.unit || ''}
                </p>
                <p className="text-sm text-muted-foreground">Оформил: {target.userName}</p>
              </div>
              {mode === 'penalty' ? (
                <p className="text-sm">
                  С сотрудника <strong>{target.userName}</strong> будет удержано{' '}
                  <strong>{penaltyOf(target)} ₽</strong> — стоимость куска, который не
                  доехал до склада. Удержание появится в финансах отдельной строкой
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Кусок будет списан как потерянный, без удержания с сотрудника.
                  Запись останется в истории
                </p>
              )}
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Причина решения (необязательно)"
                rows={3}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setTarget(null)}>
                  Отмена
                </Button>
                <Button
                  variant={mode === 'penalty' ? 'destructive' : 'default'}
                  className="flex-1"
                  onClick={handleResolve}
                  disabled={saving}
                >
                  {saving && <Icon name="Loader2" size={16} className="mr-2 animate-spin" />}
                  Подтвердить
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DefectMissingTab;
