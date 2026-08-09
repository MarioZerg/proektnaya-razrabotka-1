import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

const IMG_PICKING =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/0beb7078-cb66-4525-9eb9-91bfd5e4e5fb.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

/** Путь вещи с полки в заказ. */
const steps: Step[] = [
  {
    num: 1,
    title: 'Система сама находит вещь под заказ',
    text: 'Когда приходит новый заказ, система проверяет полки: если такая вещь уже лежит готовая, шить заново не нужно — она резервируется под заказ автоматически.',
  },
  {
    num: 2,
    title: 'Работа появляется у вас',
    text: 'Отобранные вещи ждут вас в разделе «Товар к подбору». Кнопка на складе подсвечивается и показывает количество, а в меню есть счётчик — заходить и проверять не нужно.',
    where: 'Склад товара → Товар к подбору',
    path: '/crm/inventory/goods-picking',
    image: IMG_PICKING,
  },
  {
    num: 3,
    title: 'Найдите вещь по полке',
    text: 'В списке «Отобрано к подбору» видно, под какой заказ нужна вещь и на какой она полке. Возьмите её с полки.',
    where: 'Товар к подбору',
    path: '/crm/inventory/goods-picking',
  },
  {
    num: 4,
    title: 'Отсканируйте штрихкод хранения',
    text: 'Наведите сканер на стикер хранения на вещи. Так система убедится, что вы взяли именно ту вещь, а не похожую с соседней полки.',
  },
  {
    num: 5,
    title: 'Наклейте стикер отправления',
    text: 'После сканирования печатается ярлык маркетплейса. Наклейте его и положите вещь в контейнер — дальше она уезжает как обычный заказ.',
    where: 'Склад товара → Стикеровка с полок',
    path: '/crm/inventory/goods-warehouse',
  },
];

/** Откуда вообще берутся вещи на полках. */
const sources = [
  {
    icon: 'Undo2',
    title: 'Возвраты',
    text: 'Покупатель вернул целую вещь, вы осмотрели её и положили на полку. Она снова доступна для продажи.',
  },
  {
    icon: 'CircleX',
    title: 'Отмены',
    text: 'Клиент отменил заказ, когда вещь уже сшили. Упаковщица наклеила стикер хранения, вы положили на полку.',
  },
  {
    icon: 'PackagePlus',
    title: 'Излишки пошива',
    text: 'Сшили с запасом или заказ сорвался. Вещь лежит на складе и ждёт похожего заказа.',
  },
];

const faq = [
  {
    q: 'Почему вещь не подбирается под заказ',
    a: 'Товар считается доступным только когда лежит на полке. Если он принят, но не разложен, или отправлен в перепаковку — система его не предложит.',
  },
  {
    q: 'Отсканировал не ту вещь',
    a: 'Система не примет чужой штрихкод — она сверяет его с зарезервированной вещью. Возьмите ту, что указана в задании.',
  },
  {
    q: 'Вещи нет на полке, а в задании она есть',
    a: 'Скорее всего её переставили и не отметили. Проверьте соседние полки, потом сообщите администратору — он снимет резерв, и заказ уйдёт в пошив.',
  },
  {
    q: 'Зачем вообще подбирать со склада',
    a: 'Это экономит ткань и время: вместо того чтобы шить заново, отдаём готовую вещь, которая уже лежит. Заказ уходит покупателю быстрее.',
  },
];

/**
 * Инструкция по подбору товара со склада для кладовщика.
 *
 * Смысл процесса: не шить заново то, что уже лежит готовым. Система сама находит
 * подходящую вещь под новый заказ, кладовщику остаётся взять её с полки, отсканировать
 * и наклеить ярлык отправления.
 */
const PickingGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Подбор товара со склада</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Как готовая вещь с полки закрывает новый заказ
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Зачем это нужно</p>
              <p className="text-sm text-violet-900">
                Если подходящая вещь уже лежит на полке, шить её заново незачем. Система
                сама находит такую вещь под новый заказ — вы только берёте её с полки и
                стикеруете. Экономится ткань, время цеха и заказ уходит быстрее.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Порядок работы. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Как это происходит</h2>
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

        {/* Откуда вещи на полках. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Откуда берутся вещи на полках</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Три источника готового товара
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {sources.map((s) => (
              <Card key={s.title} className="border-border shadow-none">
                <CardContent className="space-y-2 py-5">
                  <Icon name={s.icon} size={26} className="text-primary" />
                  <p className="font-bold">{s.title}</p>
                  <p className="text-sm text-muted-foreground">{s.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
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

export default PickingGuide;
