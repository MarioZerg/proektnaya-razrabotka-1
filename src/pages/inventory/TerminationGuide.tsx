import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

const IMG_DATES =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/faef62c0-16a4-44fc-be46-a41b4b863735.jpg';
const IMG_NOTICE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/27c18088-4b5f-4b81-90d3-0648f682ac27.jpg';
const IMG_PARTS =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/9728fd97-52fc-4676-a66b-923fcac7a31b.jpg';

/** Обычные сроки выплат — когда никто никуда не уходит. */
const payoutDates = [
  {
    icon: 'CalendarDays',
    title: 'Работа с 1 по 19 число',
    text: 'Выплата 25 числа этого же месяца.',
  },
  {
    icon: 'CalendarClock',
    title: 'Работа с 20 числа по конец месяца',
    text: 'Выплата 10 числа следующего месяца.',
  },
];

interface Step {
  num: number;
  title: string;
  text: string;
  image?: string;
}

/** Что происходит после того, как исполнитель сообщил об уходе. */
const steps: Step[] = [
  {
    num: 1,
    title: 'Предупредите за 2 недели',
    text: 'Сообщите руководителю о намерении завершить сотрудничество не позднее чем за 14 календарных дней. За это время заказы передаются другому исполнителю, а сданные работы успевают пройти проверку качества.',
    image: IMG_NOTICE,
  },
  {
    num: 2,
    title: 'Отработайте предупредительный срок',
    text: 'В течение двух недель продолжайте выходить на смены по графику и закрывать взятые заказы. Работа этого периода оплачивается на общих основаниях.',
  },
  {
    num: 3,
    title: 'Сдайте незавершённое',
    text: 'Закройте начатые заказы, верните материал и инструмент, закройте смену. Незакрытые заказы и невозвращённый материал — предмет отдельного разбирательства.',
  },
  {
    num: 4,
    title: 'Получите расчёт',
    text: 'Если срок предупреждения соблюдён и работа сдана без замечаний, расчёт выплачивается полностью в ближайшую дату выплаты по общему графику.',
    image: IMG_DATES,
  },
];

/** Когда включается особый порядок расчёта. */
const specialCases = [
  {
    icon: 'CalendarX',
    title: 'Ушёл без предупреждения',
    text: 'Исполнитель перестал выходить на смены, не сообщив о завершении работы, либо скрыл намерение уйти, дожидаясь ближайшей выплаты. Взятые им заказы срывают сроки отгрузки.',
  },
  {
    icon: 'TriangleAlert',
    title: 'Не отработан срок предупреждения',
    text: 'О завершении сотрудничества сообщено менее чем за 14 дней или предупредительный срок не отработан.',
  },
];

/** Частые вопросы. */
const faq = [
  {
    q: 'Почему нельзя уйти сразу',
    a: 'Две причины. Первая — взятые заказы стоят в плане отгрузки с конкретными датами, и внезапный уход срывает поставку, за что маркетплейс штрафует заказчика. Вторая — брак вскрывается уже после отгрузки, иногда через неделю и позже, и сданные работы нужно успеть проверить.',
  },
  {
    q: 'Что будет с деньгами за уже выполненную работу',
    a: 'Оплата за выполненную и принятую работу сохраняется в полном объёме. Меняется только порядок и срок перечисления, если срок предупреждения не соблюдён.',
  },
  {
    q: 'Когда закрывается доступ в систему',
    a: 'Доступ в личный кабинет закрывается после уведомления администратора о завершении работы. Данные о начислениях сохраняются, их можно запросить у руководителя.',
  },
  {
    q: 'Нашли брак после того, как я ушёл',
    a: 'Если брак допущен по вашей вине и подтверждён, вопрос решается по условиям договора. Именно поэтому расчёт при неотработанном сроке проводится частями — до окончания проверки.',
  },
  {
    q: 'Где посмотреть свой баланс',
    a: 'В разделе «Финансы» — там все начисления, удержания и итоговая сумма к выплате.',
  },
];

/**
 * Правила завершения сотрудничества для исполнителей на ГПХ.
 *
 * ВАЖНО про формулировки. Исполнители работают по гражданско-правовым договорам, а не
 * по трудовым. Поэтому здесь намеренно не используются слова «увольнение», «отработка»,
 * «зарплата» в трудоправовом смысле: такие термины — прямой признак подмены трудовых
 * отношений, за что бизнесу грозит переквалификация договоров и доначисления.
 * Говорим о завершении сотрудничества, сроке предупреждения и расчёте по договору.
 */
const TerminationGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Завершение сотрудничества</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Как правильно завершить работу и получить расчёт
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Предупредите о завершении работы за 14 дней и отработайте этот срок — тогда
                расчёт придёт полностью и в обычную дату. Порядок расчёта определяется
                договором, который вы подписали.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Обычные сроки выплат. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Обычные сроки выплат</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Пока вы работаете, расчёт приходит по этому графику
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {payoutDates.map((d) => (
              <Card key={d.title} className="border-border shadow-none">
                <CardContent className="space-y-2 py-5">
                  <Icon name={d.icon} size={26} className="text-primary" />
                  <p className="font-bold">{d.title}</p>
                  <p className="text-sm text-muted-foreground">{d.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Порядок завершения. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Как завершить работу правильно</h2>
          {steps.map((step) => (
            <Card key={step.num} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {step.num}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="text-base font-bold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </div>
                {step.image && (
                  <img
                    src={step.image}
                    alt=""
                    className="h-32 w-full rounded-lg object-cover sm:h-28 sm:w-40"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Особый порядок расчёта. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Если срок предупреждения не соблюдён</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Особый порядок расчёта применяется в двух случаях
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {specialCases.map((c) => (
              <Card key={c.title} className="border-amber-300 bg-amber-50 shadow-none">
                <CardContent className="space-y-2 py-5">
                  <Icon name={c.icon} size={26} className="text-amber-600" />
                  <p className="font-bold text-amber-900">{c.title}</p>
                  <p className="text-sm text-muted-foreground">{c.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border shadow-none">
            <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="text-base font-bold">Порядок расчёта в этом случае</h3>
                <p className="text-sm text-muted-foreground">
                  Расчёт проводится по частям: каждые 7 дней перечисляется 10% от накопленной
                  суммы, начиная с даты, когда истёк бы срок предупреждения. Сумма не
                  уменьшается — меняется только график перечисления.
                </p>
                <p className="text-sm text-muted-foreground">
                  Такой порядок связан с проверкой качества: изделие доезжает до покупателя
                  не сразу, и претензии по браку приходят с задержкой. Частичные выплаты
                  позволяют завершить проверку и рассчитаться корректно.
                </p>
              </div>
              <img
                src={IMG_PARTS}
                alt=""
                className="h-32 w-full rounded-lg object-cover sm:h-28 sm:w-40"
              />
            </CardContent>
          </Card>
        </div>

        {/* Последствия внезапного ухода: это не абстрактное неудобство, а конкретные
            санкции маркетплейсов за просроченную отгрузку. */}
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="flex items-start gap-3 py-5">
            <Icon name="Clock" size={26} className="mt-0.5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-destructive">
                Почему внезапный уход — это срыв сроков
              </h3>
              <p className="text-sm text-destructive">
                Взятые заказы уже стоят в плане отгрузки с конкретными датами. Если
                исполнитель перестаёт выходить без предупреждения, изделия не успевают
                изготовить в срок, и отгрузка на маркетплейс срывается.
              </p>
              <p className="text-sm text-destructive">
                За несвоевременную отгрузку маркетплейс начисляет заказчику штрафы, а при
                систематических просрочках — ограничивает продажи. Две недели
                предупреждения нужны именно для того, чтобы передать заказы другому
                исполнителю и не сорвать поставку.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Доступ в систему. */}
        <Card className="border-border shadow-none">
          <CardContent className="flex items-start gap-3 py-5">
            <Icon name="LockKeyhole" size={26} className="mt-0.5 shrink-0 text-primary" />
            <div className="space-y-1">
              <h3 className="text-base font-bold">Доступ в личный кабинет</h3>
              <p className="text-sm text-muted-foreground">
                Закрывается после уведомления администратора о завершении работы. Это
                техническая мера: доступ к заказам и складу остаётся только у действующих
                исполнителей. Все начисления сохраняются, справку по расчётам можно
                запросить у руководителя.
              </p>
              <button
                type="button"
                onClick={() => navigate('/crm/finance')}
                className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary"
              >
                <Icon name="ArrowRight" size={14} />
                Финансы — мой баланс
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Частые вопросы. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Частые вопросы</h2>
          <Card className="shadow-none">
            <CardContent className="divide-y p-0">
              {faq.map((f) => (
                <div key={f.q} className="space-y-1 px-4 py-3">
                  <p className="flex items-start gap-2 text-sm font-medium">
                    <Icon
                      name="CircleHelp"
                      size={15}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                    />
                    {f.q}
                  </p>
                  <p className="pl-6 text-sm text-muted-foreground">{f.a}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground">
          Порядок расчёта определяется условиями договора, заключённого с исполнителем.
          При расхождении этой страницы с текстом договора применяются условия договора.
        </p>
      </div>
    </CrmLayout>
  );
};

export default TerminationGuide;
