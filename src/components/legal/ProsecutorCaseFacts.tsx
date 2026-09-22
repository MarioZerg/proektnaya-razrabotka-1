import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PAYMENTS, TIMELINE } from '@/components/legal/prosecutorCaseData';

/**
 * Фактура дела: таблица выплат и хронология событий.
 *
 * Цвет точки в хронологии — не украшение: зелёная отмечает выполненные обязательства
 * (переводы прошли), жёлтая — спорные моменты (уклонение от подписания, отсутствие
 * чеков), синяя — нейтральные факты и даты. По ним видно ход событий одним взглядом.
 */
const ProsecutorCaseFacts = () => (
  <>
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="Banknote" size={18} />
        Выплаты: 48 000 ₽
      </h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Дата</th>
                  <th className="px-4 py-2 font-medium">Сумма</th>
                  <th className="px-4 py-2 font-medium">Квитанция</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {PAYMENTS.map((p) => (
                  <tr key={p.n} className="border-t">
                    <td className="whitespace-nowrap px-4 py-2">{p.date}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-semibold">{p.sum}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      № {p.receipt}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <a href={p.file} target="_blank" rel="noreferrer">
                          <Icon name="FileDown" size={14} className="mr-1" />
                          Чек
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/40">
                  <td className="px-4 py-2 font-semibold">Итого</td>
                  <td className="px-4 py-2 font-semibold">48 000 ₽</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground" colSpan={2}>
                    СБП, комиссия 0 ₽, получатель Анастасия Н. (Сбербанк), +7 (980) 662-22-04
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>

    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="CalendarClock" size={18} />
        Хронология
      </h2>
      <ol className="space-y-3">
        {TIMELINE.map((t, i) => (
          <li key={i} className="flex gap-3">
            <div
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                t.tone === 'ok'
                  ? 'bg-emerald-500'
                  : t.tone === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-sky-500'
              }`}
            />
            <div className="text-sm">
              <div className="font-medium">{t.date}</div>
              <p className="text-muted-foreground">{t.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  </>
);

export default ProsecutorCaseFacts;
