import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import type { ReturnPickupCode } from '@/lib/returnCodesApi';

interface ReturnCodeDialogsProps {
  shown: ReturnPickupCode | null;
  setShown: (item: ReturnPickupCode | null) => void;
  canvasRef: RefObject<HTMLCanvasElement>;
  editing: ReturnPickupCode | null;
  setEditing: (item: ReturnPickupCode | null) => void;
  codeValue: string;
  setCodeValue: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

/** Показ кода на весь экран и окно его ручного ввода администратором. */
const ReturnCodeDialogs = ({
  shown,
  setShown,
  canvasRef,
  editing,
  setEditing,
  codeValue,
  setCodeValue,
  saving,
  onSave,
}: ReturnCodeDialogsProps) => (
  <>
    {/* Код во весь экран: приёмщик на ПВЗ сканирует его прямо с телефона. */}
    <Dialog open={!!shown} onOpenChange={(open) => !open && setShown(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shown?.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-4">
          {shown?.codeImage ? (
            <img
              src={`data:image/png;base64,${shown.codeImage}`}
              alt="Штрихкод выдачи возвратов"
              className="w-full max-w-[300px]"
            />
          ) : (
            <canvas ref={canvasRef} />
          )}
          <p className="font-mono-tech text-lg font-bold">{shown?.code}</p>
          <p className="text-center text-sm text-muted-foreground">
            Покажите этот код приёмщику на пункте выдачи
          </p>
          {shown?.dailyRefresh && !shown?.updatedToday && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm font-medium text-destructive">
              Код обновляется раз в сутки, а этот сохранён не сегодня — возьмите
              свежий в личном кабинете, иначе возврат не выдадут
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Код возвратов · {editing?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Штрихкод из личного кабинета</Label>
            <Input
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value)}
              placeholder="Например: 1234567890"
            />
            <p className="text-xs text-muted-foreground">
              Код продавца — по нему на ПВЗ выдают все возвраты
            </p>
            {editing?.dailyRefresh && (
              <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                Этот код меняется каждый день — обновляйте его утром перед поездкой
                на пункт выдачи
              </p>
            )}
          </div>
          <Button onClick={onSave} disabled={saving} className="w-full">
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
);

export default ReturnCodeDialogs;
