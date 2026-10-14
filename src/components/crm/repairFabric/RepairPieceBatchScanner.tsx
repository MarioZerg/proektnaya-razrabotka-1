import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import { acceptRepairPiece } from '@/lib/repairFabricApi';
import ScanErrorAlert from '@/components/crm/scan/ScanErrorAlert';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';

interface RepairPieceBatchScannerProps {
  /** Кусок лёг в цех — обновить список. */
  onAccepted: () => void;
}

interface AcceptedRow {
  barcode: string;
  title: string;
  reason: string | null;
  retried: boolean;
}

const TRANSIENT = /База занята|Нет связи|Failed to fetch|NetworkError|Load failed/i;

/**
 * Пакетный приём кусков на перешив.
 *
 * Кладовщик пикает стикеры RS подряд — каждый кусок сразу встаёт в цех.
 * Принимается только стикер на перешив: GW и прочие коды отбиваются.
 * Один и тот же кусок дважды не проходит.
 */
const RepairPieceBatchScanner = ({ onAccepted }: RepairPieceBatchScannerProps) => {
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    primeScanSounds();
    focusInput();
  }, []);

  const fail = (msg: string) => {
    playScanErrorSound();
    setError(msg);
    focusInput();
  };

  const handleScan = async () => {
    const code = barcode.trim().toUpperCase();
    if (!code || busy) return;
    setBarcode('');
    setError(null);
    if (code.startsWith('GW-')) {
      fail(`${code} — стикер хранения GW. В куски сканируйте только стикер на перешив RS`);
      return;
    }
    if (!/^RS-\d+$/.test(code)) {
      fail(`${code} — не стикер на перешив. Сканируйте только стикер RS`);
      return;
    }
    if (accepted.some((a) => a.barcode === code)) {
      fail(`${code} уже принят в цех — повторно не сканируется`);
      return;
    }
    setBusy(true);
    try {
      let res: Awaited<ReturnType<typeof acceptRepairPiece>> | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await acceptRepairPiece(code, { id: user?.id, name: user?.name }, attempt > 0);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (!TRANSIENT.test(msg) || attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      if (!res) throw new Error('Не удалось принять кусок');
      playScanSound();
      const title =
        res.material && res.width && res.height
          ? `${res.material} ${res.width}×${res.height}`
          : res.material || 'Кусок';
      setAccepted((prev) => [
        { barcode: res.barcode.toUpperCase(), title, reason: res.reasonLabel, retried: !!res.alreadyAccepted },
        ...prev,
      ]);
      onAccepted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось принять кусок';
      fail(
        TRANSIENT.test(msg)
          ? `${code}: связь с сервером не восстановилась. Отсканируйте этот стикер ещё раз`
          : msg,
      );
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  return (
    <ScanInputCard
      title="Сканируйте стикеры на перешив подряд"
      headerRight={
        accepted.length > 0 ? (
          <span className="rounded-lg bg-primary px-3 py-1 text-base font-bold text-primary-foreground">
            Принято: {accepted.length}
          </span>
        ) : null
      }
      onBackgroundClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a')) focusInput();
      }}
    >
      <Input
        ref={inputRef}
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleScan()}
        placeholder="Поднесите стикер RS к сканеру"
        className="h-12 bg-background font-mono-tech text-lg"
        autoComplete="off"
      />

      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Принимаем в цех...
        </p>
      )}

      {error && <ScanErrorAlert>{error}</ScanErrorAlert>}

      {accepted.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {accepted.map((a) => (
            <div
              key={a.barcode}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="CircleCheck" size={16} className="shrink-0 text-emerald-600" />
                <span className="truncate font-medium">{a.title}</span>
                {a.reason && <span className="truncate text-muted-foreground">· {a.reason}</span>}
              </span>
              <span className="shrink-0 font-mono-tech text-muted-foreground">
                {a.barcode}
                {a.retried && <span className="ml-1 text-amber-600">(после обрыва)</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </ScanInputCard>
  );
};

export default RepairPieceBatchScanner;
