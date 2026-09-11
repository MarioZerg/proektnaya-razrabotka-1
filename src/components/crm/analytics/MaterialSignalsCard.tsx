import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { MaterialPerson } from '@/lib/rollsApi';

interface Props {
  people: MaterialPerson[];
}

/** Иконка и цвет под смысл сигнала — чтобы читать список по цвету, а не построчно. */
const signalStyle: Record<string, { icon: string; className: string }> = {
  no_defects: { icon: 'EyeOff', className: 'text-red-700' },
  big_pieces: { icon: 'Scissors', className: 'text-red-700' },
  rare_big: { icon: 'Layers', className: 'text-amber-700' },
  shortage_high: { icon: 'TrendingUp', className: 'text-amber-700' },
};

/**
 * Что требует внимания — самый верх страницы.
 *
 * Главная мысль отчёта: цифры сами по себе ничего не значат, значение имеет
 * СВЯЗЬ между недостачей и браком. Закройщица без единой записи о браке и с
 * высокой недостачей выбрасывает обрезки молча. Кто-то списывает полотном по
 * 30 метров — и у него идеальная недостача, потери просто переехали в другую
 * графу. Глазами в двух отдельных таблицах это не видно, поэтому система ищет
 * такие случаи сама и выносит их наверх.
 */
const MaterialSignalsCard = ({ people }: Props) => {
  const withSignals = people.filter((p) => p.signals.length > 0);
  if (withSignals.length === 0) {
    return (
      <Card className="border-emerald-300 bg-emerald-50 shadow-none">
        <CardContent className="flex items-center gap-2 py-4">
          <Icon name="CircleCheck" size={18} className="text-emerald-700" />
          <span className="text-sm text-emerald-900">
            Отклонений не найдено: брак оформляют все, недостача в пределах общей картины
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300 bg-amber-50 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-amber-900">
          <Icon name="TriangleAlert" size={18} />
          Требует внимания: {withSignals.length}{' '}
          {withSignals.length === 1 ? 'сотрудник' : 'сотрудников'}
        </CardTitle>
        <p className="text-sm text-amber-900">
          Это не обвинение, а повод посмотреть. Недостача и брак — сообщающиеся
          сосуды: если материал не списан в брак, он всплывает как недостача.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {withSignals.map((p) => (
          <div key={p.userName} className="rounded-md border border-amber-300 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{p.userName}</span>
              <Badge variant="outline" className="text-xs">
                недостача {p.shortageQty.toLocaleString('ru-RU')} ·{' '}
                {p.shortagePercent.toFixed(1)}%
              </Badge>
              <Badge variant="outline" className="text-xs">
                брак {p.defectQty.toLocaleString('ru-RU')} · {p.defectCount} зап.
              </Badge>
            </div>
            <ul className="mt-2 space-y-1">
              {p.signals.map((s, i) => {
                const st = signalStyle[s.kind] || signalStyle.rare_big;
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon
                      name={st.icon}
                      size={15}
                      className={`mt-0.5 shrink-0 ${st.className}`}
                    />
                    <span>{s.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default MaterialSignalsCard;
