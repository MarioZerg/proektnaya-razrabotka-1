import Icon from '@/components/ui/icon';

const features = [
  {
    icon: 'LayoutDashboard',
    title: 'Единая панель',
    text: 'Все ключевые показатели бизнеса на одном экране — от остатков на складе до кассового разрыва.',
  },
  {
    icon: 'Zap',
    title: 'Автоматизация рутины',
    text: 'Документы, заказы и уведомления формируются автоматически. Сотрудники занимаются делом, а не таблицами.',
  },
  {
    icon: 'ShieldCheck',
    title: 'Данные под защитой',
    text: 'Шифрование, гибкие права доступа и резервные копии. Ваша информация в безопасности 24/7.',
  },
  {
    icon: 'Puzzle',
    title: 'Гибкая настройка',
    text: 'Подключайте только нужные модули и настраивайте процессы под специфику вашей компании.',
  },
  {
    icon: 'Smartphone',
    title: 'Доступ откуда угодно',
    text: 'Работайте с ноутбука, планшета или телефона. Данные синхронизируются в реальном времени.',
  },
  {
    icon: 'Headphones',
    title: 'Поддержка и внедрение',
    text: 'Персональный менеджер поможет перенести данные и обучить команду за две недели.',
  },
];

const Features = () => {
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-accent">
            Возможности
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-primary md:text-4xl text-balance">
            Порядок в каждом процессе
          </h2>
          <p className="mt-4 text-muted-foreground text-balance">
            «Ориентир» закрывает задачи разных отделов и объединяет их работу в
            единый прозрачный контур управления.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                <Icon name={f.icon} size={22} />
              </span>
              <h3 className="mt-5 text-lg font-bold text-primary">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
