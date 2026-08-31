import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const GROUPS: { key: GroupKey; label: string; icon: string }[] = [
  { key: 'sewers', label: 'Швеи', icon: 'Shirt' },
  { key: 'cutters', label: 'Закройщики', icon: 'Scissors' },
  { key: 'packers', label: 'Упаковщики', icon: 'Package' },
];

const StaffEfficiencyCard = () => {
  const [data, setData] = useState<StaffEfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState<GroupKey>('sewers');

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
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon name="TrendingUp" size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold">Эффективность сотрудников</p>
              <p className="text-xs text-muted-foreground">
                Выработка, темп и возвраты. Обновляется автоматически
              </p>
            </div>
          </div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 дней</SelectItem>
              <SelectItem value="30">30 дней</SelectItem>
              <SelectItem value="90">90 дней</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs value={group} onValueChange={(v) => setGroup(v as GroupKey)}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            {GROUPS.map((g) => (
              <TabsTrigger key={g.key} value={g.key} className="gap-1.5">
                <Icon name={g.icon} size={14} />
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем показатели...
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            За выбранный период данных нет
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div key={r.userId} className="rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  {/* Место в списке: первые три — с медалью, остальным номер.
                      Люди узнают себя в таблице по лицу быстрее, чем по фамилии,
                      поэтому рядом с местом стоит аватарка. */}
                  <span className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <Avatar className="h-10 w-10 shrink-0">
                    {r.avatarUrl && <AvatarImage src={r.avatarUrl} alt={r.userName} />}
                    <AvatarFallback className="text-xs">
                      {initials(r.userName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.userName}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round((r.items / maxItems) * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold leading-none">{r.items}</p>
                    <p className="text-[11px] text-muted-foreground">вещей</p>
                  </div>
                </div>

                {/* Цифры под именем: объём в метрах, темп, сколько в день и брак.
                    Возвраты «по вине покупателя» намеренно не в упрёк сотруднику —
                    показываем только процент брака, за который он действительно
                    отвечает. */}
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 pl-8 text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">{r.meters}</span> пог.м
                  </span>
                  {!isPackers && (
                    <span>
                      на вещь{' '}
                      <span className="font-semibold text-foreground">
                        {humanMinutes(r.medianMinutes)}
                      </span>
                    </span>
                  )}
                  <span>
                    в день{' '}
                    <span className="font-semibold text-foreground">{r.perDay}</span>
                  </span>
                  <span>
                    дней в работе{' '}
                    <span className="font-semibold text-foreground">{r.workDays}</span>
                  </span>
                  {r.returnsFault > 0 ? (
                    <Badge
                      variant={r.faultRate >= 1 ? 'destructive' : 'outline'}
                      className="h-5 font-normal"
                    >
                      брак {r.returnsFault} · {r.faultRate}%
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 font-normal">
                      брака нет
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Причины возвратов — общей картиной. Без неё легко решить, что во всех
            возвратах виноват цех, хотя почти все они — передумавший покупатель. */}
        {data && data.reasons.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-semibold">Из-за чего возвращают</p>
            <div className="space-y-1.5">
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
                    <span className="w-9 shrink-0 text-right font-semibold">
                      {r.count}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Красным — возвраты по вине производства: брак, повреждение, не тот товар.
              Серым — решение покупателя, цех на них не влияет
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StaffEfficiencyCard;
