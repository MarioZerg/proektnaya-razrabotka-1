import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

const IMG_MODELS =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/26f6f6de-604b-466a-a17a-1be86deb9a12.jpg';

/** Две схемы работы с маркетплейсом — главное различие для склада. */
const models = [
  {
    icon: 'Truck',
    title: 'FBS — со своего склада',
    tone: 'border-emerald-300 bg-emerald-50',
    iconTone: 'text-emerald-600',
    titleTone: 'text-emerald-900',
    text: 'Покупатель заказал — мы шьём и отправляем конкретному человеку. Ярлык отправления выдаёт маркетплейс, на нём адрес покупателя.',
    list: [
      'Заказ на конкретного покупателя',
      'Ярлык печатается по каждой вещи',
      'Все вещи в один контейнер FBS',
      'Города не различаем',
    ],
  },
  {
    icon: 'Warehouse',
    title: 'FBO — на склад маркетплейса',
    tone: 'border-sky-300 bg-sky-50',
    iconTone: 'text-sky-600',
    titleTone: 'text-sky-900',
    text: 'Товар едет партией на склад маркетплейса и лежит там, пока его не купят. Покупателя на момент отгрузки ещё нет.',
    list: [
      'Партия товара без покупателя',
      'На стикере кластер — склад назначения',
      'Свой контейнер на каждый город',
      'Собирается в поставку',
    ],
  },
];

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
}

/** Что делает склад по каждой схеме. */
const steps: Step[] = [
  {
    num: 1,
    title: 'Заказы приходят сами',
    text: 'Система забирает заказы с OZON, Wildberries и Яндекса по расписанию. Вручную ничего загружать не нужно.',
    where: 'Маркетплейсы → Заказы с маркетплейса',
    path: '/crm/marketplace/orders',
  },
  {
    num: 2,
    title: 'Цех шьёт и стикерует',
    text: 'Упаковщица стикерует вещь на терминале. Для FBS печатается ярлык отправления от маркетплейса, для FBO — наш стикер товара с кластером.',
  },
  {
    num: 3,
    title: 'Вещи раскладывают по контейнерам',
    text: 'FBS отдельно, FBO отдельно и по городам. Это делает упаковщица, но проверять раскладку приходится вам — из чужого контейнера вещь потом не найти.',
  },
  {
    num: 4,
    title: 'FBO собирается в поставку',
    text: 'Создайте поставку на нужный склад, соберите в неё товар по кластеру и отгрузите. Система подскажет, чего не хватает по заявке.',
    where: 'Отгрузки → Поставки в маркетплейс',
    path: '/crm/shipments/to-marketplace',
  },
  {
    num: 5,
    title: 'FBS уезжает по отправлениям',
    text: 'Здесь поставку собирать не нужно: каждая вещь уже со своим ярлыком, курьер забирает их по списку отправлений.',
  },
];

const faq = [
  {
    q: 'Как понять, FBO это или FBS',
    a: 'На терминале при сканировании видно тип заказа. У FBO дополнительно показан город назначения — у FBS его нет.',
  },
  {
    q: 'Что такое кластер',
    a: 'Это склад маркетплейса, куда уедет партия: Хоругвино, Казань, Екатеринбург. Кластер печатается на стикере FBO и определяет, в какой контейнер класть вещь.',
  },
  {
    q: 'Положил вещь FBO в контейнер другого города',
    a: 'Товар при этом правильный — система собирает поставку по артикулу, а он у одинаковых изделий совпадает. Ошибка в другом: покупатель получит вещь со стикером чужого города. Поэтому перед укладкой смотрите на стикер глазами.',
  },
  {
    q: 'Можно закрыть поставку не полностью',
    a: 'Да, но тогда недостающие позиции останутся в заявке. Лучше дособрать — иначе маркетплейс примет меньше товара, чем ждал.',
  },
];

/**
 * Инструкция по схемам работы с маркетплейсом для склада и менеджера.
 *
 * Главное, что должен понять человек: FBS — конкретному покупателю, FBO — партией на
 * склад маркетплейса. Из этого следует вся разница в раскладке по контейнерам и сборке.
 */
const FboFbsGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Работа с FBO и FBS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Две схемы отгрузки на маркетплейс и чем они различаются для склада
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                FBS едет конкретному покупателю, FBO — партией на склад маркетплейса.
                Поставка FBO собирается по артикулу, а он одинаковый у одинаковых изделий
                в разных городах. Система город не проверит — смотрите на стикер глазами.
              </p>
            </div>
          </CardContent>
        </Card>

        <img src={IMG_MODELS} alt="" className="h-44 w-full rounded-lg object-cover" />

        {/* Артикул одинаковый у разных кластеров — система тут не подстрахует,
            и это единственное место, где всё держится на внимательности человека. */}
        <Card className="border-amber-300 bg-amber-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Eye" size={22} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold text-amber-900">Смотрите на стикер глазами</p>
              <p className="text-sm text-amber-900">
                Поставка FBO собирается по артикулу товара. Вуаль 200×250 для Хоругвино и
                та же вуаль 200×250 для другого кластера — это один и тот же артикул,
                система их не различает. Город написан только на стикере: прочитайте
                название кластера и положите вещь в коробку этого города.
              </p>
              <p className="mt-2 text-sm text-amber-900">
                Перепутали — товар всё равно правильный, но покупатель получит вещь со
                стикером чужого города. Поэтому проверяем внимательно.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Сравнение схем. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {models.map((m) => (
            <Card key={m.title} className={`${m.tone} shadow-none`}>
              <CardContent className="space-y-2 py-5">
                <Icon name={m.icon} size={26} className={m.iconTone} />
                <p className={`font-bold ${m.titleTone}`}>{m.title}</p>
                <p className="text-sm text-muted-foreground">{m.text}</p>
                <ul className="space-y-1 pt-1">
                  {m.list.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <Icon name="Check" size={14} className={`mt-1 shrink-0 ${m.iconTone}`} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Порядок работы. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Как проходит заказ</h2>
          {steps.map((step) => (
            <Card key={step.num} className="border-border shadow-none">
              <CardContent className="flex gap-4 py-5">
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

export default FboFbsGuide;
