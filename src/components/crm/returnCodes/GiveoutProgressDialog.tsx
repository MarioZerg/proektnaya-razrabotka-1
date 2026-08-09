import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import type { GiveoutProgress } from '@/lib/returnCodesApi';

interface GiveoutProgressDialogProps {
  watchingId: number | null;
  progress: GiveoutProgress | null;
  onOpenChange: (open: boolean) => void;
}

/** Живой счётчик: сколько коробок сотрудник ПВЗ уже отсканировал. */
const GiveoutProgressDialog = ({
  watchingId,
  progress,
  onOpenChange,
}: GiveoutProgressDialogProps) => (
  <Dialog open={!!watchingId} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Приёмка возвратов</DialogTitle>
      </DialogHeader>
      {!progress ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Ждём данные от OZON…
        </div>
      ) : (
        <div className="space-y-4 py-2">
          <div className="text-center">
            <p className="text-4xl font-bold">
              {progress.scanned}
              <span className="text-2xl text-muted-foreground"> / {progress.total}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              отсканировано сотрудником пункта выдачи
            </p>
          </div>

          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{
                width: `${progress.total ? (progress.scanned / progress.total) * 100 : 0}%`,
              }}
            />
          </div>

          {progress.scanned >= progress.total && progress.total > 0 ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-900">
              Все возвраты приняты — можно забирать
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Осталось принять: {Math.max(progress.total - progress.scanned, 0)} шт.
            </p>
          )}

          {progress.items.length > 0 && (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
              {progress.items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <Icon
                    name={it.approved ? 'CircleCheck' : 'Circle'}
                    size={14}
                    className={it.approved ? 'text-emerald-600' : 'text-muted-foreground'}
                  />
                  <span className="truncate">{it.name || 'Товар'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

export default GiveoutProgressDialog;
