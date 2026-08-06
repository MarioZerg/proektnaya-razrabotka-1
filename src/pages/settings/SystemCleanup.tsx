import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchCleanupPreview,
  runCleanup,
  CONFIRM_PHRASE,
  SECTION_LABELS,
  type CleanupPreview,
  type CleanupResult,
} from '@/lib/systemCleanupApi';

/** Разовая очистка системы перед стартом работы с чистого листа. Экран временный:
 * после переноса данных со старой системы его убираем. Доступен только администратору. */
const SystemCleanup = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchCleanupPreview()
      .then(setPreview)
      .catch(() =>
        toast({ title: 'Не удалось загрузить данные', variant: 'destructive' })
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await runCleanup(confirmText.trim());
      setResult(res);
      setConfirmText('');
      toast({
        title: 'Система очищена',
        description: `Удалено записей: ${res.totalDeleted}`,
      });
    } catch (err) {
      toast({
        title: 'Не удалось очистить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  if (!isAdmin) {
    return (
      <CrmLayout>
        <div className="rounded-lg border border-border p-6 text-center text-muted-foreground">
          Раздел доступен только администратору
        </div>
      </CrmLayout>
    );
  }

  const rows = (data: Record<string, number>, onlyNonZero = true) =>
    Object.entries(data)
      .filter(([, count]) => (onlyNonZero ? count > 0 : true))
      .sort((a, b) => b[1] - a[1]);

  return (
    <CrmLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-bold">Очистка системы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Удаляет всю рабочую историю, чтобы начать работу с чистого листа. Настройки,
            сотрудники и карточки товаров остаются.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Icon name="Loader2" size={18} className="animate-spin" />
            Считаем данные…
          </div>
        ) : result ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
              <Icon name="CheckCircle2" size={24} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-lg font-bold">Готово — система очищена</p>
                <p className="mt-1 text-sm">
                  Удалено записей: {result.totalDeleted}. Можно переносить данные из старой
                  системы.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3 font-semibold">Что осталось</div>
              <div className="divide-y divide-border">
                {rows(result.kept).map(([key, count]) => (
                  <div key={key} className="flex justify-between px-4 py-2 text-sm">
                    <span>{SECTION_LABELS[key] || key}</span>
                    <span className="font-mono-tech text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-destructive/40">
                <div className="border-b border-border bg-destructive/5 px-4 py-3">
                  <p className="font-semibold text-destructive">Будет удалено</p>
                  <p className="text-xs text-muted-foreground">
                    Всего записей: {preview?.totalToDelete ?? 0}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {preview &&
                    rows(preview.willDelete).map(([key, count]) => (
                      <div key={key} className="flex justify-between px-4 py-2 text-sm">
                        <span>{SECTION_LABELS[key] || key}</span>
                        <span className="font-mono-tech text-muted-foreground">{count}</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="rounded-lg border border-emerald-300">
                <div className="border-b border-border bg-emerald-50 px-4 py-3">
                  <p className="font-semibold text-emerald-800">Останется</p>
                  <p className="text-xs text-muted-foreground">Настройки и справочники</p>
                </div>
                <div className="divide-y divide-border">
                  {preview &&
                    rows(preview.willKeep).map(([key, count]) => (
                      <div key={key} className="flex justify-between px-4 py-2 text-sm">
                        <span>{SECTION_LABELS[key] || key}</span>
                        <span className="font-mono-tech text-muted-foreground">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3 text-amber-900">
                <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Действие необратимо</p>
                  <p className="mt-1 text-sm">
                    Вернуть удалённые заказы, ткань и историю будет нельзя. Убедитесь, что
                    интеграции маркетплейсов на паузе.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-amber-900">
                  Для подтверждения введите слово {CONFIRM_PHRASE}
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  className="bg-background font-mono-tech"
                />
              </div>

              <Button
                variant="destructive"
                className="h-12 w-full text-base"
                disabled={running || confirmText.trim() !== CONFIRM_PHRASE}
                onClick={handleRun}
              >
                {running ? (
                  <Icon name="Loader2" size={18} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="Trash2" size={18} className="mr-2" />
                )}
                Очистить систему
              </Button>
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default SystemCleanup;
