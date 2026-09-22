import Icon from '@/components/ui/icon';
import { Card, CardContent } from '@/components/ui/card';
import { PAYMENTS, REQUESTED } from '@/components/legal/prosecutorCaseData';

/**
 * Чек-лист документов из требования и сами файлы дела.
 *
 * Пункты списка намеренно отрисованы пустыми квадратами: перед выходом из дома по
 * ним сверяются глазами, как по бумажному чек-листу. Внизу — предупреждение о
 * недостающем приложении, чтобы это не всплыло уже на приёме.
 */
const ProsecutorCaseMaterials = () => (
  <>
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="ClipboardList" size={18} />
        Что требует прокуратура взять с собой
      </h2>
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Паспорт — обязательно. Далее по списку из требования:
          </p>
          <ul className="space-y-2 text-sm">
            {REQUESTED.map((r, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="Square" size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>

    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="Paperclip" size={18} />
        Материалы дела
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <a
              href="/docs/prosecutor/prokuratura-trebovanie.pdf"
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <img
                src="/docs/prosecutor/prokuratura-preview.jpg"
                alt="Требование прокуратуры от 17.09.2026"
                className="mb-3 w-full rounded border"
                loading="lazy"
              />
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon name="FileText" size={16} />
                Требование прокуратуры от 17.09.2026
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                № 202-4260-2026/20780003/Исорг714-26, зам. прокурора Д.А. Рябиков
              </p>
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon name="Receipt" size={16} />
              Квитанции АО «ТБанк»
            </div>
            <div className="grid gap-2">
              {PAYMENTS.map((p) => (
                <a
                  key={p.n}
                  href={p.file}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span>{p.date.split(' ')[0]}</span>
                  <span className="font-semibold">{p.sum}</span>
                </a>
              ))}
            </div>
            <a
              href="/docs/prosecutor/prays-kurant.pdf"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <Icon name="Table2" size={14} />
                Прейскурант (прил. № 7)
              </span>
              <span className="text-xs text-muted-foreground">3 л.</span>
            </a>
            <a
              href="/docs/prosecutor/proekt-dogovora-gph.pdf"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <Icon name="FileSignature" size={14} />
                Проект договора ГПХ (прил. № 8)
              </span>
              <span className="text-xs text-muted-foreground">4 л.</span>
            </a>
            <div className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Скриншот SMS-переписки от 27.08.2026 в материалы ещё не загружен —
              приложите файл, он указан шестым пунктом в описи пояснений.
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  </>
);

export default ProsecutorCaseMaterials;
