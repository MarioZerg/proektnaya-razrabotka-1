import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

const IMG_STACK =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/f12eb0fe-db24-478f-a73a-3bfc9b1330b3.jpg';
const IMG_MEASURE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/a1df2f33-58f3-4d61-8305-34d4e984e62b.jpg';
const IMG_HANGER =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/77df3558-ae19-4459-b138-5605e265b759.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

/** Порядок смены: от открытия до готовых изделий на вешалке. */
const steps: Step[] = [
  {
    num: 1,
    title: 'Откройте смену',
    text: 'Отсканируйте свой бейдж на терминале. Без открытой смены заказы в работу не выдаются.',
    where: 'Терминал → Смена',
  },
  {
    num: 2,
    title: 'Возьмите стек',
    text: 'Нажмите «Взять стек» — система выдаст 20 заказов на разрешённые вашему цеху материалы. Заказы подбираются автоматически, выбирать вручную не нужно.',
    where: 'Терминал → Заказы',
    image: IMG_STACK,
  },
  {
    num: 3,
    title: 'Проверьте ткань на брак',
    text: 'Осмотрите полотно перед раскроем. Если брак идёт с начала рулона и его больше 10 пог.м — не режьте: откройте рулон на терминале и нажмите «Бракованный рулон», затем сообщите руководителю.',
    where: 'Терминал → Рулоны',
  },
  {
    num: 4,
    title: 'Сверьте остаток открытого рулона',
    text: 'Если рулон остался открытым с прошлой смены, откройте карточку заказа и посмотрите остаток в карточке рулона. Цифра в программе должна сходиться с тем, что вы видите на рулоне. Не сходится — сообщите руководителю до начала раскроя.',
    where: 'Терминал → Рулоны',
  },
  {
    num: 5,
    title: 'Раскроите изделие',
    text: 'Режьте по правилам ниже: сначала ширина, потом высота. Размеры берите из карточки заказа, не по памяти.',
    image: IMG_MEASURE,
  },
  {
    num: 6,
    title: 'Повесьте на вешалку',
    text: 'Прикрепите бирку с номером заказа и размером, повесьте изделие на вешалку и укажите её номер в карточке заказа. По этому номеру швея найдёт крой.',
    where: 'Терминал → Заказы',
    image: IMG_HANGER,
  },
];

/** Порядок раскроя одного изделия — последовательность важна. */
const cuttingRules = [
  {
    num: 1,
    title: 'Ширина по кромке',
    text: 'Отмерьте ширину изделия по кромке и добавьте запас 5 см на боковые швы.',
    accent: '+5 см на боковые швы',
  },
  {
    num: 2,
    title: 'Надрез и разрыв',
    text: 'Сделайте надрез и разорвите ткань по нему — разрыв идёт строго по нити, край получается ровным.',
  },
  {
    num: 3,
    title: 'Высота от утяжелителя',
    text: 'Отмерьте высоту изделия от утяжелителя и добавьте запас 2 см на подгибку под тесьму.',
    accent: '+2 см на подгибку',
  },
  {
    num: 4,
    title: 'Надрез и отрыв',
    text: 'Сделайте надрез и оторвите ткань. Оставшийся кусок по высоте утилизируйте — оформите его как брак из рулона.',
  },
];

/** Правила остатка: главный источник потерь материала. */
const remainderRules = [
  {
    icon: 'Ruler',
    tone: 'amber',
    title: 'Осталось около 5 метров — перемерьте',
    text: 'Не дожидайтесь конца рулона. Перемерьте фактический остаток и сверьте с программой: так вы заранее увидите, хватит ли метража на следующее изделие.',
  },
  {
    icon: 'CircleAlert',
    tone: 'destructive',
    title: 'Меньше 2 метров оставаться не должно',
    text: 'Такой отрез уже не пойдёт ни на одно изделие — это прямые потери. Подбирайте заказы так, чтобы рулон уходил в ноль.',
  },
  {
    icon: 'PackageCheck',
    tone: 'default',
    title: 'Рулон закончился — закройте его',
    text: 'Откройте рулон на терминале и нажмите «Закрыть рулон». Если ткань кончилась раньше, чем показывала программа, укажите недостачу.',
  },
];

/** Частые вопросы. */
const faq = [
  {
    q: 'Почему в стеке 2 заказа вместо 20',
    a: 'Это связка Яндекс Маркета — заказ покупателя из нескольких вещей. Они едут по одному общему ярлыку, поэтому выдаются отдельно от общего стека: раскроите все вещи связки, повесьте на одну вешалку и передайте швее вместе.',
  },
  {
    q: 'Могу ли я выбрать заказы сам',
    a: 'Нет. Система выдаёт заказы по сроку отгрузки: сначала FBS, затем самые давние. Ручной выбор сломал бы очередь отгрузок.',
  },
  {
    q: 'Остаток в программе не сходится с рулоном',
    a: 'Не начинайте раскрой — сообщите руководителю. Расхождение означает, что в прошлую смену метраж списали неверно, и по цепочке ошибка уйдёт дальше.',
  },
  {
    q: 'Ткань закончилась на середине изделия',
    a: 'Закройте рулон с указанием недостачи и возьмите следующий. Недостача фиксируется и разбирается отдельно.',
  },
  {
    q: 'Нашёл брак в середине рулона',
    a: 'Оформите брак из рулона на терминале: укажите метраж и причину, наклейте стикер на кусок и отложите — кладовщик его заберёт.',
  },
];

const toneClass: Record<string, { card: string; icon: string; title: string }> = {
  amber: {
    card: 'border-amber-300 bg-amber-50',
    icon: 'text-amber-600',
    title: 'text-amber-900',
  },
  destructive: {
    card: 'border-destructive/40 bg-destructive/5',
    icon: 'text-destructive',
    title: 'text-destructive',
  },
  default: { card: 'border-border', icon: 'text-primary', title: '' },
};

/** Инструкция закройщика: как проходит смена и как правильно кроить. */
const CuttingGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Крой продукции</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Инструкция закройщика: порядок смены и правила раскроя
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Два главных правила</p>
              <p className="text-sm text-violet-900">
                Размеры берите из карточки заказа, а не по памяти. И следите за остатком
                рулона: меньше 2 метров оставаться не должно.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Порядок смены. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Порядок смены</h2>
          {steps.map((step) => (
            <Card key={step.num} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {step.num}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="text-base font-bold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                  {step.where && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon name="MapPin" size={13} />
                      {step.where}
                    </p>
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

        {/* Правила раскроя. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Правила раскроя изделия</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Порядок важен: сначала ширина, потом высота
            </p>
          </div>
          <Card className="shadow-none">
            <CardContent className="divide-y p-0">
              {cuttingRules.map((r) => (
                <div key={r.num} className="flex gap-3 px-4 py-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm font-bold">
                    {r.num}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-muted-foreground">{r.text}</p>
                    {r.accent && (
                      <p className="inline-block rounded bg-primary/10 px-2 py-0.5 text-sm font-bold text-primary">
                        {r.accent}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Остаток рулона. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Остаток рулона</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ткань в конце рулона оставаться не должна
            </p>
          </div>
          {remainderRules.map((r) => {
            const t = toneClass[r.tone];
            return (
              <Card key={r.title} className={`shadow-none ${t.card}`}>
                <CardContent className="flex items-start gap-3 py-5">
                  <Icon name={r.icon} size={26} className={`mt-0.5 shrink-0 ${t.icon}`} />
                  <div className="space-y-1">
                    <h3 className={`text-base font-bold ${t.title}`}>{r.title}</h3>
                    <p className="text-sm text-muted-foreground">{r.text}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Связки Яндекс Маркета. */}
        <Card className="border-sky-300 bg-sky-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-5">
            <Icon name="Layers" size={26} className="mt-0.5 shrink-0 text-sky-600" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-sky-900">Связки Яндекс Маркета</h3>
              <p className="text-sm text-sky-900">
                Обычный стек — 20 заказов. Исключение: если покупатель Яндекс Маркета
                заказал несколько вещей, система выдаст только эту связку — например,
                2 заказа вместо 20.
              </p>
              <p className="text-sm text-sky-900">
                Раскроите все вещи связки, повесьте на одну вешалку и отложите отдельно от
                одиночных заказов. Они едут по одному общему ярлыку: если вещи разъедутся
                по цеху, собрать заказ к отгрузке будет нечем.
              </p>
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

        <button
          type="button"
          onClick={() => navigate('/crm/inventory/defect-guide')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <Icon name="ArrowRight" size={14} />
          Работа с браком из цеха
        </button>
      </div>
    </CrmLayout>
  );
};

export default CuttingGuide;
