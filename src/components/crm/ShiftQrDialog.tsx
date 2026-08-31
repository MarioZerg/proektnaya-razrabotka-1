import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';

interface ShiftQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Персональный QR-код сотрудника для терминала цеха (киоск). В коде зашита ссылка
// /kiosk/{цех}?barcode={id}-{смена}-{ГГГГММДД} — сканирование на терминале сразу открывает
// его смену без пароля. Цех и смена берутся из профиля сотрудника.
const ShiftQrDialog = ({ open, onOpenChange }: ShiftQrDialogProps) => {
  const { user } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const today = new Date();
  const dateCode = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const code = user ? `${user.id}-${user.shiftNumber ?? 0}-${dateCode}` : '';
  const kioskUrl = user
    ? `${window.location.origin}/kiosk/${user.workshopId ?? 1}?barcode=${code}`
    : '';

  useEffect(() => {
    if (!open || !kioskUrl) return;
    QRCode.toDataURL(kioskUrl, { width: 480, margin: 2 }).then(setQrDataUrl);
  }, [open, kioskUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        hideClose
        className="flex max-w-full flex-col items-center justify-center gap-0 border-none bg-background p-0 sm:h-screen sm:max-h-screen sm:w-screen sm:max-w-none sm:rounded-none"
      >
        <DialogTitle className="sr-only">QR-код для открытия смены</DialogTitle>

        {/* Своя кнопка закрытия вместо стандартного крестика: тот прижимался к
            правому верхнему углу и наезжал прямо на заголовок. Здесь она круглая,
            крупная (палец попадает без прицеливания) и с подписью — экран часто
            открывают на планшете в цехе мокрыми руками. */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur transition hover:bg-muted hover:text-foreground"
        >
          <Icon name="X" size={18} />
          <span className="hidden sm:inline">Закрыть</span>
        </button>

        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 py-16">
          <div className="space-y-2 text-center">
            <p className="text-2xl font-semibold sm:text-3xl">Отсканируйте свой QR-код</p>
            <p className="text-sm text-muted-foreground">
              Поднесите код к сканеру на терминале — смена откроется сама
            </p>
          </div>

          {qrDataUrl ? (
            // Белая рамка вокруг кода: сканер плохо ловит код, вплотную прижатый
            // к краю экрана, — ему нужно светлое поле по периметру.
            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-6">
              <img
                src={qrDataUrl}
                alt="Персональный QR-код сотрудника"
                className="h-auto w-full max-w-[18rem] sm:max-w-md"
              />
            </div>
          ) : (
            <div className="flex h-64 w-64 items-center justify-center">
              <Icon name="Loader2" size={32} className="animate-spin text-muted-foreground" />
            </div>
          )}

          {user && (
            <p className="text-center text-sm text-muted-foreground">
              {user.name}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShiftQrDialog;