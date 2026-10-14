import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';

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
    <ScanInputCard
      title="Отсканируйте штрихкод рулона"
      hint={
        <>
          Сканер сам подставит код. Цена — с рулона из той приёмки, с которой его приняли.
          {supplierHint ? ` Сейчас собираем возврат: ${supplierHint}.` : ''}
        </>
      }
      onBackgroundClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a')) {
          scanInputRef.current?.focus();
        }
      }}
    >
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
    </ScanInputCard>
  );
};

export default ReturnToSupplierScanner;
