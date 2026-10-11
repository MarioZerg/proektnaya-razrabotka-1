import { formatDay, RECENT_DAYS, type CapacityReport } from './capacityMath';

interface CapacityHistoryProps {
  report: CapacityReport;
  showAll: boolean;
  setShowAll: (update: (value: boolean) => boolean) => void;
  maxBar: number;
}

/** График сдачи по дням и штуки каждой швеи по датам. */
const CapacityHistory = ({ report, showAll, setShowAll, maxBar }: CapacityHistoryProps) => (
  <>
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-sm font-medium">
          Сдано после стикеровки
          <span className="ml-2 font-normal text-muted-foreground">
            с {formatDay(report.all[0].key)}
          </span>
        </p>
        {report.all.length - (report.todayOpen ? 1 : 0) > RECENT_DAYS && (
          <button
            type="button"
            className="text-xs font-medium text-primary"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? `последние ${RECENT_DAYS}` : `все ${report.all.length} дней`}
          </button>
        )}
      </div>
      <div className="w-full min-w-0 max-w-full overflow-x-auto pb-1">
        <div
          className="flex h-28 items-end gap-1"
          style={{ minWidth: `${report.chart.length * 52}px` }}
        >
          {report.chart.map((day) => {
            const openDay = report.todayOpen && day.key === report.today;
            return (
              <div key={day.key} className="flex h-full w-12 shrink-0 flex-col justify-end gap-0.5">
                <div className="text-center text-[10px] leading-none tabular-nums text-muted-foreground">
                  {day.total}
                </div>
                <div className="flex min-h-0 flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${openDay ? 'bg-emerald-300' : 'bg-emerald-600'}`}
                    style={{ height: `${Math.max(8, (day.total / maxBar) * 100)}%` }}
                    title={`${day.label}: ${day.total}`}
                  />
                </div>
                <div className="text-center text-[10px] text-muted-foreground">{day.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {report.todayOpen
          ? 'Светлый столбик — сегодня, день ещё идёт и в мощность не входит. Считаются только вещи после стикеровки.'
          : 'Пустые дни не входят. В столбике — штуки, которые в этот день прошли стикеровку.'}
      </p>
    </div>

    <p className="text-sm font-medium">Штуки по швеям и датам</p>
    <p className="text-[11px] leading-snug text-muted-foreground">
      «Штук в день» — среднее швеи. В дате — сколько её вещей прошло стикеровку именно в этот день.
    </p>
    <ul className="max-h-72 min-w-0 space-y-2 overflow-auto lg:hidden">
      {report.sewers.map((sewer) => (
        <li key={sewer.id} className="rounded-lg border px-2 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{sewer.name}</span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
              {sewer.perDay === 0 ? '—' : sewer.perDay.toFixed(1).replace('.', ',')}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">штук в день</span>
            </span>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {report.chart.map((day) => {
              const count = day.bySewer.get(sewer.id) || 0;
              if (!count) return null;
              return (
                <li key={day.key} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{day.label}</span>
                  <span className="tabular-nums">{count} шт</span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
    <div className="hidden max-h-64 w-full min-w-0 max-w-full overflow-auto rounded-lg border lg:block">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted/90">
          <tr>
            <th className="sticky left-0 bg-muted/90 px-2 py-1.5 text-left font-medium">Швея</th>
            <th className="px-2 py-1.5 text-right font-medium">штук в день</th>
            {report.chart.map((day) => (
              <th key={day.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                {day.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.sewers.map((sewer) => (
            <tr key={sewer.id} className="border-t">
              <td className="sticky left-0 bg-background px-2 py-1.5 font-medium">{sewer.name}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                {sewer.perDay === 0 ? '—' : sewer.perDay.toFixed(1).replace('.', ',')}
              </td>
              {report.chart.map((day) => {
                const count = day.bySewer.get(sewer.id) || 0;
                return (
                  <td key={day.key} className="px-2 py-1.5 text-right tabular-nums">
                    {count || '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);

export default CapacityHistory;
