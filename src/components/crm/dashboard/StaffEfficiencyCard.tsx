import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  fetchStaffEfficiency,
  type StaffEfficiencyData,
  type StaffEfficiencyRow,
} from '@/lib/staffEfficiencyApi';

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Время в минутах человеческим языком: 95 минут читается хуже, чем «1 ч 35 мин». */
const humanMinutes = (min: number | null) => {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
};

type GroupKey = 'sewers' | 'cutters' | 'packers';

const GROUPS: { key: GroupKey; label: string; short: string; icon: string }[] = [
  { key: 'sewers', label: 'Швеи', short: 'Швеи', icon: 'Shirt' },
  { key: 'cutters', label: 'Закройщики', short: 'Крой', icon: 'Scissors' },
  { key: 'packers', label: 'Упаковщики', short: 'Упак.', icon: 'Package' },
];

const PERIODS = [7, 30, 90];

/**
 * Эффективность цеха: кто сколько сделал, с каким темпом и с каким браком.
 *
 * Своей карточки-обёртки у блока нет — он живёт вкладкой внутри общей панели
 * «Люди и результат», и вторая рамка внутри рамки только съедала бы ширину
 * на телефоне.
 *
 * Строка человека — одна строка, а не абзац: раньше под каждым именем шли
 * пять подписей в столбик, и десять сотрудников давали экран прокрутки на
 * ровном месте. Метры, темп и выработка в день теперь стоят колонками.
 */
const StaffEfficiencyCard = () => {
  const [data, setData] = useState<StaffEfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState<GroupKey>('sewers');
  const [showReasons, setShowReasons] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchStaffEfficiency(days)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  const rows: StaffEfficiencyRow[] = data?.[group] || [];
  // Длина полосы — доля от лучшего результата. Абсолютные метры ничего не говорят
  // без сравнения, а рядом с лидером сразу видно, кто насколько отстаёт.
  const maxItems = Math.max(1, ...rows.map((r) => r.items));
  const isPackers = group === 'packers';

  return (
    <div className="space-y-3">
      {/* Группа и период — одной строкой: оба переключателя мелкие, а раньше
          селект периода занимал отдельный этаж над вкладками. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-1 rounded-md bg-muted p-0.5">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
                group === g.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={g.icon} size={13} className="shrink-0" />
              <span className="hidden sm:inline">{g.label}</span>
              <span className="sm:hidden">{g.short}</span>
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md bg-muted p-0.5">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                days === d
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {d} дн
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаем показатели...
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">За выбранный период данных нет</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[360px] divide-y overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.userId} className="flex items-center gap-2.5 px-3 py-2">
                {/* Место в списке: первые три — с медалью, остальным номер.
                    Люди узнают себя в таблице по лицу быстрее, чем по фамилии,
                    поэтому рядом с местом стоит аватарка. */}
                <span className="w-4 shrink-0 text-center text-xs font-bold text-muted-foreground">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <Avatar className="h-8 w-8 shrink-0">
                  {r.avatarUrl && <AvatarImage src={r.avatarUrl} alt={r.userName} />}
                  <AvatarFallback className="text-[10px]">{initials(r.userName)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-sm font-medium">{r.userName}</p>
                    {/* Брак — единственное, что нельзя прятать в колонку:
                        это повод для разговора, а не показатель темпа. */}
                    {r.returnsFault > 0 && (
                      <Badge
                        variant={r.faultRate >= 1 ? 'destructive' : 'outline'}
                        className="ml-auto h-4 shrink-0 px-1 text-[10px] font-normal"
                      >
                        брак {r.faultRate}%
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round((r.items / maxItems) * 100)}%` }}
                    />
                  </div>
                  {/* На узком экране колонки не влезают — цифры уходят под имя
                      одной строкой, без столбика подписей. */}
                  <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground sm:hidden">
                    <span>
                      <b className="text-foreground">{r.items}</b> вещей
                    </span>
                    <span>
                      <b className="text-foreground">{r.meters}</b> м
                    </span>
                    {!isPackers && <span>{humanMinutes(r.medianMinutes)}/вещь</span>}
                    <span>
                      <b className="text-foreground">{r.perDay}</b>/день
                    </span>
                  </p>
                </div>

                <div className="hidden shrink-0 items-baseline gap-4 text-right sm:flex">
                  <span className="w-14">
                    <span className="block text-sm font-bold leading-none tabular-nums">
                      {r.items}
                    </span>
                    <span className="text-[10px] text-muted-foreground">вещей</span>
                  </span>
                  <span className="w-16">
                    <span className="block text-sm font-semibold leading-none tabular-nums">
                      {r.meters}
                    </span>
                    <span className="text-[10px] text-muted-foreground">пог.м</span>
                  </span>
                  {!isPackers && (
                    <span className="w-20">
                      <span className="block text-sm font-semibold leading-none">
                        {humanMinutes(r.medianMinutes)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">на вещь</span>
                    </span>
                  )}
                  <span className="w-14">
                    <span className="block text-sm font-semibold leading-none tabular-nums">
                      {r.perDay}
                    </span>
                    <span className="text-[10px] text-muted-foreground">в день</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Причины возвратов — общей картиной, но под клик: без неё легко решить,
          что во всех возвратах виноват цех, хотя почти все они — передумавший
          покупатель. Каждый день это не смотрят. */}
      {data && data.reasons.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => setShowReasons((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
          >
            Из-за чего возвращают
            <span className="text-xs font-normal text-muted-foreground">
              {data.reasons.length} причин
            </span>
            <Icon
              name="ChevronDown"
              size={15}
              className={`ml-auto shrink-0 text-muted-foreground transition-transform ${
                showReasons ? 'rotate-180' : ''
              }`}
            />
          </button>
          {showReasons && (
            <div className="space-y-1.5 border-t px-3 py-2">
              {data.reasons.slice(0, 6).map((r) => {
                const max = Math.max(1, ...data.reasons.map((x) => x.count));
                return (
                  <div key={r.reason} className="flex items-center gap-2.5 text-xs">
                    <span className="min-w-0 flex-1 truncate" title={r.reason}>
                      {r.reason}
                    </span>
                    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:w-28">
                      <span
                        className={`block h-full rounded-full ${
                          r.isFault ? 'bg-destructive' : 'bg-muted-foreground/40'
                        }`}
                        style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right font-semibold tabular-nums">
                      {r.count}
                    </span>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">
                Красным — возвраты по вине производства: брак, повреждение, не тот товар.
                Серым — решение покупателя, цех на них не влияет
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StaffEfficiencyCard;