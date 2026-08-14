import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Кто отвечает за вещь в этом статусе. */
type Zone = 'warehouse' | 'production' | 'both';

const zoneLabel: Record<Zone, string> = {
  warehouse: 'Склад',
  production: 'Цех',
  both: 'Передача из рук в руки',
};

const zoneClass: Record<Zone, string> = {
  warehouse: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  production: 'bg-violet-100 text-violet-800 hover:bg-violet-100',
  both: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
};

interface StatusCard {
  /** Название статуса ровно как в списке склада. */
  name: string;
  zone: Zone;
  /** Что это значит простыми словами. */
  meaning: string;
  /** Как вещь сюда попадает — кто и что для этого сделал. */
  from: string[];
  /** Куда уходит дальше. */
  to: string[];
  /** Чего в этом статусе быть НЕ может — по этим признакам ловят ошибку. */
  never: string[];
}

/**
 * Все статусы склада в том порядке, в котором вещь их проходит.
 *
 * Формулировки сверены с тем, что система реально делает с вещью, а не с тем, как
 * статус называется. Кладовщик читает это, когда не понимает, почему вещь «не там».
 */
const statuses: StatusCard[] = [
  {
    name: 'На разборе с производства',
    zone: 'both',
    meaning:
      'Клиент отменил заказ, когда вещь уже сшили. Упаковщица наклеила складской стикер и передала её вам. Вещь физически у вас на руках, но полка ещё не выбрана.',
    from: ['Упаковщица застикеровала отменённый заказ складским стикером'],
    to: ['Вы сканируете стикер и кладёте на полку → «На хранении»'],
    never: [
      'Не может лежать на полке — полка выбирается как раз при переходе дальше',
      'Не может быть закреплена за заказом: заказ отменён, везти её некуда',
    ],
  },
  {
    name: 'Возврат с маркетплейса',
    zone: 'both',
    meaning:
      'Вещь приехала назад от покупателя, вы забрали её из пункта выдачи. Ещё не разобрана: непонятно, целая она или ей нужен цех.',
    from: ['Вы приняли возврат по номеру заказа'],
    to: [
      'Целая вещь → сразу на полку, «На хранении»',
      'Нужна перепаковка → в цех, «На проверке»',
    ],
    never: [
      'Не может лежать на полке: непроверенная вещь на полку не кладётся',
      'Не может попасть в подбор под заказ, пока её не осмотрели',
    ],
  },
  {
    name: 'На разборе с маркетплейса',
    zone: 'warehouse',
    meaning:
      'Вы забрали пачку возвратов из пункта выдачи и начали её разбирать. Каждую вещь предстоит распределить: целая — на полку, помятая — в цех к упаковщице.',
    from: ['Вы приняли партию возвратов и начали разбор'],
    to: [
      'Вещь целая → на полку, «На хранении»',
      'Нужна перепаковка → в цех, «На проверке»',
    ],
    never: [
      'Не может лежать на полке: пока вещь не разобрана, полка ей не назначается',
      'Не может попасть в подбор: непроверенную вещь покупателю не отправляют',
    ],
  },
  {
    name: 'На проверке',
    zone: 'production',
    meaning:
      'Вещь у упаковщицы в цехе: она осматривает её, при необходимости перепаковывает и клеит новый складской стикер.',
    from: ['Вы отправили возврат в цех на осмотр'],
    to: [
      'Упаковщица закончила → «Осмотрено», вещь ждёт вас',
      'Вещь испорчена → на утилизацию',
    ],
    never: [
      'Не может лежать на полке: вещи физически нет на складе, она в цехе',
      'Не может уйти в поставку прямо отсюда',
    ],
  },
  {
    name: 'Осмотрено',
    zone: 'both',
    meaning:
      'Упаковщица закончила осмотр и наклеила стикер хранения. Вещь лежит в цехе и ждёт, когда вы её заберёте.',
    from: ['Упаковщица завершила осмотр возврата'],
    to: ['Вы забрали её из цеха → «Забрано с производства» или сразу на полку'],
    never: ['Не может быть на полке: вещь ещё в цехе'],
  },
  {
    name: 'Забрано с производства',
    zone: 'both',
    meaning:
      'Вы забрали вещь из цеха, она у вас на руках, но на конкретную полку ещё не легла.',
    from: ['Вы забрали осмотренную вещь из цеха'],
    to: ['Вы отсканировали её на полку → «На хранении»'],
    never: ['Не может быть указана полка — она выбирается при переходе дальше'],
  },
  {
    name: 'На хранении',
    zone: 'warehouse',
    meaning:
      'Вещь лежит на конкретной полке и свободна. Это единственный статус, из которого система может сама подобрать её под новый заказ.',
    from: [
      'Вы положили на полку отмену из цеха',
      'Вы положили на полку проверенный возврат',
      'Излишек пошива приняли на склад',
      'Подбор отменили и вещь вернули на полку',
    ],
    to: [
      'Система нашла заказ на этот размер → «На сборке»',
      'Вещь испортилась → на утилизацию или «Утерян»',
    ],
    never: [
      'ВСЕГДА указана полка: вещь «на хранении» без полки — это ошибка, её никто не найдёт',
      'НИКОГДА не закреплена за заказом: как только заказ находится, статус меняется на «На сборке»',
      'Не бывает ярлыка отправления: он клеится позже, при сборке',
    ],
  },
  {
    name: 'На сборке',
    zone: 'warehouse',
    meaning:
      'Вещь снята с полки под конкретный заказ, вы наклеили на неё ярлык отправления. Осталось отсканировать её в поставку.',
    from: [
      'Система подобрала вещь с полки под новый заказ, вы её нашли и застикеровали',
    ],
    to: [
      'Вы отсканировали её в поставку → «На поставку»',
      'Заказ отменился → вещь возвращается на полку, «На хранении»',
    ],
    never: [
      'ВСЕГДА закреплена за заказом: без заказа собирать нечего',
      'ВСЕГДА с ярлыком отправления — он клеится при переходе в этот статус',
      'Не может считаться свободным остатком: под другой заказ её не подберут',
    ],
  },
  {
    name: 'На поставку',
    zone: 'warehouse',
    meaning:
      'Вещь сшита в цехе и застикерована либо снята с полки и добавлена в поставку. Лежит в контейнере и ждёт отгрузки.',
    from: [
      'Упаковщица застикеровала сшитую вещь на конвейере',
      'Вы отсканировали вещь с полки в поставку',
    ],
    to: ['Поставка уехала на маркетплейс → «Отгружен»'],
    never: [
      'ВСЕГДА с ярлыком отправления: без него вещь в поставку не принимается',
      'Не бывает даты отгрузки — она ставится при закрытии поставки',
    ],
  },
  {
    name: 'Зарезервирован',
    zone: 'warehouse',
    meaning:
      'Вещь отсканирована в поставку и закреплена за ней. Лежит и ждёт, когда поставка уедет на маркетплейс.',
    from: ['Вы отсканировали вещь в поставку — свою или в короб'],
    to: [
      'Поставка уехала → «Отгружен»',
      'Заказ отменили → вещь убирают из поставки и кладут на полку',
    ],
    never: [
      'ВСЕГДА лежит в какой-то поставке: сам по себе этот статус не появляется',
      'Не может быть подобрана под другой заказ: она уже занята',
      'Не бывает даты отгрузки — поставка ещё не уехала',
    ],
  },
  {
    name: 'Отгружен',
    zone: 'warehouse',
    meaning:
      'Вещь уехала на маркетплейс вместе с поставкой. Для склада она закрыта: ни подобрать, ни застикеровать её больше нельзя.',
    from: ['Поставку перевели в статус «Отгрузка»'],
    to: ['Дальше только возврат — и это будет уже новая история вещи'],
    never: [
      'ВСЕГДА стоит дата отгрузки',
      'Не может попасть в подбор или в новую поставку',
      'Стикер хранения на неё больше не печатается: вещи на складе нет',
    ],
  },
  {
    name: 'На утилизацию',
    zone: 'production',
    meaning: 'Вещь признана негодной и ждёт списания. Окончательно списывает администратор.',
    from: ['Брак или порча, обнаруженные при осмотре'],
    to: ['Администратор списал → «Утерян»'],
    never: ['Не может лежать на полке и не может попасть в подбор'],
  },
  {
    name: 'Утерян',
    zone: 'warehouse',
    meaning:
      'Вещь списана: потеряна, испорчена или утилизирована. Из оборота выбыла, в остатках не считается.',
    from: ['Списание с указанием причины', 'Утилизация, подтверждённая администратором'],
    to: ['Дальше никуда — это конец пути вещи'],
    never: ['Не участвует в подборе и не попадает в поставки'],
  },
];

/** Как система двигает статусы сама, без участия кладовщика. */
const automatic = [
  {
    icon: 'Wand2',
    title: 'Сама находит вещь под заказ',
    text: 'Пришёл новый заказ — система смотрит на полки. Если такой же товар лежит свободным, она закрепляет его за заказом и переводит в «На сборке». Шить заново не нужно, а у вас появляется работа по подбору.',
  },
  {
    icon: 'Ruler',
    title: 'Сравнивает по названию и размеру',
    text: 'Подходящей считается вещь с тем же названием и размером — «Лен 300x245». Внутренние коды товара не сверяются: одинаковая вещь считается одинаковой, даже если пришла из разных источников.',
  },
  {
    icon: 'Undo2',
    title: 'Возвращает вещь на полку, если заказ сорвался',
    text: 'Заказ отменили или он уже уехал — система снимает закрепление и возвращает вещь в свободный остаток. Она сразу закроет собой следующий такой же заказ.',
  },
  {
    icon: 'ShieldCheck',
    title: 'Не даёт выдать две вещи на один заказ',
    text: 'Если заказ уже закрыт застикерованной вещью, вторую под него система не выдаст. Сканер ответит, что товар не нужен в подбор — это защита, а не ошибка.',
  },
  {
    icon: 'Truck',
    title: 'Закрывает вещи при отгрузке поставки',
    text: 'Когда поставка переходит в «Отгрузка», все вещи внутри разом становятся «Отгружен» и получают дату отгрузки. Руками этого делать не нужно.',
  },
];

/** Быстрая проверка «где искать вещь». */
const whereIsIt = [
  { status: 'На хранении', where: 'На полке, указанной в карточке вещи' },
  { status: 'На сборке', where: 'Вы уже сняли её с полки — она у вас на руках или в контейнере' },
  { status: 'На поставку', where: 'В контейнере поставки, ждёт отгрузки' },
  { status: 'На проверке', where: 'В цехе у упаковщицы' },
  { status: 'Осмотрено', where: 'В цехе, готова к тому, чтобы вы её забрали' },
  { status: 'Возврат с маркетплейса', where: 'У вас на руках, ещё не разобрана' },
  { status: 'На разборе с маркетплейса', where: 'У вас на руках, разбираете пачку возвратов' },
  { status: 'Зарезервирован', where: 'В поставке, ждёт отгрузки' },
  { status: 'Отгружен', where: 'Уехала на маркетплейс, на складе её нет' },
];

const faq = [
  {
    q: 'Вещь «На хранении», но в подбор не попадает',
    a: 'Проверьте полку. Если полка не указана, система считает вещь неразложенной и не предлагает её. Также вещь не подберётся, если она числится за каким-то заказом — тогда статус должен быть «На сборке», а не «На хранении».',
  },
  {
    q: 'Сканер говорит «товар не нужен в подбор», хотя такой размер в поставке есть',
    a: 'Значит, заказ на этот размер уже закрыт другой вещью — она застикерована и ждёт отгрузки. Работа сделана, второй товар на то же отправление отправлять нельзя.',
  },
  {
    q: 'Почему вещь вернулась из «На сборке» обратно на полку',
    a: 'Заказ отменился или маркетплейс уже принял отправление. Ярлык на него больше не выдаётся, поэтому система освободила вещь — она снова свободный остаток.',
  },
  {
    q: 'Можно ли поменять статус вручную',
    a: 'Нет, и это правильно. Статус меняется от действия: положили на полку, отсканировали, застикеровали. Если статус кажется неверным, ищите пропущенное действие, а не способ его исправить.',
  },
  {
    q: 'Чем «На сборке» отличается от «На поставку»',
    a: '«На сборке» — вещь снята с полки и застикерована, но в поставку ещё не отсканирована. «На поставку» — уже отсканирована и лежит в контейнере. Разница в одном сканировании.',
  },
  {
    q: 'Вещь «Отгружен», а покупатель её не получил',
    a: 'Для склада «Отгружен» значит только одно: уехала с нашей поставкой. Что дальше происходит у маркетплейса, склад не отслеживает. Вернётся — примете как возврат.',
  },
];

/**
 * Инструкция «Назначение статусов» для кладовщиков.
 *
 * Отвечает на три вопроса по каждому статусу: что он означает, откуда вещь в него
 * попадает и чего в нём быть НЕ может. Последнее — главное: по невозможным сочетаниям
 * кладовщик сам находит ошибку, не гадая, почему вещь «не там».
 */
const StatusesGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Назначение статусов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Какие вещи попадают в какой статус и как система двигает их сама
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Статус нельзя выставить руками — он меняется сам, от вашего действия.
                Положили вещь на полку, отсканировали, наклеили ярлык. Если статус кажется
                неправильным, значит пропущено действие: ищите его, а не способ исправить
                статус.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Кто отвечает за вещь. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Чья это работа</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              У каждого статуса есть хозяин — по цветной метке видно, кто отвечает за вещь
              прямо сейчас
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="border-emerald-300 bg-emerald-50 shadow-none">
              <CardContent className="space-y-1 py-4">
                <Icon name="Warehouse" size={22} className="text-emerald-700" />
                <p className="font-bold text-emerald-900">Склад</p>
                <p className="text-sm text-emerald-900">
                  Вещь у вас: на полке, в сборке или в поставке
                </p>
              </CardContent>
            </Card>
            <Card className="border-violet-300 bg-violet-50 shadow-none">
              <CardContent className="space-y-1 py-4">
                <Icon name="Factory" size={22} className="text-violet-700" />
                <p className="font-bold text-violet-900">Цех</p>
                <p className="text-sm text-violet-900">
                  Вещь на производстве, ждать её обратно
                </p>
              </CardContent>
            </Card>
            <Card className="border-amber-300 bg-amber-50 shadow-none">
              <CardContent className="space-y-1 py-4">
                <Icon name="ArrowLeftRight" size={22} className="text-amber-700" />
                <p className="font-bold text-amber-900">Передача</p>
                <p className="text-sm text-amber-900">
                  Момент передачи из рук в руки — тут вещи чаще всего и теряются
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Разбор каждого статуса. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Все статусы по порядку</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              В том порядке, в котором вещь их проходит
            </p>
          </div>

          {statuses.map((s) => (
            <Card key={s.name} className="border-border shadow-none">
              <CardContent className="space-y-3 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">{s.name}</h3>
                  <Badge className={zoneClass[s.zone]}>{zoneLabel[s.zone]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{s.meaning}</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Icon name="LogIn" size={15} className="text-primary" />
                      Как сюда попадает
                    </p>
                    <ul className="space-y-1">
                      {s.from.map((f) => (
                        <li key={f} className="flex gap-1.5 text-sm text-muted-foreground">
                          <span className="text-primary">•</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Icon name="LogOut" size={15} className="text-primary" />
                      Куда уходит дальше
                    </p>
                    <ul className="space-y-1">
                      {s.to.map((t) => (
                        <li key={t} className="flex gap-1.5 text-sm text-muted-foreground">
                          <span className="text-primary">•</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Невозможные сочетания — по ним кладовщик ловит ошибку. */}
                <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                    <Icon name="Ban" size={15} />
                    Чего здесь быть не может
                  </p>
                  <ul className="space-y-1">
                    {s.never.map((n) => (
                      <li key={n} className="flex gap-1.5 text-sm text-muted-foreground">
                        <span className="text-destructive">•</span>
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Что система делает без кладовщика. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Что система делает сама</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Эти переходы происходят без вас — знать о них нужно, чтобы не искать причину
              там, где её нет
            </p>
          </div>
          <Card className="shadow-none">
            <CardContent className="divide-y p-0">
              {automatic.map((a) => (
                <div key={a.title} className="flex items-start gap-3 px-4 py-3">
                  <Icon name={a.icon} size={20} className="mt-0.5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="text-sm text-muted-foreground">{a.text}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Шпаргалка «где искать вещь». */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Где физически искать вещь</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Шпаргалка на случай, когда вещь нужно найти прямо сейчас
            </p>
          </div>
          <Card className="shadow-none">
            <CardContent className="divide-y p-0">
              {whereIsIt.map((w) => (
                <div
                  key={w.status}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <p className="w-full shrink-0 text-sm font-semibold sm:w-56">{w.status}</p>
                  <p className="text-sm text-muted-foreground">{w.where}</p>
                </div>
              ))}
            </CardContent>
          </Card>
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

        <Card className="border-border shadow-none">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">Посмотреть статусы на живом складе</p>
              <p className="text-sm text-muted-foreground">
                В списке товара статус каждой вещи виден в отдельной колонке
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/crm/inventory/goods-warehouse')}
              className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Icon name="ArrowRight" size={16} />
              Склад товара
            </button>
          </CardContent>
        </Card>
      </div>
    </CrmLayout>
  );
};

export default StatusesGuide;
