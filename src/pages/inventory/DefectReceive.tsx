import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchPendingDefects,
  fetchDefectHistory,
  receiveDefect,
  type PendingDefect,
  type DefectHistoryRow,
} from '@/lib/kioskApi';

/** Роль в записи брака — показываем словом, а не кодом. */
const roleLabels: Record<string, string> = {
  cutter: 'закройщик',
  sewer: 'швея',
  packer: 'упаковщица',
  storekeeper: 'кладовщик',
};

const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * Приёмка брака из цеха на складе.
 *
 * Раньше это было доступно только на терминале в цехе — кладовщик со своего компьютера
 * брак принять не мог. Здесь всё на одной странице: сканируешь стикеры подряд, как при
 * сборке поставки, и сразу видишь по каждому куску закройщика, причину, метраж, материал,
 * рулон и поставщика.
 *
 * Отрезанные куски поставщик обратно не принимает, поэтому весь брак идёт в утиль. Но
 * накопленную статистику «какой брак из какого рулона» показываем поставщику как
 * претензию по качеству партии — для этого внизу история принятого брака.
 */
const DefectReceive = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const canView = user?.role === 'admin' || isStorekeeperRole(user?.role);

  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingDefect[]>([]);
  const [history, setHistory] = useState<DefectHistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastReceived, setLastReceived] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetchPendingDefects()
      .then(setPending)
      .catch(() => setPending([]));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!showHistory) return;
    fetchDefectHistory(90)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [showHistory]);

  const handleScan = async () => {
    const value = barcode.trim().toUpperCase();
    if (!value || saving) return;
    setBarcode('');
    setSaving(true);
    try {
      const res = await receiveDefect(value, user?.id, user?.name);
      toast({
        title: `Принят брак: ${res.materialName}`,
        description: `${formatQty(res.quantity)} ${res.unit || ''} — ${res.reasonLabel} (нашёл: ${res.foundBy})`,
      });
      setLastReceived((prev) => [value, ...prev].slice(0, 10));
      load();
    } catch (e) {
      toast({
        title: 'Не удалось принять брак',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const totalPending = pending.reduce((sum, p) => sum + p.quantity, 0);
  const largeCount = pending.filter((p) => p.isLarge).length;

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен складу и администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Приём брака из цеха</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сканируйте стикеры подряд — меню открывать заново не нужно
          </p>
        </div>

        {/* Поле сканирования держим вверху и всегда в фокусе: кладовщик разбирает
            контейнер и сканирует куски один за другим, не трогая мышь. */}
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Отсканируйте стикер на бракованном куске
            </div>
            <Input
              ref={inputRef}
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              placeholder="DF-000001"
              className="h-14 font-mono-tech text-lg"
              disabled={saving}
            />
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
                <p className="font-bold text-amber-900">
                  Крупных кусков: {largeCount} шт.
                </p>
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* История: из каких рулонов и от каких поставщиков идёт брак. */}
        <div className="space-y-3">
          <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
            <Icon name={showHistory ? 'ChevronUp' : 'ChevronDown'} size={16} className="mr-2" />
            {showHistory ? 'Скрыть' : 'Показать'} принятый брак за 3 месяца
          </Button>

          {showHistory && (
            <>
              <p className="text-sm text-muted-foreground">
                Отрезанные куски поставщик обратно не принимает — всё идёт в утиль. Но эту
                статистику можно показать поставщику как претензию по качеству партии
              </p>
              <Card className="shadow-none">
                <CardContent className="divide-y p-0">
                  {history.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      Принятого брака за период нет
                    </p>
                  ) : (
                    history.map((h) => (
                      <div key={h.barcode} className="space-y-1 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {h.materialName} — {formatQty(h.quantity)} {h.unit || ''}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(h.receivedAt)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {h.reasonLabel} · {h.userName}
                          {h.userRole && ` (${roleLabels[h.userRole] || h.userRole})`}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {h.rollBarcode && <span>Рулон: {h.rollBarcode}</span>}
                          {h.supplierName && <span>Поставщик: {h.supplierName}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default DefectReceive;
