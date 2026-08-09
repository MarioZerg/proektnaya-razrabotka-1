import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Иллюстрации к шагам — брак разбирают руками, картинка узнаётся быстрее текста. */
const IMG_CONTAINER =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/b708aa0c-bd0b-4ad5-a977-a2ea8ba5285e.jpg';
const IMG_SCAN =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/bae0b3a2-5cb7-4e0b-a7ca-b04674b19238.jpg';
const IMG_DECIDE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/b2bdb0a3-32d4-4280-b030-0d3cf9e79806.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

/** Путь бракованного куска: из цеха на склад и дальше. */
const defectSteps: Step[] = [
  {
    num: 1,
    title: 'Брак оформляют в цехе — не вы',
    text: 'Закройщик, швея или упаковщица находят дефект, отмечают его на терминале и печатают стикер DF-000001. Стикер клеят прямо на бракованный кусок и складывают в контейнер. Метры при этом уже списаны с рулона.',
    image: IMG_CONTAINER,
  },
  {
    num: 2,
    title: 'Заберите контейнер из цеха',
    text: 'Периодически забирайте контейнер с браком и везите на склад. Пока стикер не отсканирован, кусок числится «в контейнере» — по системе видно, что реально доехало, а что потерялось по дороге.',
  },
  {
    num: 3,
    title: 'Отсканируйте каждый стикер',
    text: 'Откройте «Приём брака из цеха» и сканируйте стикеры подряд — меню заново открывать не нужно. По каждому куску видно: материал, метраж, причину, кто нашёл, из какого рулона и от какого поставщика.',
    where: 'Инвентаризация → Приём брака из цеха',
    path: '/crm/inventory/defect-receive',
    image: IMG_SCAN,
  },
  {
    num: 4,
    title: 'Крупные куски осмотрите тщательно',
    text: 'Куски от 2 пог.м система помечает жёлтым и считает отдельно вверху экрана. Такой отрез ещё может пойти в работу — осмотрите его внимательно, прежде чем отправлять в утиль.',
    where: 'Инвентаризация → Приём брака из цеха',
    path: '/crm/inventory/defect-receive',
  },
  {
    num: 5,
    title: 'Сверьте остаток',
    text: 'Когда контейнер разобран, в списке «Ждёт приёмки» должно быть пусто и появится надпись «Весь брак принят на склад». Если что-то осталось — кусок потерялся по дороге, ищите его в цехе.',
  },
  {
    num: 6,
    title: 'Отправьте в утиль',
    text: 'Отрезанные куски поставщик обратно не принимает — весь брак идёт на утилизацию. Метры уже списаны с рулона в цехе, оформлять ничего не нужно.',
    image: IMG_DECIDE,
  },
];

/** Что происходит с принятым браком и зачем его вообще сканировать. */
const outcomes = [
  {
    icon: 'Trash2',
    title: 'Всё идёт в утиль',
    tone: 'border-destructive/40 bg-destructive/5',
    iconTone: 'text-destructive',
    titleTone: 'text-destructive',
    text: 'Отрезанные куски поставщик обратно не принимает — ни ткань, ни тесьму. Метры списаны с рулона ещё в цехе, поэтому оформлять ничего не нужно: просто утилизируем.',
  },
  {
    icon: 'ChartColumn',
    title: 'Но статистика остаётся',
    tone: 'border-sky-300 bg-sky-50',
    iconTone: 'text-sky-600',
    titleTone: 'text-sky-900',
    text: 'Ради этого и сканируем. Система копит, какой брак и из какого рулона пришёл — эту выборку показывают поставщику как претензию по качеству партии.',
    where: 'Инвентаризация → Приём брака из цеха',
    path: '/crm/inventory/defect-receive',
  },
];

/** Кто какой брак находит — кладовщику полезно понимать, откуда что приехало. */
const sources = [
  {
    icon: 'Scissors',
    role: 'Закройщик',
    what: 'Брак полотна: затяжки, полосы, дырки, брак утяжелителя',
  },
  {
    icon: 'Shirt',
    role: 'Швея',
    what: 'Брак тесьмы: бракованные петли, заводской брак',
  },
  {
    icon: 'Package',
    role: 'Упаковщица',
    what: 'Брак упаковки: порван или грязный пакет, не клеится этикетка, брак печати',
  },
];

/** Частые вопросы кладовщика по браку. */
const faq = [
  {
    q: 'Система пишет «брак уже принят»',
    a: 'Этот стикер уже сканировали раньше. Дважды принимать один кусок не нужно — отложите его к остальному принятому браку.',
  },
  {
    q: 'Стикер не сканируется или порвался',
    a: 'Введите номер вручную в то же поле — он начинается с DF. Если номер не читается совсем, спросите в цехе, кто оформлял этот кусок.',
  },
  {
    q: 'В списке остался брак, а в контейнере пусто',
    a: 'Кусок не доехал до склада. Поищите в цехе: он числится оформленным, но физически не принят. Это и есть смысл сканирования — видно, что теряется.',
  },
  {
    q: 'Нужно ли списывать метры при приёмке',
    a: 'Нет. Метры списались с рулона ещё в цехе, когда сотрудник оформлял брак. Вы только подтверждаете, что кусок доехал.',
  },
  {
    q: 'Можно ли вернуть брак поставщику',
    a: 'Нет. Отрезанные куски поставщик обратно не принимает — всё идёт в утиль. Но накопленную статистику «какой брак из какого рулона» ему показывают как претензию по качеству партии.',
  },
  {
    q: 'Куда смотреть, если брака стало много',
    a: 'Внизу страницы приёмки откройте «Показать принятый брак за 3 месяца» — там видно рулоны и поставщиков. Ещё есть «Анализ брака» с разбивкой по сотрудникам.',
  },
];

/**
 * Инструкция кладовщика по работе с браком из цеха.
 *
 * Ключевая мысль, которую нужно донести: кладовщик брак НЕ оформляет и метры не списывает —
 * это делают в цехе. Его задача довезти куски до склада и отсканировать, чтобы было видно,
 * что реально доехало. Дальше — утилизация или возврат поставщику.
 */
const DefectGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Работа с браком из цеха</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Как забрать бракованный материал и принять его на склад
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Брак оформляют в цехе, а не вы. Метры списываются с рулона сразу при
                оформлении. Ваша задача — довезти куски до склада и отсканировать стикеры,
                чтобы было видно, что доехало, а что потерялось.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Шаги по порядку. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Порядок работы</h2>
          {defectSteps.map((step) => (
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

        {/* Что делать с принятым браком. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Что делать с принятым браком</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Куски не возвращаются — зато копится статистика по рулонам
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {outcomes.map((o) => (
              <Card key={o.title} className={`${o.tone} shadow-none`}>
                <CardContent className="space-y-2 py-5">
                  <Icon name={o.icon} size={26} className={o.iconTone} />
                  <p className={`font-bold ${o.titleTone}`}>{o.title}</p>
                  <p className="text-sm text-muted-foreground">{o.text}</p>
                  {o.path && (
                    <button
                      type="button"
                      onClick={() => navigate(o.path as string)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                    >
                      <Icon name="ArrowRight" size={14} />
                      {o.where}
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Откуда приезжает брак. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Откуда приезжает брак</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Кто что находит — видно на экране при сканировании
            </p>
          </div>

          <Card className="shadow-none">
            <CardContent className="divide-y p-0">
              {sources.map((s) => (
                <div key={s.role} className="flex items-start gap-3 px-4 py-3">
                  <Icon name={s.icon} size={18} className="mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.role}</p>
                    <p className="text-sm text-muted-foreground">{s.what}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
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

export default DefectGuide;
