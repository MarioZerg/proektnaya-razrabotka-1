import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  fetchPendingDefects,
  receiveDefect,
  markDefectMissing,
  type PendingDefect,
} from '@/lib/kioskApi';
import { roleLabels, formatQty } from './defectShared';

/**
 * Приёмка брака сканером.
 *
 * Поля ручного ввода здесь нет намеренно: каждый кусок должен пройти по своему
 * стикеру. Иначе кладовщик мог бы «принять» брак, набрав номер с потолка, и
 * подмешать к сданным кускам лишний материал.
 *
 * Если куска в контейнере нет — его не удаляют и не забывают: кладовщик жмёт
 * «Не найден» и отправляет запись администратору. Тот решает, удержать стоимость
 * с сотрудника или списать как потерянный.
 */
const DefectScanTab = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [pending, setPending] = useState<PendingDefect[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastReceived, setLastReceived] = useState<string[]>([]);
  // Кусок, который кладовщик не нашёл: спрашиваем комментарий перед отправкой.
  const [missingTarget, setMissingTarget] = useState<PendingDefect | null>(null);
  const [missingComment, setMissingComment] = useState('');
  // Скрытое поле: сканер печатает в него, сотрудник его не видит и не правит.
  const hiddenRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');

  const load = () => {
    fetchPendingDefects()
      .then(setPending)
      .catch(() => setPending([]));
  };

  useEffect(load, []);

  const handleScan = async (value: string) => {
    const code = value.trim().toUpperCase();
    if (!code || saving) return;
    setSaving(true);
    try {
      const res = await receiveDefect(code, user?.id, user?.name);
      toast({
        title: `Принят брак: ${res.materialName}`,
        description: `${formatQty(res.quantity)} ${res.unit || ''} — ${res.reasonLabel} (нашёл: ${res.foundBy})`,
      });
      setLastReceived((prev) => [code, ...prev].slice(0, 10));
      load();
    } catch (e) {
      toast({
        title: 'Не удалось принять брак',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
      setTimeout(() => hiddenRef.current?.focus(), 0);
    }
  };

  // Держим фокус на скрытом поле: планшет или мышь могут его увести, и тогда
  // сканер печатает «мимо», а терминал молчит на скан.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.activeElement !== hiddenRef.current && !missingTarget) {
        hiddenRef.current?.focus();
      }
    }, 700);
    return () => clearInterval(t);
  }, [missingTarget]);

  const handleMissing = async () => {
    if (!missingTarget) return;
    setSaving(true);
    try {
      await markDefectMissing(
        missingTarget.barcode,
        missingComment.trim(),
        user?.id,
        user?.name,
      );
      toast({
        title: 'Отправлено администратору',
        description: `Стикер ${missingTarget.barcode} — решение примет администратор`,
      });
      setMissingTarget(null);
      setMissingComment('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const totalPending = pending.reduce((sum, p) => sum + p.quantity, 0);
  const largeCount = pending.filter((p) => p.isLarge).length;

  return (
    <div className="space-y-6">
      {/* Приглашение сканировать. Поля ввода нет — только сканер: каждый кусок
          обязан пройти по своему стикеру, вручную «принять» брак нельзя. */}
      <Card className="border-2 border-dashed border-primary/40 bg-primary/5 shadow-none">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="rounded-full bg-primary/10 p-5">
            <Icon
              name={saving ? 'Loader2' : 'ScanLine'}
              size={56}
              className={`text-primary ${saving ? 'animate-spin' : ''}`}
            />
          </div>
          <p className="text-2xl font-bold">
            {saving ? 'Принимаем…' : 'Отсканируйте стикер на куске брака'}
          </p>
          <p className="text-base text-muted-foreground">
            Сканируйте куски подряд — каждый проходит по своему стикеру
          </p>
          {lastReceived.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Принято за сеанс: {lastReceived.length} — {lastReceived.slice(0, 5).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Крупные куски: из них ещё может получиться изделие, поэтому осматриваем
          внимательно, а не отправляем в утиль не глядя. */}
      {largeCount > 0 && (
        <Card className="border-amber-300 bg-amber-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold text-amber-900">Крупных кусков: {largeCount} шт.</p>
              <p className="text-sm text-amber-900">
                Куски от 2 пог.м отмечены в списке. Осмотрите их тщательно — возможно,
                материал ещё годится в работу
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold">Ждёт приёмки</span>
        <Badge variant={pending.length ? 'destructive' : 'secondary'}>
          {pending.length} шт. · {formatQty(totalPending)}
        </Badge>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Icon name="PackageCheck" size={48} className="text-muted-foreground" />
          <p className="text-base font-semibold">Весь брак принят на склад</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((p) => (
            <Card
              key={p.barcode}
              className={`shadow-none ${p.isLarge ? 'border-amber-300 bg-amber-50' : 'border-border'}`}
            >
              <CardContent className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {p.materialName} — {formatQty(p.quantity)} {p.unit || ''}
                      {p.isLarge && (
                        <Badge className="ml-2 bg-amber-600 text-white hover:bg-amber-600">
                          крупный кусок
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.reasonLabel} · {p.userName}
                      {p.userRole && ` (${roleLabels[p.userRole] || p.userRole})`}
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-mono-tech">
                    {p.barcode}
                  </Badge>
                </div>

                {/* Рулон и поставщик — то, ради чего копится статистика. */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {p.rollBarcode && <span>Рулон: {p.rollBarcode}</span>}
                  {p.supplierName && <span>Поставщик: {p.supplierName}</span>}
                  {p.workshopName && <span>{p.workshopName}</span>}
                </div>
                {p.comment && <p className="text-xs text-muted-foreground">{p.comment}</p>}

                {/* Куска нет в контейнере — отправляем администратору, а не удаляем.
                    Сам кладовщик вопрос не закрывает: иначе пропажу можно скрыть. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setMissingTarget(p);
                    setMissingComment('');
                  }}
                  disabled={saving}
                >
                  <Icon name="SearchX" size={16} className="mr-2" />
                  Не найден — отправить администратору
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!missingTarget}
        onOpenChange={(v) => {
          if (!v) setMissingTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Кусок не найден</DialogTitle>
          </DialogHeader>
          {missingTarget && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="font-mono-tech font-bold">{missingTarget.barcode}</p>
                <p className="text-sm">
                  {missingTarget.materialName} — {formatQty(missingTarget.quantity)}{' '}
                  {missingTarget.unit || ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  Оформил: {missingTarget.userName}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Запись уйдёт администратору. Он решит: удержать стоимость с сотрудника
                или списать кусок как потерянный
              </p>
              <Textarea
                value={missingComment}
                onChange={(e) => setMissingComment(e.target.value)}
                placeholder="Что именно не так (необязательно): контейнер пуст, стикер оторван…"
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setMissingTarget(null)}
                >
                  Отмена
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleMissing}
                  disabled={saving}
                >
                  {saving && <Icon name="Loader2" size={16} className="mr-2 animate-spin" />}
                  Отправить администратору
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Скрытое поле для сканера: кладовщик его не видит и набрать номер руками
          не может — брак принимается только по реальному стикеру. */}
      <input
        ref={hiddenRef}
        autoFocus
        onChange={(e) => {
          bufferRef.current = e.target.value;
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const value = bufferRef.current;
          bufferRef.current = '';
          if (hiddenRef.current) hiddenRef.current.value = '';
          handleScan(value);
        }}
        className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default DefectScanTab;
