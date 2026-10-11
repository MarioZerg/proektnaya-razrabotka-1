import { formatDay, piecesWord, ruDays, type FboPlan, type HaulForecast } from './capacityMath';

interface CapacityForecastProps {
  rate: number;
  fbsDailyInput: string;
  plan: FboPlan;
  fbsPerDay: number;
  fboPieces: number;
  fbsQueue: number;
  haul: HaulForecast | null;
  haulFits: boolean;
  shipDate: string;
  quietDays: number;
  quietFinish: string | null;
}

/** Сколько дней займёт FBO, успеет ли партия к отвозу. */
const CapacityForecast = ({
  rate,
  fbsDailyInput,
  plan,
  fbsPerDay,
  fboPieces,
  fbsQueue,
  haul,
  haulFits,
  shipDate,
  quietDays,
  quietFinish,
}: CapacityForecastProps) => (
  <div>
    {rate <= 0 ? (
      <p className="text-sm text-muted-foreground">
        Пока не из чего взять мощность: в выбранных днях нет сдачи.
      </p>
    ) : fbsDailyInput.trim() === '' ? (
      <p className="mt-3 text-sm text-muted-foreground">
        Укажите средний приход FBS — без него день на FBO не посчитать.
      </p>
    ) : plan.stalled ? (
      <p className="mt-3 text-sm text-amber-800">
        {fbsPerDay > rate
          ? `При ${piecesWord(fbsPerDay)} FBS в день не хватает ${piecesWord(Math.ceil(fbsPerDay - rate))}: на FBO день не остаётся.`
          : 'Такой приход FBS забирает весь день, на FBO ничего не остаётся.'}
      </p>
    ) : (
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-sky-50 px-2.5 py-2 text-sky-950">
          <div className="text-[11px]">На FBO в день</div>
          <div className="text-base font-semibold tabular-nums">{Math.round(plan.freePerDay)} шт</div>
          <div className="text-[11px]">после ежедневного FBS</div>
        </div>
        <div className="rounded-md bg-violet-50 px-2.5 py-2 text-violet-950">
          <div className="text-[11px]">Партия FBO</div>
          <div className="text-base font-semibold">{fboPieces === 0 ? 'штуки не заданы' : ruDays(plan.fboOnlyDays)}</div>
          <div className="text-[11px]">если очередь FBS уже пустая</div>
        </div>
        <div className="rounded-md bg-emerald-50 px-2.5 py-2 text-emerald-950">
          <div className="text-[11px]">С очередью FBS</div>
          <div className="text-base font-semibold">
            {fboPieces === 0 ? 'штуки не заданы' : ruDays(plan.withQueueDays)}
          </div>
          <div className="text-[11px]">
            {plan.finish ? `ориентир ${plan.finish}` : `${piecesWord(fbsQueue)} уже на конвейере`}
          </div>
        </div>
      </div>
    )}
    {haul && rate > 0 && fbsDailyInput.trim() !== '' && !plan.stalled && (
      <p className={`mt-3 rounded-md px-2.5 py-2 text-sm ${haulFits ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'}`}>
        {haul.past
          ? 'Эта дата отвоза уже прошла.'
          : fboPieces === 0
            ? `К ${formatDay(shipDate, true)} швеи успеют около ${piecesWord(haul.pieces)} FBO.`
            : haulFits
              ? `К ${formatDay(shipDate, true)} партия успевает: будет около ${piecesWord(haul.pieces)}, нужно ${piecesWord(fboPieces)}.`
              : `К ${formatDay(shipDate, true)} будет около ${piecesWord(haul.pieces)} из ${piecesWord(fboPieces)}. Не хватает ${piecesWord(fboPieces - haul.pieces)}.`}
      </p>
    )}
    {haul && rate > 0 && fbsDailyInput.trim() !== '' && plan.stalled && !haul.past && (
      <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-950">
        К {formatDay(shipDate, true)} FBO не сдвинется: день занят приходом FBS.
      </p>
    )}
    {rate > 0 && fboPieces + fbsQueue > 0 && (
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Если новый FBS больше не придёт, очередь и партия займут {ruDays(quietDays)}
        {quietFinish ? `, ориентир ${quietFinish}` : ''}.
      </p>
    )}
  </div>
);

export default CapacityForecast;
