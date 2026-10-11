import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import {
  RECENT_DAYS,
  finishOn,
  fboReadyBy,
  loadPackedDays,
  median,
  moscowHour,
  planFbo,
  rowsFromDays,
  todayKey,
  weekdayOf,
  type CapacityReport,
  type DayRow,
} from '@/components/crm/dashboard/capacity/capacityMath';
import CapacityInputs from '@/components/crm/dashboard/capacity/CapacityInputs';
import CapacityForecast from '@/components/crm/dashboard/capacity/CapacityForecast';
import CapacityHistory from '@/components/crm/dashboard/capacity/CapacityHistory';

interface ProductionCapacityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** FBS на конвейере: эти штуки шьются раньше FBO. */
  fbsQueue: number;
  /** FBO на конвейере — подставляется в поле, цифру можно заменить. */
  fboQueue: number;
}

const ProductionCapacityDialog = ({
  open,
  onOpenChange,
  fbsQueue,
  fboQueue,
}: ProductionCapacityDialogProps) => {
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [sewerNames, setSewerNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState('');
  const [fbsDailyInput, setFbsDailyInput] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [minusInput, setMinusInput] = useState('');
  const [showAll, setShowAll] = useState(false);
  const seeded = useRef(false);
  const fbsSeeded = useRef(false);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      fbsSeeded.current = false;
      setShowAll(false);
      setPieces('');
      setFbsDailyInput('');
      setShipDate('');
      setMinusInput('');
      return;
    }
    if (!seeded.current && fboQueue > 0) {
      seeded.current = true;
      setPieces((current) => (current === '' ? String(fboQueue) : current));
    }
  }, [open, fboQueue]);

  useEffect(() => {
    if (!open || rows) return;
    let cancelled = false;
    loadPackedDays()
      .then((days) => {
        if (cancelled) return;
        setError(null);
        const built = rowsFromDays(days);
        setSewerNames(built.names);
        setRows(built.rows);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сдачу швей');
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  const report = useMemo((): CapacityReport => {
    const all = rows || [];
    const today = todayKey();
    const previous = all.filter((day) => day.key !== today);
    const todayRow = all.find((day) => day.key === today);
    const usual = median(previous.map((day) => day.total));
    const todayOpen =
      !!todayRow && moscowHour() < 17 && (usual === 0 || todayRow.total < usual * 0.65);
    const finished = todayOpen ? previous : all;
    const windowDays = showAll ? finished : finished.slice(-RECENT_DAYS);
    const rate = windowDays.length > 0
      ? median(windowDays.map((day) => day.total))
      : (todayRow?.total ?? 0);
    const fbsUsual = median((windowDays.length > 0 ? windowDays : previous).map((day) => day.fbs));
    const workdays = new Set((windowDays.length > 0 ? windowDays : all).map((day) => weekdayOf(day.key)));
    const chart = todayOpen && todayRow
      ? [...windowDays, todayRow]
      : windowDays;
    const ids = new Set<number>();
    chart.forEach((day) => day.bySewer.forEach((_count, id) => ids.add(id)));
    const sewers = [...ids]
      .map((id) => {
        const worked = windowDays.filter((day) => (day.bySewer.get(id) || 0) > 0);
        const total = worked.reduce((sum, day) => sum + (day.bySewer.get(id) || 0), 0);
        const todayCount = todayRow?.bySewer.get(id) || 0;
        const perDay = worked.length > 0 ? total / worked.length : todayCount;
        return {
          id,
          name: sewerNames.get(id) || 'Швея',
          perDay,
          days: worked.length || (todayCount > 0 ? 1 : 0),
          total: total + (todayOpen ? todayCount : 0),
        };
      })
      .sort((a, b) => b.perDay - a.perDay || b.total - a.total);
    return { all, chart, windowDays, rate, fbsUsual, workdays, today, todayOpen, todaySewn: todayRow?.total || 0, sewers };
  }, [rows, sewerNames, showAll]);

  useEffect(() => {
    if (!open || fbsSeeded.current || report.fbsUsual <= 0) return;
    fbsSeeded.current = true;
    setFbsDailyInput(String(Math.round(report.fbsUsual)));
  }, [open, report.fbsUsual]);

  const fboPieces = Math.max(0, Math.floor(Number(pieces) || 0));
  const fbsPerDay = Math.max(0, Math.floor(Number(fbsDailyInput) || 0));
  const minusPercent = Math.min(100, Math.max(0, Number(minusInput) || 0));
  const standardRate = report.rate;
  const rate = standardRate * (1 - minusPercent / 100);
  const plan = planFbo(
    rate,
    fbsPerDay,
    fboPieces,
    fbsQueue,
    report.today,
    report.todaySewn,
    report.workdays,
  );
  const quietDays = rate > 0 ? (fbsQueue + fboPieces) / rate : 0;
  const quietFinish = finishOn(
    fbsQueue + fboPieces,
    rate,
    report.today,
    report.todaySewn,
    report.workdays,
  );
  const haul = shipDate
    ? fboReadyBy(rate, fbsPerDay, fbsQueue, report.today, report.todaySewn, report.workdays, shipDate)
    : null;
  const haulFits = haul != null && !haul.past && fboPieces > 0 && haul.pieces >= fboPieces;
  const maxBar = Math.max(1, ...report.chart.map((day) => day.total));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        className="w-[calc(100vw-1rem)] min-w-0 max-w-[calc(100vw-1rem)] gap-3 overflow-x-hidden p-3 sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:p-5"
      >
        <DialogHeader className="space-y-1 pr-6 text-left">
          <DialogTitle className="text-base sm:text-lg">Мощность производства</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Мощность — штуки швей после стикеровки. Упаковщицы и закройщики в расчёт не входят. Новый FBS забирает часть дня, на FBO остаётся остаток.
          </DialogDescription>
        </DialogHeader>

        {rows === null && !error && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем сдачу швей после стикеровки…
          </div>
        )}

        {error && rows === null && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {rows && report.all.length === 0 && (
          <p className="text-sm text-muted-foreground">
            После стикеровки ещё ничего не сдано — расчёт появится, когда упаковщица закроет первые вещи.
          </p>
        )}

        {rows && report.all.length > 0 && (
          <div className="min-w-0 max-w-full space-y-3">
            <CapacityInputs
              report={report}
              fbsDailyInput={fbsDailyInput}
              setFbsDailyInput={setFbsDailyInput}
              pieces={pieces}
              setPieces={setPieces}
              shipDate={shipDate}
              setShipDate={setShipDate}
              minusInput={minusInput}
              setMinusInput={setMinusInput}
              minusPercent={minusPercent}
              standardRate={standardRate}
              rate={rate}
              fbsQueue={fbsQueue}
              fboQueue={fboQueue}
            />

            <CapacityForecast
              rate={rate}
              fbsDailyInput={fbsDailyInput}
              plan={plan}
              fbsPerDay={fbsPerDay}
              fboPieces={fboPieces}
              fbsQueue={fbsQueue}
              haul={haul}
              haulFits={haulFits}
              shipDate={shipDate}
              quietDays={quietDays}
              quietFinish={quietFinish}
            />

            <CapacityHistory report={report} showAll={showAll} setShowAll={setShowAll} maxBar={maxBar} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductionCapacityDialog;