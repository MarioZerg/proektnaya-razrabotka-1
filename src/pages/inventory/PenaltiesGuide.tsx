import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

const IMG_LATE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/ce113383-2c7e-4def-9596-c8cff97dfa83.jpg';

/** Автоматические удержания: система начисляет их сама, без участия человека. */
const autoPenalties = [
  {
    icon: 'Clock',
    title: 'Опоздание на смену',
    text: 'Смена открыта позже начала по графику. Система считает опоздание от времени, указанного в графике вашего цеха, и показывает, на сколько именно вы опоздали.',
    note: 'Если смену за вас открыл администратор — удержания нет: система не знает, когда вы пришли на самом деле.',
  },
  {
    icon: 'DoorOpen',
    title: 'Незакрытая смена',
    text: 'Смену забыли закрыть, и ночью её закрыла система. Открытая смена продолжает считать рабочее время, поэтому закрывать её нужно самому.',
  },
  {
    icon: 'PackageX',
    title: 'Незакрытая смена с заказами',
    text: 'Смена не закрыта, и в работе остались незавершённые заказы. Удержание больше обычного: заказы зависли, и никто не знает, что с ними.',
  },
];

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

const steps: Step[] = [
  {
    num: 1,
    title: 'Система фиксирует нарушение',
    text: 'Опоздание — в момент открытия смены. Незакрытая смена — ночью, когда система закрывает её сама.',
    image: IMG_LATE,
  },
  {
    num: 2,
    title: 'Удержание появляется в расчётах',
    text: 'Оно сразу видно в разделе «Финансы»: за что, когда и на какую сумму. Ничего не начисляется задним числом и втайне.',
    where: 'Финансы',
    path: '/crm/finance',
  },
  {
    num: 3,
    title: 'Сумма вычитается из зарплаты',
    text: 'Удержание уменьшает начисление за период. Итоговую сумму к выплате видно там же, в «Финансах».',
    where: 'Финансы',
    path: '/crm/finance',
  },
  {
    num: 4,
    title: 'Есть вопросы — обратитесь к руководителю',
    text: 'Если считаете удержание ошибочным, обратитесь к руководителю. Он проверит и при необходимости отменит.',
  },
];

const faq = [
  {
    q: 'Где посмотреть свои удержания',
    a: 'В разделе «Финансы» — там все начисления и удержания с датами и причинами. Видно, из чего сложилась сумма за период.',
  },
  {
    q: 'Удержание начислено ошибочно',
    a: 'Обратитесь к руководителю. Он посмотрит запись по смене и при необходимости отменит удержание.',
  },
  {
    q: 'Забыл закрыть смену — что теперь',
    a: 'Ночью система закроет её сама и начислит удержание. Закрывайте смену перед уходом — это одна кнопка на терминале.',
  },
  {
    q: 'Смену открыл администратор — будет ли штраф',
    a: 'Нет. Когда смену открывает администратор, система не знает фактическое время прихода, поэтому за опоздание не удерживает.',
  },
  {
    q: 'Размер удержания одинаковый для всех',
    a: 'Суммы задаются настройками цеха, поэтому могут различаться. Точную сумму по каждому случаю видно в «Финансах».',
  },
  {
    q: 'Бывают ли удержания за брак',
    a: 'Автоматических — нет. Брак фиксируется поимённо и виден в статистике, но удержание руководитель назначает вручную, разобравшись в причине.',
  },
];

/**
 * Инструкция по удержаниям для сотрудников.
 *
 * Задача — снять ощущение произвола: показать, что удержания начисляются автоматически
 * по понятным правилам, всегда видны в «Финансах» и их можно оспорить у руководителя.
 */
const PenaltiesGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Штрафы и удержания</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            За что начисляются, где посмотреть и что делать при несогласии
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Удержания начисляются автоматически и только за нарушения работы со сменой.
                Каждое видно в разделе «Финансы» с причиной и суммой — скрытых удержаний
                нет. Считаете удержание ошибочным — обратитесь к руководителю.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* За что удерживают. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">За что бывают удержания</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Всё связано со сменой — открыл вовремя, закрыл за собой
            </p>
          </div>

          {autoPenalties.map((p) => (
            <Card key={p.title} className="border-amber-300 bg-amber-50 shadow-none">
              <CardContent className="flex gap-3 py-5">
                <Icon name={p.icon} size={26} className="shrink-0 text-amber-600" />
                <div className="min-w-0 space-y-1">
                  <p className="font-bold text-amber-900">{p.title}</p>
                  <p className="text-sm text-muted-foreground">{p.text}</p>
                  {p.note && (
                    <p className="rounded bg-background/60 px-2 py-1.5 text-sm text-amber-900">
                      {p.note}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Как это работает. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Как это работает</h2>
          {steps.map((step) => (
            <Card key={step.num} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {step.num}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="text-base font-bold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                  {step.path && (
                    <button
                      type="button"
                      onClick={() => navigate(step.path as string)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                    >
                      <Icon name="ArrowRight" size={14} />
                      {step.where}
                    </button>
                  )}
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
      </div>
    </CrmLayout>
  );
};

export default PenaltiesGuide;
