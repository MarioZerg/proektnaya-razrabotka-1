import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ScanErrorAlert from '@/components/crm/scan/ScanErrorAlert';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';
import type { RepackItem } from '@/lib/kioskApi';

interface RepackScanPanelProps {
  item: RepackItem | null;
  countError: string | null;
  onRetryCount: () => void;
  waiting: number;
  doneCount: number;
  inputRef: RefObject<HTMLInputElement>;
  barcode: string;
  onBarcodeChange: (value: string) => void;
  onScan: () => void;
  onInputBlur: () => void;
  scanning: boolean;
  clearAsk: boolean;
  scanError: string | null;
}

const RepackScanPanel = ({
  item,
  countError,
  onRetryCount,
  waiting,
  doneCount,
  inputRef,
  barcode,
  onBarcodeChange,
  onScan,
  onInputBlur,
  scanning,
  clearAsk,
  scanError,
}: RepackScanPanelProps) => (
  <>
    {/* Сканер и счётчики. Пока вещь на экране — поле заблокировано: сначала
        закончи с ней, потом бери следующую. */}
    {countError && (
      <WarehouseFetchError
        title="Не удалось узнать очередь перепаковки"
        description={countError}
        onRetry={onRetryCount}
      />
    )}
    <ScanInputCard
      touch
      title={item ? 'Закончите с этой вещью' : 'Отсканируйте вещь'}
      hint={
        item
          ? undefined
          : 'Сканируйте наклейку возврата или ярлык отправления, с которым вещь ездила к покупателю — OZON, Wildberries, Яндекс Маркет'
      }
      headerRight={
        <div className="flex gap-2">
          <span className="rounded-lg bg-primary px-4 py-2 text-xl font-bold text-primary-foreground">
            {countError ? 'очередь неизвестна' : `${waiting} шт. за этот месяц`}
          </span>
          {doneCount > 0 && (
            <span className="rounded-lg border border-emerald-400 bg-background px-4 py-2 text-xl font-bold text-emerald-700">
              {doneCount} готово
            </span>
          )}
        </div>
      }
      onBackgroundClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a')) {
          inputRef.current?.focus();
        }
      }}
    >
      <Input
        ref={inputRef}
        autoFocus
        value={barcode}
        onChange={(e) => onBarcodeChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onScan()}
        onBlur={onInputBlur}
        placeholder={
          item ? 'Сначала завершите текущую вещь' : 'Поднесите ярлык к сканеру'
        }
        className="h-14 bg-background font-mono-tech text-xl"
        autoComplete="off"
        disabled={scanning || !!item || clearAsk}
      />

      {scanError && <ScanErrorAlert touch>{scanError}</ScanErrorAlert>}
    </ScanInputCard>
  </>
);

export default RepackScanPanel;
