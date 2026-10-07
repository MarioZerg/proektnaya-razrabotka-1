import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

interface ReturnToSupplierScannerProps {
  scanCode: string;
  setScanCode: (value: string) => void;
  scanning: boolean;
  scanInputRef: RefObject<HTMLInputElement>;
  onScan: () => void;
  supplierHint?: string | null;
}

/**
 * Сканер рулона на возврат: HID-сканер сам добивает код, человек только держит рулон.
 */
const ReturnToSupplierScanner = ({
  scanCode,
  setScanCode,
  scanning,
  scanInputRef,
  onScan,
  supplierHint,
}: ReturnToSupplierScannerProps) => {
  useScannerAutoSubmit(scanCode, onScan, !scanning);

  return (
    <Card className="border-primary/30 bg-primary/5 shadow-none">
      <CardContent
        className="space-y-2 pt-6"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('input, button, a')) {
            scanInputRef.current?.focus();
          }
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon name="ScanLine" size={18} />
          Отсканируйте штрихкод рулона
        </div>
        <p className="text-xs text-muted-foreground">
          Сканер сам подставит код. Цена — с рулона из той приёмки, с которой его приняли.
          {supplierHint ? ` Сейчас собираем возврат: ${supplierHint}.` : ''}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={scanInputRef}
            autoFocus
            placeholder="Штрихкод рулона"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onScan()}
            disabled={scanning}
            className="font-mono-tech"
          />
          <Button className="shrink-0" onClick={onScan} disabled={scanning || !scanCode.trim()}>
            {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReturnToSupplierScanner;
