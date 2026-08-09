import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';

/** Иллюстрации к шагам — договор подписывают редко, картинка помогает узнать этап. */
const IMG_DOC =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/3163800b-af45-4975-aab5-c57c9ad228e2.jpg';
const IMG_CODE =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/d2ca336b-a5c3-49fb-ad88-b86bc3f5236f.jpg';
const IMG_LOCK =
  'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/7ac2006b-c0e4-4f56-8e78-8101fc0f849c.jpg';

interface Step {
  num: number;
  title: string;
  text: string;
  where?: string;
  path?: string;
  image?: string;
}

/** Путь договора: от администратора до подписи сотрудника. */
const contractSteps: Step[] = [
  {
    num: 1,
    title: 'Администратор составляет договор',
    text: 'Трудовой договор, договор подряда или ГПХ — зависит от того, как вы оформлены. Администратор загружает готовый документ в систему и указывает, кому он адресован.',
    image: IMG_DOC,
  },
  {
    num: 2,
    title: 'Документ приходит вам',
    text: 'При следующем входе система сама покажет экран «Подпишите документы». Искать ничего не нужно — документ откроется сам.',
  },
  {
    num: 3,
    title: 'Прочитайте документ',
    text: 'Откройте и прочитайте текст целиком. Подписывать не глядя не нужно: если что-то непонятно или в документе ошибка — не подписывайте, сначала спросите у руководителя.',
  },
  {
    num: 4,
    title: 'Запросите код и подпишите',
    text: 'Нажмите кнопку запроса кода — он придёт в чат бота МЕГАТЮЛЬ в мессенджере MAX. Введите код в систему. Ввод кода и есть ваша подпись: она равнозначна собственноручной и фиксируется вместе с номером телефона и временем.',
    image: IMG_CODE,
  },
  {
    num: 5,
    title: 'Система откроется',
    text: 'Как только все документы подписаны, экран-заслонка исчезнет и вы сможете работать как обычно. Подписанные документы всегда доступны в разделе «Договоры».',
    where: 'Договоры',
    path: '/crm/contracts',
    image: IMG_LOCK,
  },
];

/** Какие документы приходят сотрудникам. */
const contractTypes = [
  {
    icon: 'Briefcase',
    title: 'Трудовой договор',
    text: 'Для сотрудников в штате. Оформляется при приёме на работу, содержит должность, условия труда и оплату.',
  },
  {
    icon: 'FileSignature',
    title: 'Договор подряда',
    text: 'На выполнение конкретного объёма работ. Оплата идёт за результат, а не за отработанное время.',
  },
  {
    icon: 'FileText',
    title: 'Договор ГПХ',
    text: 'Гражданско-правовой договор на оказание услуг. Заключается с исполнителями вне штата.',
  },
];

/** Частые вопросы по договорам. */
const faq = [
  {
    q: 'Система не пускает дальше экрана с документами',
    a: 'Так и задумано. Пока документ не подписан, работать в системе нельзя — ни на компьютере, ни в приложении. Подпишите документ, и доступ откроется сразу.',
  },
  {
    q: 'Код не приходит',
    a: 'Откройте чат с ботом МЕГАТЮЛЬ в мессенджере MAX — код приходит туда. Если чата нет, зайдите в систему через кнопку «Войти через MAX», бот появится в списке. Не помогает — обратитесь к администратору.',
  },
  {
    q: 'В документе ошибка — что делать',
    a: 'Не подписывайте. Сообщите администратору, он исправит и пришлёт новый документ. Подписанный документ изменить уже нельзя.',
  },
  {
    q: 'Можно подписать позже',
    a: 'Работать в системе до подписания не получится. Если нужно время прочитать — выйдите из системы и вернитесь, когда будете готовы.',
  },
  {
    q: 'Где посмотреть подписанные документы',
    a: 'В разделе «Договоры» — там все ваши документы с датами подписания. Они хранятся в системе, отдельно распечатывать и хранить не нужно.',
  },
  {
    q: 'Подпись кодом — это законно',
    a: 'Да. Это простая электронная подпись: система фиксирует ваш номер телефона, код из личного чата и точное время. Такая подпись равнозначна собственноручной.',
  },
];

/**
 * Инструкция по договорам для сотрудников.
 *
 * Главное, что нужно донести: пока документ не подписан, система не работает — это не
 * сбой, а намеренная блокировка. Люди обычно пугаются экрана-заслонки и звонят
 * администратору, хотя достаточно прочитать документ и ввести код из MAX.
 */
const ContractsGuide = () => {
  const navigate = useNavigate();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Что такое договоры</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Как документ приходит сотруднику и как его подписать
          </p>
        </div>

        <Card className="border-violet-300 bg-violet-50 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon name="Info" size={22} className="mt-0.5 shrink-0 text-violet-600" />
            <div>
              <p className="font-bold text-violet-900">Главное правило</p>
              <p className="text-sm text-violet-900">
                Пока документ не подписан, система работать не будет — вместо разделов вы
                увидите экран «Подпишите документы». Это не сбой: подпишите документ, и
                доступ откроется сразу.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Какие бывают документы. */}
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold">Какие документы приходят</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Зависит от того, как вы оформлены
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {contractTypes.map((t) => (
              <Card key={t.title} className="border-border shadow-none">
                <CardContent className="space-y-2 py-5">
                  <Icon name={t.icon} size={26} className="text-primary" />
                  <p className="font-bold">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Путь договора по шагам. */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">Как это происходит</h2>
          {contractSteps.map((step) => (
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
      </div>
    </CrmLayout>
  );
};

export default ContractsGuide;
