import Icon from '@/components/ui/icon';

const columns = [
  {
    title: 'Продукт',
    links: ['Возможности', 'Модули', 'Тарифы', 'Интеграции'],
  },
  {
    title: 'Компания',
    links: ['О нас', 'Клиенты', 'Блог', 'Вакансии'],
  },
  {
    title: 'Поддержка',
    links: ['База знаний', 'Внедрение', 'Статус системы', 'Контакты'],
  },
];

const Footer = () => {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-accent">
                <Icon name="Compass" size={20} />
              </span>
              <span className="text-lg font-extrabold tracking-tight text-primary">
                Ориентир
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Облачная ERP-система для управления складом, финансами, продажами и
              производством в едином окне.
            </p>
            <div className="mt-5 flex gap-3">
              {['Send', 'Mail', 'Phone'].map((ic) => (
                <span
                  key={ic}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  <Icon name={ic} size={16} />
                </span>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-sm font-bold text-primary">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © 2026 Ориентир. Все права защищены.
          </p>
          <div className="flex gap-5 text-xs text-muted-foreground">
            <a href="#" className="hover:text-primary">
              Политика конфиденциальности
            </a>
            <a href="#" className="hover:text-primary">
              Условия использования
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
