import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
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
    <div className="space-y-3 rounded-xl border-2 border-violet-300 bg-violet-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-bold text-violet-900">
          {item ? 'Закончите с этой вещью' : 'Отсканируйте вещь'}
        </p>
        <div className="flex gap-2">
          <span className="rounded-lg bg-violet-600 px-4 py-2 text-xl font-bold text-white">
            {countError ? 'очередь неизвестна' : `${waiting} шт. за этот месяц`}
          </span>
          {doneCount > 0 && (
            <span className="rounded-lg border border-emerald-400 bg-white px-4 py-2 text-xl font-bold text-emerald-700">
              {doneCount} готово
            </span>
          )}
        </div>
      </div>

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
        className="h-16 font-mono-tech text-2xl"
        autoComplete="off"
        disabled={scanning || !!item || clearAsk}
      />

      {!item && (
        <p className="text-base text-violet-800">
          Сканируйте наклейку возврата или ярлык отправления, с которым вещь ездила к
          покупателю — OZON, Wildberries, Яндекс Маркет
        </p>
      )}

      {scanError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-3">
          <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-lg font-medium text-destructive">{scanError}</p>
        </div>
      )}
    </div>
  </>
);

export default RepackScanPanel;
