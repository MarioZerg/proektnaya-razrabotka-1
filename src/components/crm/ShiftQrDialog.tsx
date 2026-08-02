import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';

interface ShiftQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// QR-код для быстрого входа в систему с телефона — ведёт на главную /crm, где уже есть
// виджет "Моя смена". Планшет с этим QR обычно висит в цехе на Kiosk-экране, сотрудники
// сканируют его своим телефоном и открывают смену в своём собственном аккаунте.
const ShiftQrDialog = ({ open, onOpenChange }: ShiftQrDialogProps) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const url = `${window.location.origin}/crm`;
    QRCode.toDataURL(url, { width: 480, margin: 2 }).then(setQrDataUrl);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        className="flex max-w-full flex-col items-center justify-center gap-6 border-none bg-background p-0 sm:h-screen sm:max-h-screen sm:w-screen sm:max-w-none sm:rounded-none"
      >
        <DialogTitle className="sr-only">QR-код для открытия смены</DialogTitle>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Smartphone" size={20} />
            <p className="text-lg font-medium">Отсканируйте телефоном, чтобы открыть смену</p>
          </div>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR-код для входа в систему" className="h-auto w-full max-w-md" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center">
              <Icon name="Loader2" size={32} className="animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShiftQrDialog;