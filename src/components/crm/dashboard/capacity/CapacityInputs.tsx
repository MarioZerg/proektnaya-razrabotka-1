import { Input } from '@/components/ui/input';
import { piecesWord, type CapacityReport } from './capacityMath';

interface CapacityInputsProps {
  report: CapacityReport;
  fbsDailyInput: string;
  setFbsDailyInput: (value: string) => void;
  pieces: string;
  setPieces: (value: string) => void;
  shipDate: string;
  setShipDate: (value: string) => void;
  minusInput: string;
  setMinusInput: (value: string) => void;
  minusPercent: number;
  standardRate: number;
  rate: number;
  fbsQueue: number;
  fboQueue: number;
}

/** Четыре поля расчёта и короткая сводка: мощность, швеи, дни. */
const CapacityInputs = ({
  report,
  fbsDailyInput,
  setFbsDailyInput,
  pieces,
  setPieces,
  shipDate,
  setShipDate,
  minusInput,
  setMinusInput,
  minusPercent,
  standardRate,
  rate,
  fbsQueue,
  fboQueue,
}: CapacityInputsProps) => (
  <>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:[grid-template-columns:repeat(2,minmax(0,1fr))] xl:[grid-template-columns:repeat(4,minmax(0,1fr))]">
      <label className="min-w-0 rounded-xl border-2 border-sky-400 bg-sky-50 p-3 shadow-sm">
        <span className="block text-sm font-semibold text-sky-950 sm:text-base">FBS приходит в день</span>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={fbsDailyInput}
          placeholder="сколько штук"
          onChange={(event) => setFbsDailyInput(event.target.value)}
          className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
        />
        <span className="mt-1.5 block text-xs leading-snug text-sky-900/80">
          {report.fbsUsual > 0
            ? `Обычно ${Math.round(report.fbsUsual)} после стикеровки. Можно поставить своё.`
            : 'Средний приход FBS за день. Без этой цифры FBO не посчитать.'}
        </span>
      </label>
      <label className="min-w-0 rounded-xl border-2 border-violet-400 bg-violet-50 p-3 shadow-sm">
        <span className="block text-sm font-semibold text-violet-950 sm:text-base">Нужно отшить FBO</span>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={pieces}
          placeholder="сколько штук"
          onChange={(event) => setPieces(event.target.value)}
          className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
        />
        <span className="mt-1.5 block text-xs leading-snug text-violet-900/80">
          На конвейере сейчас {piecesWord(fboQueue)} FBO и {piecesWord(fbsQueue)} FBS.
        </span>
      </label>
      <label className="min-w-0 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 shadow-sm">
        <span className="block text-sm font-semibold text-amber-950 sm:text-base">Дата отвоза FBO</span>
        <Input
          type="date"
          value={shipDate}
          min={report.today}
          onChange={(event) => setShipDate(event.target.value)}
          className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
        />
        <span className="mt-1.5 block text-xs leading-snug text-amber-900/80">
          К этому дню партия уже должна пройти стикеровку.
        </span>
      </label>
      <label className="min-w-0 rounded-xl border-2 border-rose-400 bg-rose-50 p-3 shadow-sm">
        <span className="block text-sm font-semibold text-rose-950 sm:text-base">Минус к выработке, %</span>
        <Input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          value={minusInput}
          placeholder="0"
          onChange={(event) => setMinusInput(event.target.value)}
          className="mt-2 h-12 w-full min-w-0 max-w-full bg-white text-base font-semibold sm:text-lg"
        />
        <span className="mt-1.5 block text-xs leading-snug text-rose-900/80">
          {minusPercent > 0
            ? `Обычные ${Math.round(standardRate)} шт/день станут ${Math.round(rate)}.`
            : 'На сколько процентов занизить обычную сдачу швей. 0 — без скидки.'}
        </span>
      </label>
    </div>

    <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
      <div className="rounded-lg bg-muted/60 px-1.5 py-2">
        <div className="text-base font-bold tabular-nums sm:text-lg">{Math.round(rate)}</div>
        <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
          {minusPercent > 0 ? `шт/день −${minusPercent}%` : 'шт/день швеи'}
        </div>
      </div>
      <div className="rounded-lg bg-muted/60 px-1.5 py-2">
        <div className="text-base font-bold tabular-nums sm:text-lg">{report.sewers.length}</div>
        <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">швей в окне</div>
      </div>
      <div className="rounded-lg bg-muted/60 px-1.5 py-2">
        <div className="text-base font-bold tabular-nums sm:text-lg">{report.windowDays.length}</div>
        <div className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">дней в расчёте</div>
      </div>
    </div>
  </>
);

export default CapacityInputs;
