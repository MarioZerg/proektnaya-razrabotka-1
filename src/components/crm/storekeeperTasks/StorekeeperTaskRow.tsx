import Icon from '@/components/ui/icon';
import type { StorekeeperTask } from '@/lib/shiftSessionsApi';

interface StorekeeperTaskRowProps {
  task: StorekeeperTask;
  isDemo: boolean;
  busyKey: string | null;
  claimKey: string | null;
  onToggle: (task: StorekeeperTask) => void;
  onClaim: (task: StorekeeperTask) => void;
  onNavigate: (link: string) => void;
}

/** Строка одного задания смены: галочка, текст с метками и правый блок действий. */
const StorekeeperTaskRow = ({
  task: t,
  isDemo,
  busyKey,
  claimKey,
  onToggle,
  onClaim,
  onNavigate,
}: StorekeeperTaskRowProps) => (
  <div
    className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
      t.idle
        ? // РАБОТЫ ПО ЭТОМУ ДЕЛУ СЕГОДНЯ НЕ БЫЛО.
          // Не выполненное задание и не висящее: поставок не создавали,
          // возвраты не приезжали. Показываем бледной строкой без
          // галочки — зачёркнутая выглядела бы как сделанная работа.
          'border-dashed border-border bg-transparent opacity-45'
        : t.done
          ? 'border-emerald-200 bg-emerald-50/60'
          : t.claimedByOther
            ? // ВЗЯЛ ДРУГОЙ КЛАДОВЩИК.
              // Не наша работа: показываем спокойным серо-синим, без
              // тревожного янтарного — человека это дело не держит.
              'border-slate-200 bg-slate-50 opacity-70'
            : t.blocking
              ? 'border-amber-200 bg-amber-50/60'
              : 'border-border bg-muted/30'
    }`}
  >
    {/* Галочка нажимается на ЛЮБОМ задании: у большинства она встаёт
        сама, когда работа сделана, но закрыть пункт руками можно
        всегда — иначе недоделанное дело запирает смену. */}
    <button
      type="button"
      disabled={t.idle || busyKey === t.key}
      onClick={() => onToggle(t)}
      title={
        t.idle
          ? 'Сегодня такой работы не появлялось'
          : isDemo
            ? 'Демо: нажмите, чтобы посмотреть, как ставится галочка'
            : t.done
              ? 'Снять отметку'
              : 'Отметить выполненным'
      }
      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors ${
        t.done
          ? 'border-emerald-500 bg-emerald-500 text-white'
          : t.idle
            ? 'border-dashed border-muted-foreground/30 bg-transparent'
            : 'border-muted-foreground/40 bg-background'
      } ${
        !t.idle
          ? 'cursor-pointer hover:border-emerald-500'
          : 'cursor-default'
      }`}
    >
      {busyKey === t.key ? (
        <Icon name="Loader2" size={14} className="animate-spin" />
      ) : t.done ? (
        <Icon name="Check" size={14} />
      ) : null}
    </button>

    <button
      type="button"
      onClick={() => onNavigate(t.link)}
      className="min-w-0 flex-1 text-left"
    >
      <span
        className={`block text-[13px] font-semibold leading-snug ${
          t.done && !t.idle ? 'text-muted-foreground line-through' : ''
        }`}
      >
        {t.title}
      </span>
      <span className="block text-[11px] leading-snug text-muted-foreground">
        {t.idle ? 'Сегодня такой работы не появлялось' : t.hint}
      </span>

      {/* Пункт закрыт галочкой, хотя работа осталась. Показываем
          остаток честно: смену это уже не держит, но дело не забыто
          и завтра посчитается заново. */}
      {t.selfClosed && t.count > 0 && (
        <span className="mt-1 flex items-start gap-1 text-[10px] font-medium leading-snug text-sky-700">
          <Icon name="Hand" size={10} className="mt-[1px] shrink-0" />
          Закрыто вручную — осталось {t.count}
        </span>
      )}

      {/* Метка отсечки. До 15:00 — предупреждение «успей собрать»,
          после — объяснение, почему на странице цифра больше, чем
          в задании: новое уже уехало в завтрашний список. */}
      {/* Кто делает задание. Занятое другим не трогаем — иначе двое
          идут в цех за одними и теми же вещами. */}
      {t.claimedBy && !t.done && (
        <span
          className={`mt-1 flex items-start gap-1 text-[10px] font-medium leading-snug ${
            t.claimedByOther ? 'text-slate-600' : 'text-emerald-700'
          }`}
        >
          <Icon
            name={t.claimedByOther ? 'UserCheck' : 'User'}
            size={10}
            className="mt-[1px] shrink-0"
          />
          {t.claimedByOther
            ? `Делает ${t.claimedByName} — не берите`
            : 'Вы взяли это на себя'}
        </span>
      )}
      {t.cutoff && !t.idle && !t.done && (
        <span
          className={`mt-1 inline-flex items-start gap-1 rounded px-1.5 py-0.5 text-left text-[10px] font-medium leading-snug ${
            t.cutoffPassed
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-sky-100 text-sky-800'
          }`}
        >
          <Icon
            name={t.cutoffPassed ? 'Lock' : 'Clock'}
            size={10}
            className="mt-[1px] shrink-0"
          />
          {t.cutoffPassed
            ? 'Список закрыт в 15:00 — новое уйдёт на завтра'
            : 'Собрать до 15:00 — позже в эту смену не добавится'}
        </span>
      )}
    </button>

    <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
      {/* «Беру на себя» — только у своей незанятой работы. Чужое дело
          перехватить нельзя: человек уже пошёл за этими вещами. */}
      {!t.done && !t.idle && !t.manual && !isDemo && !t.claimedByOther && (
        <button
          type="button"
          onClick={() => onClaim(t)}
          disabled={claimKey === t.key}
          title={
            t.claimedBy
              ? 'Отпустить задание — его сможет взять другой'
              : 'Взять на себя, чтобы второй кладовщик это не делал'
          }
          // На телефоне кнопка крупнее: в 10 px по пальцу не попасть.
          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 sm:px-1.5 sm:py-0.5 sm:text-[10px] ${
            t.claimedBy
              ? 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-primary'
          }`}
        >
          {claimKey === t.key ? (
            <Icon name="Loader2" size={10} className="animate-spin" />
          ) : t.claimedBy ? (
            'Отпустить'
          ) : (
            'Беру'
          )}
        </button>
      )}
      {t.count > 0 && !t.done && !t.idle && (
        <span
          className={`rounded-md px-1.5 text-[13px] font-bold ${
            t.claimedByOther
              ? 'bg-slate-200 text-slate-700'
              : 'bg-amber-200 text-amber-900'
          }`}
        >
          {t.count}
        </span>
      )}
    </span>
  </div>
);

export default StorekeeperTaskRow;
