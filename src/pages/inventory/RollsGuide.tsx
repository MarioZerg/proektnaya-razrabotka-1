import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Иллюстрации к шагам — инструкцию читают на бегу, картинка помогает узнать шаг. */
const IMG_DELIVERY =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/da0ce2fd-8404-474c-b8fd-4f32801fc88c.jpg';
const IMG_ROLLS =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/9cb10bec-286c-47a1-b973-3416b3f6cfbf.jpg';
const IMG_CLOSE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/db125b2c-bf24-4cd6-a29e-b1ce84d2d58a.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where: string;
  path?: string;
  image?: string;
}

/** Путь рулона: от машины поставщика до закрытия в цехе. */
const rollSteps: Step[] = [
  {
    num: 1,
    title: 'Приехала машина — оформите приёмку',
    text: 'Нажмите «Новая приёмка», выберите поставщика и добавьте материалы. Главное: в поле метража указывайте, сколько метров в ОДНОМ рулоне — как написано на самом рулоне, а рядом сколько рулонов пришло. Система сама посчитает общий метраж.',
    where: 'Отгрузки → Отгрузка от поставщика',
    path: '/crm/shipments/from-supplier',
    image: IMG_DELIVERY,
  },
  {
    num: 2,
    title: 'Отправьте на подтверждение',
    text: 'Нажмите «Отправить на подтверждение» — приёмка уйдёт администратору. Он проверит цены и подтвердит. Пока не подтвердил, рулонов в системе ещё нет.',
    where: 'Отгрузки → Отгрузка от поставщика',
    path: '/crm/shipments/from-supplier',
  },
  {
    num: 3,
    title: 'Наклейте стикеры на рулоны',
    text: 'После подтверждения система заведёт каждый рулон отдельно и даст ему свой штрихкод. Распечатайте стикеры и наклейте на рулоны — дальше вся работа идёт по сканированию этого штрихкода.',
    where: 'Инвентаризация → Рулоны',
    path: '/crm/inventory/rolls',
    image: IMG_ROLLS,
  },
  {
    num: 4,
    title: 'Передайте рулон в цех',
    text: 'Оформите отгрузку в цех: укажите цех, смену и рулоны. Рулон перейдёт в статус «В цехе», но работать с ним нельзя, пока смена не подтвердит приёмку на своём терминале.',
    where: 'Отгрузки → Отгрузка в цех',
    path: '/crm/shipments/to-workshop',
  },
  {
    num: 5,
    title: 'Материал расходуется сам',
    text: 'Ничего списывать вручную не нужно. Когда закройщик режет ткань под заказ, метры сами уходят с рулона. Остаток видно в списке рулонов: «Остаток: 45 из 120 пог.м».',
    where: 'Инвентаризация → Рулоны',
    path: '/crm/inventory/rolls',
  },
  {
    num: 6,
    title: 'Рулон закончился — закройте его',
    text: 'Когда на рулоне почти ничего не осталось, закройщик закрывает его на терминале в цехе и указывает недостачу, если ткани не хватило. Рулон уходит в «Завершённые».',
    where: 'Инвентаризация → Рулоны',
    path: '/crm/inventory/rolls',
    image: IMG_CLOSE,
  },
];

/** Куда ещё может уйти материал, кроме раскроя. */
const writeOffs = [
  {
    icon: 'TriangleAlert',
    title: 'Списание брака',
    tone: 'border-amber-300 bg-amber-50',
    iconTone: 'text-amber-600',
    titleTone: 'text-amber-900',
    text: 'Ткань испорчена: порвана, запачкана, заводской брак. Выберите рулон, укажите метры и обязательно напишите причину.',
    where: 'Отгрузки → Списание брака',
    path: '/crm/shipments/defect-writeoff',
  },
  {
    icon: 'Undo2',
    title: 'Возврат поставщику',
    tone: 'border-sky-300 bg-sky-50',
    iconTone: 'text-sky-600',
    titleTone: 'text-sky-900',
    text: 'Материал не подошёл или пришёл бракованным — оформите возврат. Метры спишутся с рулона, а поставщику уйдёт претензия.',
    where: 'Отгрузки → Возврат поставщику',
    path: '/crm/shipments/return-to-supplier',
  },
  {
    icon: 'Scissors',
    title: 'Раскрой под заказ',
    tone: 'border-emerald-300 bg-emerald-50',
    iconTone: 'text-emerald-600',
    titleTone: 'text-emerald-900',
    text: 'Обычный расход: закройщик берёт метры под заказ. Делать ничего не нужно — списывается автоматически.',
    where: 'Инвентаризация → Рулоны',
    path: '/crm/inventory/rolls',
  },
];

/** Частые вопросы — то, из-за чего кладовщики обычно звонят. */
const faq = [
  {
    q: 'Система не даёт закрыть рулон',
    a: 'На нём ещё слишком много ткани. Закрыть можно, когда осталось не больше 20 метров тюли или 80 метров тесьмы. В сообщении система пишет, сколько осталось и до какого остатка можно закрывать.',
  },
  {
    q: 'Что писать в поле «недостача» при закрытии',
    a: 'Сколько метров не хватило по факту. Например, по документам должно было остаться 5 метров, а рулон кончился — пишите 5. Если всё сошлось, оставьте ноль.',
  },
  {
    q: 'Передал рулон в цех, а с ним не работают',
    a: 'Смена ещё не подтвердила приёмку на терминале. Пока не подтвердит, рулон в цехе показывается серым и резать его нельзя.',
  },
  {
    q: 'Сколько метров писать при приёмке',
    a: 'Метраж ОДНОГО рулона — тот, что написан на самом рулоне. Рядом укажите, сколько таких рулонов приехало. Не пишите общий метраж всей партии.',
  },
  {
    q: 'Рулонов нет в системе после приёмки',
    a: 'Приёмку ещё не подтвердил администратор. Рулоны создаются только после подтверждения — тогда же появляются штрихкоды.',
  },
];

/**
 * Инструкция по рулонам для кладовщика.
 *
 * Путь материала разложен в том порядке, в каком кладовщик его проходит: от разгрузки
 * машины до закрытия рулона в цехе. Отдельно вынесены списания и частые вопросы —
 * именно на них люди обычно спотыкаются.
 */
const RollsGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Как работать с рулонами</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Путь материала от машины поставщика до закрытия рулона
          </p>
        </div>

        {/* Главная ошибка при приёмке — из-за неё метраж уезжает в разы. */}
        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                При приёмке указывайте метраж ОДНОГО рулона, а не всей партии. Рядом
                поставьте число рулонов — система перемножит сама. Если написать общий
                метраж, остатки на складе будут неверными.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Шаги по порядку. */}
        <div className="space-y-3">
          {rollSteps.map((step) => (
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

        {/* Куда уходит материал. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Куда уходит материал</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Три способа списать метры с рулона
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {writeOffs.map((w) => (
              <Card key={w.title} className={`${w.tone} shadow-none`}>
                <CardContent className="space-y-2 py-5">
                  <Icon name={w.icon} size={26} className={w.iconTone} />
                  <p className={`font-bold ${w.titleTone}`}>{w.title}</p>
                  <p className="text-sm text-muted-foreground">{w.text}</p>
                  <button
                    type="button"
                    onClick={() => navigate(w.path)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                  >
                    <Icon name="ArrowRight" size={14} />
                    {w.where}
                  </button>
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

export default RollsGuide;
