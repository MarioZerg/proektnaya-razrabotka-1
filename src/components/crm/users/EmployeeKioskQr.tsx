import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchWorkshops } from '@/lib/workshopsApi';

interface EmployeeKioskQrProps {
  employeeId: number;
  fullName: string;
  shiftNumber: number | null;
  workshop: string | null;
}

/** Персональный QR сотрудника для входа в терминал цеха (киоск). В коде зашита ссылка вида
 * /kiosk/{цех}?barcode={id}-{смена}-{ГГГГММДД} — сканирование открывает терминал и сразу
 * авторизует сотрудника, пароль не нужен. */
const EmployeeKioskQr = ({ employeeId, fullName, shiftNumber, workshop }: EmployeeKioskQrProps) => {
  const { toast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [workshopId, setWorkshopId] = useState<number>(1);

  useEffect(() => {
    if (!workshop) return;
    fetchWorkshops()
      .then((list) => {
        const found = list.find((w) => w.name === workshop);
        if (found) setWorkshopId(found.id);
      })
      .catch(() => undefined);
  }, [workshop]);

  const today = new Date();
  const dateCode = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const code = `${employeeId}-${shiftNumber ?? 0}-${dateCode}`;
  const url = `${window.location.origin}/kiosk/${workshopId}?barcode=${code}`;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [url]);

  const handlePrint = () => {
    if (!qrDataUrl) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Бейдж ${fullName}</title>
      <style>
        @page { margin: 10mm; }
        body { font-family: Arial, Helvetica, sans-serif; text-align: center; padding: 10mm; }
        img { width: 60mm; height: 60mm; }
        .name { font-size: 16pt; font-weight: bold; margin-top: 4mm; }
        .code { font-family: monospace; font-size: 11pt; margin-top: 2mm; color: #444; }
        .hint { font-size: 9pt; color: #666; margin-top: 3mm; }
      </style></head><body>
      <img src="${qrDataUrl}" alt="QR" />
      <div class="name">${fullName}</div>
      <div class="code">${code}</div>
      <div class="hint">Поднесите QR к сканеру терминала в цехе</div>
      </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      win.onafterprint = () => setTimeout(() => iframe.remove(), 1000);
      win.focus();
      win.print();
    };
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: 'Код скопирован', description: code });
    } catch {
      toast({ title: 'Код сотрудника', description: code });
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon name="QrCode" size={16} className="text-muted-foreground" />
        QR для входа в терминал цеха
      </div>
      <div className="flex items-center gap-3">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR сотрудника" className="h-28 w-28 shrink-0" />
        ) : (
          <div className="grid h-28 w-28 shrink-0 place-items-center">
            <Icon name="Loader2" size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 space-y-2">
          <div className="font-mono-tech text-sm">{code}</div>
          <p className="text-xs text-muted-foreground">
            Цех {workshopId}, смена {shiftNumber ?? '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} disabled={!qrDataUrl}>
              <Icon name="Printer" size={14} className="mr-1.5" />
              Печать бейджа
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCopy}>
              <Icon name="Copy" size={14} className="mr-1.5" />
              Код
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeKioskQr;
