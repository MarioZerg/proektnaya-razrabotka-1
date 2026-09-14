import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import Icon from '@/components/ui/icon';
import {
  previewBulkCancel,
  bulkCancelOrders,
  type BulkCancelPreview,
  type BulkCancelResult,
} from '@/lib/ordersApi';

/**
 * СНЯТЬ ЗАКАЗЫ С КОНВЕЙЕРА, КОГДА ЗАКОНЧИЛСЯ МАТЕРИАЛ.
 *
 * Действие необратимое и двустороннее: заказ уходит и у нас, и на маркетплейсе.
 * Поэтому сначала показываем ЧИСЛА — сколько снимется, по каким площадкам, что
 * останется в работе — и только потом даём нажать кнопку. Человек должен видеть
 * масштаб до, а не узнавать его после.
 */

interface BulkCancelDialogProps {
  open: boolean;
  /** Материал, который закончился — по нему собирается список заказов. */
  material: string;
  /** Фильтр маркетплейса с панели: снимаем только то, что админ видит на экране. */
  marketplace: string;
  onClose: () => void;
  /** Перезагрузить список заказов после снятия. */
  onDone: () => void;
}

const BulkCancelDialog = ({
  open,
  material,
  marketplace,
  onClose,
  onDone,
}: BulkCancelDialogProps) => {
  const [preview, setPreview] = useState<BulkCancelPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [result, setResult] = useState<BulkCancelResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !material) return;
    setPreview(null);
    setResult(null);
    setError(null);
    setProcessed(0);
    setLoading(true);
    previewBulkCancel(material, marketplace)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось посчитать заказы'))
      .finally(() => setLoading(false));
  }, [open, material, marketplace]);

  const handleConfirm = async () => {
    if (!preview || preview.orderIds.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const res = await bulkCancelOrders(material, preview.orderIds, (done) =>
        setProcessed(done)
      );
      setResult(res);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Снятие прервалось');
      // Часть заказов могла уже уйти — список обновляем в любом случае.
      onDone();
    } finally {
      setRunning(false);
    }
  };

  const total = preview?.total ?? 0;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !running && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="TriangleAlert" size={18} className="text-destructive" />
            Снять заказы с конвейера
          </DialogTitle>
          <DialogDescription>
            Материал «{material}» закончился — заказы будут сняты и у нас, и на
            маркетплейсе.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем, что можно снять...
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Итог работы: что ушло, что не получилось. Неудачи называем поимённо —
            эти заказы остались на конвейере, с ними нужно разобраться руками. */}
        {result && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
              <Icon name="Check" size={16} className="text-emerald-600" />
              <span>
                Снято с конвейера и отменено на маркетплейсе:{' '}
                <b>{result.done.length}</b>
              </span>
            </div>
            {result.skipped.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                Пропущено {result.skipped.length}: их успели взять в работу, пока шло
                снятие. Раскроенное не отменяем — материал уже разрезан.
              </div>
            )}
            {result.failed.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="font-medium text-destructive">
                  Маркетплейс не принял отмену: {result.failed.length}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Эти заказы остались на конвейере — отмените их в кабинете вручную.
                </p>
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {result.failed.slice(0, 20).map((f) => (
                    <li key={f.id}>
                      {f.orderNumber} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {preview && !result && (
          <div className="space-y-3 text-sm">
            {preview.total === 0 ? (
              <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
                Снимать нечего: нетронутых FBS-заказов из этого материала нет. Всё,
                что по нему есть, уже в раскрое или в пошиве — такие заказы нужно
                довести и отгрузить.
              </div>
            ) : (
              <>
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <p className="font-medium text-destructive">
                    Будет снято заказов: {preview.total}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Заказы уйдут с конвейера и будут отменены на маркетплейсе по API —
                    спокойно, небольшими порциями. Отменить это нельзя.
                  </p>
                </div>

                <ul className="space-y-1 text-muted-foreground">
                  {Object.entries(preview.byMarketplace).map(([mp, count]) => (
                    <li key={mp} className="flex items-center gap-2">
                      <Icon name="Dot" size={16} />
                      {mp}: {count}
                    </li>
                  ))}
                  {preview.groups > 0 && (
                    <li className="flex items-start gap-2">
                      <Icon name="Link" size={14} className="mt-0.5 shrink-0" />
                      Среди них связок Яндекса: {preview.groups} — снимаются целиком,
                      заказ покупателя нельзя разорвать на половину.
                    </li>
                  )}
                </ul>

                {/* Главное, что должен понять админ: снимается НЕ ВСЁ. Уже начатое
                    остаётся в цехе, и материал на него придётся найти. */}
                {(preview.keptInWork > 0 || preview.blockedGroups > 0) && (
                  <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
                    Останется в работе: {preview.keptInWork}. Раскроенное, шьющееся и
                    собранное в поставку не снимаем — ткань уже разрезана.
                    {preview.blockedGroups > 0 && (
                      <> Связок не тронуто: {preview.blockedGroups} — часть их вещей уже в цехе.</>
                    )}
                  </div>
                )}

                {preview.orderNumbers.length > 0 && (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-muted-foreground">
                      Показать номера заказов
                    </summary>
                    <p className="mt-2 max-h-32 overflow-y-auto break-all text-xs text-muted-foreground">
                      {preview.orderNumbers.join(', ')}
                      {preview.total > preview.orderNumbers.length && ' ...'}
                    </p>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {/* Снятие идёт минутами: без полоски кажется, что страница зависла. */}
        {running && (
          <div className="space-y-2">
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground">
              Отменяем на маркетплейсе: {processed} из {total}. Не закрывайте страницу.
            </p>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Готово</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={running}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={running || loading || !preview || preview.total === 0}
              >
                {running ? (
                  <>
                    <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
                    Снимаем...
                  </>
                ) : (
                  <>
                    <Icon name="Trash2" size={16} className="mr-1.5" />
                    Снять {preview?.total ?? 0} заказов
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkCancelDialog;
