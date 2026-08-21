import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';

/** Всего нужно сканов: паспорт, страница с пропиской, СНИЛС. */
const DOCS_TOTAL = 3;

interface Props {
  emp: Employee;
  /** Компактный вид — для строки списка, где места мало. */
  compact?: boolean;
}

/**
 * Готовность документов сотрудника — тремя значками.
 *
 * Раньше, чтобы понять, кому чего не хватает для договора, приходилось
 * открывать карточку каждого по очереди. Теперь видно прямо в списке:
 *
 *   · сканы — сколько из трёх загружено;
 *   · паспорт — сверил ли администратор данные со сканом;
 *   · выплаты — указан ли номер СБП и подтверждён ли он.
 *
 * Зелёный — готово, жёлтый — ждёт администратора, серый — сотрудник ещё не
 * прислал. Договор нельзя сформировать, пока все три не зелёные.
 */
const DocsReadyBadges = ({ emp, compact = false }: Props) => {
  const docs = emp.docsCount ?? 0;
  const docsReady = docs >= DOCS_TOTAL;
  const passportOk = !!emp.passportVerified;
  const sbpOk = !!emp.sbpConfirmed;
  const hasSbp = !!emp.sbpPhone;

  const items = [
    {
      key: 'docs',
      icon: 'FileText',
      label: `Сканы ${docs}/${DOCS_TOTAL}`,
      title: docsReady
        ? 'Все сканы загружены'
        : `Загружено ${docs} из ${DOCS_TOTAL}: нужен паспорт, прописка и СНИЛС`,
      // Комплект собран, но паспорт ещё не сверен — очередь за администратором.
      state: docsReady ? (passportOk ? 'ok' : 'wait') : 'none',
    },
    {
      key: 'passport',
      icon: 'BookUser',
      label: 'Паспорт',
      title: passportOk
        ? 'Паспортные данные сверены со сканом'
        : docsReady
          ? 'Сканы есть — сверьте паспортные данные'
          : 'Нет сканов, сверять нечего',
      state: passportOk ? 'ok' : docsReady ? 'wait' : 'none',
    },
    {
      key: 'sbp',
      icon: 'Wallet',
      label: hasSbp ? emp.sbpPhone! : 'Нет СБП',
      title: sbpOk
        ? `Выплаты по СБП: ${emp.sbpPhone}`
        : hasSbp
          ? `Номер ${emp.sbpPhone} указан, но не подтверждён — деньги уйдут только после проверки`
          : 'Сотрудник не указал номер для выплат',
      state: sbpOk ? 'ok' : hasSbp ? 'wait' : 'none',
    },
  ];

  const color = (state: string) =>
    state === 'ok'
      ? 'text-emerald-600'
      : state === 'wait'
        ? 'text-amber-600'
        : 'text-muted-foreground/40';

  if (compact) {
    // Значки крупнее и на подложке: мелкие серые иконки в ряду сливались с
    // текстом, и разобрать, чего не хватает, было невозможно.
    const bg = (state: string) =>
      state === 'ok'
        ? 'bg-emerald-100'
        : state === 'wait'
          ? 'bg-amber-100'
          : 'bg-muted';
    return (
      <span className="flex shrink-0 items-center gap-1">
        {items.map((i) => (
          <span
            key={i.key}
            title={i.title}
            className={`flex h-5 w-5 items-center justify-center rounded ${bg(i.state)}`}
          >
            <Icon name={i.icon} size={12} className={color(i.state)} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <div
          key={i.key}
          title={i.title}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
        >
          <Icon name={i.icon} size={13} className={color(i.state)} />
          <span
            className={
              i.state === 'none' ? 'text-muted-foreground' : 'font-medium'
            }
          >
            {i.label}
          </span>
          {i.state === 'ok' && (
            <Icon name="Check" size={11} className="text-emerald-600" />
          )}
        </div>
      ))}
    </div>
  );
};

export default DocsReadyBadges;
