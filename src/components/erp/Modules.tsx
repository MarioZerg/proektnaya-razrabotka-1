import { useState } from 'react';
import Icon from '@/components/ui/icon';

const modules = [
  {
    id: 'warehouse',
    tab: 'Склад',
    icon: 'Package',
    title: 'Складской учёт без пересортицы',
    text: 'Онлайн-остатки по всем точкам, адресное хранение, приёмка и инвентаризация со сканера. Система сама подскажет, что и когда закупить.',
    points: ['Остатки в реальном времени', 'Автозаказ поставщикам', 'Партийный и серийный учёт'],
  },
  {
    id: 'finance',
    tab: 'Финансы',
    icon: 'Wallet',
    title: 'Финансы под полным контролем',
    text: 'Управленческий учёт, платёжный календарь и прогноз кассовых разрывов. Видите прибыль по каждому направлению без ручных сверок.',
    points: ['Платёжный календарь', 'P&L и движение денег', 'Бюджеты по проектам'],
  },
  {
    id: 'sales',
    tab: 'Продажи',
    icon: 'ShoppingCart',
    title: 'Продажи и клиенты в одной воронке',
    text: 'CRM с историей сделок, счетами и отгрузками. Менеджеры видят полную картину по клиенту и не теряют заявки.',
    points: ['Воронка сделок', 'Счета и отгрузки в один клик', 'История общения с клиентом'],
  },
  {
    id: 'production',
    tab: 'Производство',
    icon: 'Factory',
    title: 'Производство по плану',
    text: 'Спецификации, производственные заказы и расчёт себестоимости. Планируйте загрузку и контролируйте каждый этап выпуска.',
    points: ['Спецификации и техкарты', 'План-факт по цехам', 'Точная себестоимость'],
  },
  {
    id: 'analytics',
    tab: 'Аналитика',
    icon: 'BarChart3',
    title: 'Аналитика для решений',
    text: 'Наглядные дашборды и отчёты по любым срезам. Данные из всех модулей собираются автоматически — без выгрузок в Excel.',
    points: ['Настраиваемые дашборды', 'Отчёты по любым срезам', 'Экспорт и рассылки'],
  },
];

const Modules = () => {
  const [active, setActive] = useState(modules[0].id);
  const current = modules.find((m) => m.id === active)!;

  return (
    <section id="modules" className="border-y border-border bg-secondary/40 py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-accent">
            Модули
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-primary md:text-4xl text-balance">
            Одна система вместо десятка сервисов
          </h2>
          <p className="mt-4 text-muted-foreground text-balance">
            Выберите направление и посмотрите, как «Ориентир» решает его задачи.
          </p>
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-2">
          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                active === m.id
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'bg-card text-muted-foreground border border-border hover:text-primary'
              }`}
            >
              <Icon name={m.icon} size={16} />
              {m.tab}
            </button>
          ))}
        </div>

        <div
          key={current.id}
          className="mx-auto mt-10 grid max-w-5xl animate-fade-in items-center gap-10 rounded-3xl border border-border bg-card p-8 shadow-sm md:grid-cols-2 md:p-12"
        >
          <div>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
              <Icon name={current.icon} size={26} />
            </span>
            <h3 className="mt-6 text-2xl font-bold text-primary">{current.title}</h3>
            <p className="mt-3 text-muted-foreground">{current.text}</p>
          </div>
          <ul className="space-y-3">
            {current.points.map((p) => (
              <li
                key={p}
                className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                  <Icon name="Check" size={14} />
                </span>
                <span className="text-sm font-medium text-primary">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Modules;
