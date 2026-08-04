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
        className="flex max-w-full flex-col items-center justify-center gap-6 border-none bg-background p-0 sm:h-screen sm:max-h-screen sm:w-screen sm:max-w-none sm:rounded-none"
      >
        <DialogTitle className="sr-only">QR-код для открытия смены</DialogTitle>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="ScanLine" size={20} />
            <p className="text-lg font-medium">Поднесите к сканеру терминала, чтобы открыть смену</p>
          </div>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Персональный QR-код сотрудника" className="h-auto w-full max-w-md" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center">
              <Icon name="Loader2" size={32} className="animate-spin text-muted-foreground" />
            </div>
          )}
          {user && (
            <div className="text-center">
              <p className="text-lg font-semibold">{user.name}</p>
              <p className="font-mono-tech text-sm text-muted-foreground">{code}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Цех {user.workshopId ?? 1} · Смена {user.shiftNumber ?? '—'}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShiftQrDialog;
