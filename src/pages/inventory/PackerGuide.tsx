import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Иллюстрации к шагам — упаковщица работает руками, картинка узнаётся быстрее текста. */
const IMG_BASKETS =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/a18125db-da98-4869-850c-b28dc999f2a1.jpg';
const IMG_HEIGHT =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/4c4ca7be-5b23-42c7-a02b-fe532f6057d2.jpg';
const IMG_TAPE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/29f9e997-7fa1-4320-9c99-2c615ba22e33.jpg';
const IMG_CONTAINERS =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/af23276c-62aa-4a52-92db-5f10c2a5e187.jpg';
const IMG_SORT =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/ad69feec-2cc4-4674-ac8c-aae88ea0f2d9.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

/** Порядок работы упаковщицы за смену. */
const packSteps: Step[] = [
  {
    num: 1,
    title: 'Опустошайте корзины по очереди',
    text: 'Берите корзину с тюлью у одной швеи и разбирайте её до конца, потом переходите к следующей. Не хватайте вещи из разных корзин вперемешку — так теряются изделия и не видно, чья работа.',
    image: IMG_BASKETS,
  },
  {
    num: 2,
    title: 'Проверьте изделие перед упаковкой',
    text: 'Каждую вещь осматриваем: высота, боковые швы, тесьма. Что именно смотреть — расписано ниже в блоке «Проверка товара». Нашли дефект — вещь не упаковываем.',
  },
  {
    num: 3,
    title: 'Подберите пакет по размеру',
    text: 'Пакет зависит от ткани и ширины изделия. Откройте таблицу, найдите ткань и ширину — на пересечении нужный размер пакета.',
    where: 'Подбор пакетов',
    path: '/crm/inventory/packaging-guide',
  },
  {
    num: 4,
    title: 'Яндекс упаковывайте отдельно',
    text: 'Заказы Яндекс Маркета не смешиваем с OZON и Wildberries. Они идут связкой: на терминале видно «Связка 1 из 2» — дождитесь все вещи заказа и упакуйте вместе. У каждой вещи связки СВОЙ ярлык с номером «1 из 2», «2 из 2» — сканируйте и печатайте каждую вещь отдельно. Если связки на заказе Яндекса нет, такой заказ идёт в общий контейнер.',
    image: IMG_SORT,
  },
  {
    num: 5,
    title: 'Отсканируйте и наклейте стикер',
    text: 'Работайте на терминале в цехе. Отсканируйте вещь, система покажет заказ и напечатает нужный стикер.',
  },
  {
    num: 6,
    title: 'Положите вещь в свой контейнер',
    text: 'После стикеровки терминал пишет, в какой контейнер класть. FBS и FBO не смешиваем, а FBO ещё и раскладываем по городам — склад назначения написан на стикере. Подробнее ниже, в блоке «Сортировка по контейнерам».',
    image: IMG_CONTAINERS,
  },
];

/** Как разложены контейнеры в цехе: по типу отгрузки, а FBO ещё и по городам. */
const containers = [
  {
    icon: 'Truck',
    title: 'FBS — свой контейнер',
    tone: 'border-emerald-300 bg-emerald-50',
    iconTone: 'text-emerald-600',
    titleTone: 'text-emerald-900',
    text: 'Заказы конкретных покупателей: OZON, Wildberries, Яндекс. Едут по своим ярлыкам отправления. Все вместе в контейнер FBS, по городам не делим.',
  },
  {
    icon: 'Warehouse',
    title: 'FBO — контейнер по городу',
    tone: 'border-sky-300 bg-sky-50',
    iconTone: 'text-sky-600',
    titleTone: 'text-sky-900',
    text: 'Товар едет на склад маркетплейса. На стикере написан кластер — склад назначения. Для каждого города свой контейнер: Хоругвино к Хоругвино, Казань к Казани.',
  },
];

/** Проверка ОТК: что смотрит упаковщица перед упаковкой тюля. */
const qualityChecks = [
  {
    icon: 'Ruler',
    title: 'Высота изделия',
    text: 'Проверка обязательная. Измерьте высоту готового изделия и сверьте с размером в заказе. Не сошлось — вещь не упаковываем.',
    image: IMG_HEIGHT,
  },
  {
    icon: 'GitCompareArrows',
    title: 'Боковые швы',
    text: 'Швы должны быть аккуратными и одинаковой ширины с обеих сторон — по норме, которую установил руководитель. Кривой или разной ширины шов — брак.',
  },
  {
    icon: 'Search',
    title: 'Тесьма',
    text: 'Тесьма пришита лицевой стороной, не на изнанку и не перевёрнута. Петли должны быть ближе к верхнему краю изделия. Шов по тесьме — ровный и аккуратный.',
    image: IMG_TAPE,
  },
];

/** Что делать с браком — по адресу, а не «отложить в сторону». */
const defectActions = [
  {
    icon: 'Undo2',
    title: 'Вернуть швее',
    tone: 'border-amber-300 bg-amber-50',
    iconTone: 'text-amber-600',
    titleTone: 'text-amber-900',
    text: 'Это переделка — швея исправит на своей машинке, полотно менять не нужно.',
    list: [
      'Кривые боковые швы или разной ширины',
      'Тесьма пришита на изнанку или перевёрнута',
      'Петли не у верхнего края',
      'Неаккуратная строчка, пропуски',
    ],
  },
  {
    icon: 'Scissors',
    title: 'Вернуть закройщику',
    tone: 'border-destructive/40 bg-destructive/5',
    iconTone: 'text-destructive',
    titleTone: 'text-destructive',
    text: 'Испорчено само полотно или размер — перешить нельзя, нужен перекрой.',
    list: [
      'Брак ткани',
      'Пятна на полотне',
      'Зацепки',
      'Стрелки (затяжки) на полотне',
      'Дырки',
      'Не сходится высота изделия',
      'Полотно перекошено или не хватает ткани',
    ],
  },
];

/** Частые вопросы упаковщицы. */
const faq = [
  {
    q: 'Пришла вещь Яндекса, а связки на ней нет',
    a: 'Значит заказ из одной вещи. Упаковывайте её и отправляйте в общий контейнер — отдельно ждать нечего.',
  },
  {
    q: 'В связке пришла только часть вещей',
    a: 'Стикеруйте те, что есть — каждую своим ярлыком. Терминал покажет, сколько осталось. Остальные вещи дошьют, и вы застикеруете их так же. Отправлять связку можно, только когда терминал напишет «связка собрана полностью».',
  },
  {
    q: 'Печатать один ярлык на всю связку?',
    a: 'Нет. У каждой вещи свой ярлык — на нём написано «1 из 2», «2 из 2». Отсканируйте каждую вещь отдельно и наклейте её собственный ярлык. Один ярлык на несколько пакетов клеить нельзя.',
  },
  {
    q: 'Где на стикере искать склад назначения',
    a: 'На стикере FBO написан кластер — это и есть склад, куда уедет товар. Он же показан на терминале после сканирования, в строке «Город назначения».',
  },
  {
    q: 'Куда класть, если города на стикере нет',
    a: 'Значит это заказ FBS — конкретному покупателю. Кладите в общий контейнер FBS, по городам такие заказы не делим.',
  },
  {
    q: 'Не знаю, какой пакет брать',
    a: 'Откройте «Подбор пакетов», найдите ткань и ширину изделия — на пересечении будет нужный размер. Высота на выбор пакета не влияет.',
  },
  {
    q: 'Нашла дефект — что делать с вещью',
    a: 'Не упаковывайте. Швейный брак возвращайте швее на переделку, проблемы с раскроем и высотой — закройщику на перекрой.',
  },
  {
    q: 'Можно взять вещи сразу из двух корзин',
    a: 'Нет. Корзину каждой швеи разбираем до конца, потом переходим к следующей — иначе теряются изделия.',
  },
];

/**
 * Инструкция для упаковщицы.
 *
 * Собрана из требований руководителя: порядок разбора корзин, раздельная упаковка
 * Яндекса и связки, а также проверка ОТК перед упаковкой. Дефект нельзя просто
 * отложить — вещь адресно возвращается швее или закройщику.
 */
const PackerGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Инструкция упаковщицы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Порядок работы за смену и проверка товара перед упаковкой
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Вещь с дефектом не упаковываем ни при каких условиях. Брак уходит обратно:
                швейный — швее на переделку, раскрой и высота — закройщику на перекрой.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ошибка «один ярлык на всю связку» дорогая: вещи уедут без своих ярлыков
            и потеряются в доставке, поэтому предупреждаем отдельным блоком. */}
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0 text-destructive" />
            <div>
              <p className="font-bold text-destructive">Связка Яндекса — ярлык на каждую вещь</p>
              <p className="text-sm text-destructive">
                Связка не значит «один ярлык на всё». У каждого пакета свой ярлык с номером
                «1 из 2», «2 из 2». Стикеруйте вещи по очереди, каждую своим ярлыком.
                После каждой терминал пишет, сколько ещё осталось — пока не станет
                «связка собрана полностью», пакеты не уносите.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Порядок работы за смену. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Порядок работы</h2>
          {packSteps.map((step) => (
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

        {/* Проверка ОТК — сердце инструкции. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Проверка товара</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Смотрим каждую вещь перед тем, как положить в пакет
            </p>
          </div>

          {qualityChecks.map((check) => (
            <Card key={check.title} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                <Icon
                  name={check.icon}
                  size={26}
                  className="shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-base font-bold">{check.title}</h3>
                  <p className="text-sm text-muted-foreground">{check.text}</p>
                </div>
                {check.image && (
                  <img
                    src={check.image}
                    alt=""
                    className="h-32 w-full rounded-lg object-cover sm:h-28 sm:w-40"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Сортировка по контейнерам — из-за ошибок здесь кладовщик не находит товар. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Сортировка по контейнерам</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Контейнеры в цехе разделены — товар должен лечь в свой
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {containers.map((c) => (
              <Card key={c.title} className={`${c.tone} shadow-none`}>
                <CardContent className="space-y-2 py-5">
                  <Icon name={c.icon} size={26} className={c.iconTone} />
                  <p className={`font-bold ${c.titleTone}`}>{c.title}</p>
                  <p className="text-sm text-muted-foreground">{c.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-destructive/40 bg-destructive/5 shadow-none">
            <CardContent className="flex items-start gap-3 py-4">
              <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-bold text-destructive">Не смешивайте контейнеры</p>
                <p className="text-sm text-destructive">
                  Если вещь FBO попадёт в чужой город или в контейнер FBS, кладовщик не
                  найдёт её при сборке поставки. Товар уедет не на тот склад или зависнет
                  в цехе. Терминал после стикеровки пишет нужный контейнер — смотрите на него.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Куда возвращать брак. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Нашли дефект — куда вернуть</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Вещь не откладываем в сторону, а сразу отдаём тому, кто исправит
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {defectActions.map((d) => (
              <Card key={d.title} className={`${d.tone} shadow-none`}>
                <CardContent className="space-y-2 py-5">
                  <Icon name={d.icon} size={26} className={d.iconTone} />
                  <p className={`font-bold ${d.titleTone}`}>{d.title}</p>
                  <p className="text-sm text-muted-foreground">{d.text}</p>
                  <ul className="space-y-1 pt-1">
                    {d.list.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <Icon
                          name="Check"
                          size={14}
                          className={`mt-1 shrink-0 ${d.iconTone}`}
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Частые вопросы. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Если что-то пошло не так</h2>
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

export default PackerGuide;
