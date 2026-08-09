import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Иллюстрации к шагам — чтобы инструкция читалась глазами, а не только текстом. */
const IMG_SCAN =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/fd3efb63-5c36-46ba-85f8-d276c5a68c79.jpg';
const IMG_SHELF =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/fbc2f968-d96c-4b2a-8734-f34a3c64869a.jpg';
const IMG_SORT =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/8d31e6ca-9ea5-4c46-9a96-b8f789aee849.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where: string;
  path?: string;
  image?: string;
}

/** Путь возврата с пункта выдачи до полки — по шагам, в том порядке, как делает кладовщик. */
const returnSteps: Step[] = [
  {
    num: 1,
    title: 'Возьмите код для пункта выдачи',
    text: 'Без штрихкода продавца возвраты на ПВЗ не отдадут. Откройте раздел, нажмите на плитку нужного маркетплейса — код развернётся на весь экран, покажите его приёмщику. Код OZON меняется каждый день: если написано «Код устарел», нажмите «Обновить код».',
    where: 'Отгрузки → Коды для ПВЗ',
    path: '/crm/shipments/return-codes',
    image: IMG_SCAN,
  },
  {
    num: 2,
    title: 'Заберите коробки на пункте выдачи',
    text: 'Пока сотрудник ПВЗ сканирует коробки, в разделе «Коды для ПВЗ» можно нажать «Следить за приёмкой» — на экране будет видно, сколько мест уже принято и сколько осталось. Пересчитывать вручную не нужно.',
    where: 'Отгрузки → Коды для ПВЗ',
    path: '/crm/shipments/return-codes',
  },
  {
    num: 3,
    title: 'Привезли на склад — отсканируйте каждую вещь',
    text: 'Откройте «Получение возвратов». Вверху страницы поле для сканирования: наведите сканер на стикер возврата на коробке. Система покажет, что это за товар, размеры и причину возврата.',
    where: 'Отгрузки → Получение возвратов',
    path: '/crm/shipments/receive-returns',
    image: IMG_SORT,
  },
  {
    num: 4,
    title: 'Осмотрите вещь и выберите, куда её',
    text: 'После сканирования появятся три кнопки. Если вещь целая и осмотр не нужен — сразу выберите полку в списке над кнопками и нажмите «Сразу на полку»: товар мгновенно станет доступен для заказов, шаг 5 пропускается.',
    where: 'Отгрузки → Получение возвратов',
    path: '/crm/shipments/receive-returns',
  },
  {
    num: 5,
    title: 'Разложите по полкам',
    text: 'Нужен только если полку не выбрали сразу. Такие вещи ждут размещения: нажмите «Разложить по полкам», отсканируйте стикер хранения и укажите полку. После этого товар считается проверенным и попадает в подбор заказов.',
    where: 'Склад → Товары на складе',
    path: '/crm/inventory/goods-warehouse',
    image: IMG_SHELF,
  },
];

/** Три решения по вещи после осмотра — главный выбор кладовщика. */
const decisions = [
  {
    icon: 'PackageCheck',
    title: 'На полку',
    tone: 'border-emerald-300 bg-emerald-50',
    iconTone: 'text-emerald-600',
    titleTone: 'text-emerald-900',
    text: 'Вещь целая, упаковка в порядке. Выберите полку в списке выше — вещь ляжет на неё сразу. Не выбрали — встанет в очередь на укладку.',
  },
  {
    icon: 'Wrench',
    title: 'На перепаковку',
    tone: 'border-amber-300 bg-amber-50',
    iconTone: 'text-amber-600',
    titleTone: 'text-amber-900',
    text: 'Вещь годная, но упаковка помята или вскрыта. Уходит в цех — упаковщик сразу увидит её у себя на терминале.',
  },
  {
    icon: 'Trash2',
    title: 'Утилизировать',
    tone: 'border-destructive/40 bg-destructive/5',
    iconTone: 'text-destructive',
    titleTone: 'text-destructive',
    text: 'Вещь испорчена и продать её нельзя. Обязательно опишите, что именно не так — это увидит руководитель.',
  },
];

/** Частые вопросы: то, из-за чего кладовщики обычно останавливаются и звонят. */
const faq = [
  {
    q: 'Отсканировал, а система пишет «заявка не одобрена»',
    a: 'Значит администратор ещё не одобрил этот возврат. Отложите коробку и скажите ему — как только одобрит, вещь отсканируется.',
  },
  {
    q: 'Вещь привезли, но она ещё не на полке. Её могут продать?',
    a: 'Нет. Пока вещь не лежит на полке, она считается непроверенной и в подбор заказов не попадает. Это защита от продажи брака.',
  },
  {
    q: 'Код на ПВЗ не подошёл',
    a: 'Код OZON меняется каждый день. Откройте «Коды для ПВЗ» и нажмите «Обновить код» — получите свежий прямо на месте.',
  },
  {
    q: 'Сканер не находит возврат по стикеру',
    a: 'Попробуйте ввести номер отправления вручную в то же поле. Если не находится — возврат ещё не пришёл с маркетплейса, сообщите администратору.',
  },
];

/**
 * Инструкция по складу для кладовщика.
 *
 * Человек на складе работает руками и с телефоном, ему некогда разбираться в интерфейсе.
 * Поэтому здесь путь возврата разложен по шагам ровно в том порядке, в каком он его
 * проходит, с картинками и прямыми ссылками на нужные разделы.
 */
const WarehouseGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Как принимать возвраты</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Путь возврата от пункта выдачи до полки — по шагам
          </p>
        </div>

        {/* Короткая памятка сверху: главное правило, из-за которого чаще всего ошибаются. */}
        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Товар считается проверенным только когда лежит на полке. Пока он просто
                привезён на склад — продать его нельзя, система не отдаст его в заказы.
                Целую вещь можно положить на полку сразу при осмотре, тогда она станет
                доступна для заказов немедленно.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Шаги по порядку. */}
        <div className="space-y-3">
          {returnSteps.map((step) => (
            <Card key={step.num} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {step.num}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="text-base font-bold">{step.title}</h2>
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

        {/* Три кнопки выбора — самое важное место, выносим отдельно и крупно. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Три решения по вещи</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Это те самые кнопки, которые появляются после сканирования
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {decisions.map((d) => (
              <Card key={d.title} className={`${d.tone} shadow-none`}>
                <CardContent className="space-y-2 py-5">
                  <Icon name={d.icon} size={26} className={d.iconTone} />
                  <p className={`font-bold ${d.titleTone}`}>{d.title}</p>
                  <p className="text-sm text-muted-foreground">{d.text}</p>
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

export default WarehouseGuide;
