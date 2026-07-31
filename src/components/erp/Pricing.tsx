import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

const plans = [
  {
    name: 'Старт',
    price: '4 900',
    tagline: 'Для небольших команд',
    features: ['До 5 пользователей', 'Склад и продажи', 'Базовые отчёты', 'Поддержка по email'],
    highlighted: false,
    cta: 'Выбрать тариф',
  },
  {
    name: 'Бизнес',
    price: '11 900',
    tagline: 'Для растущих компаний',
    features: [
      'До 25 пользователей',
      'Все модули системы',
      'Финансы и производство',
      'Интеграции и API',
      'Персональный менеджер',
    ],
    highlighted: true,
    cta: 'Попробовать бесплатно',
  },
  {
    name: 'Корпорация',
    price: 'Индивид.',
    tagline: 'Для холдингов и сетей',
    features: [
      'Без ограничений',
      'Выделенный сервер',
      'Доработки под процессы',
      'SLA и приоритет 24/7',
    ],
    highlighted: false,
    cta: 'Обсудить проект',
  },
];

interface PricingProps {
  onLogin: () => void;
}

const Pricing = ({ onLogin }: PricingProps) => {
  return (
    <section id="pricing" className="py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-accent">
            Тарифы
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-primary md:text-4xl text-balance">
            Прозрачные цены без сюрпризов
          </h2>
          <p className="mt-4 text-muted-foreground text-balance">
            14 дней бесплатно на любом тарифе. Без привязки карты и скрытых платежей.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-3xl border p-8 transition-all ${
                p.highlighted
                  ? 'border-accent bg-primary text-primary-foreground shadow-2xl lg:-translate-y-4'
                  : 'border-border bg-card hover:shadow-lg'
              }`}
            >
              {p.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-bold uppercase tracking-wide text-accent-foreground">
                  Популярный
                </span>
              )}
              <div className="text-lg font-bold">{p.name}</div>
              <div
                className={`text-sm ${
                  p.highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground'
                }`}
              >
                {p.tagline}
              </div>

              <div className="mt-6 flex items-end gap-1">
                <span className="font-mono text-4xl font-extrabold">{p.price}</span>
                {p.price !== 'Индивид.' && (
                  <span
                    className={`mb-1 text-sm ${
                      p.highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}
                  >
                    ₽ / мес
                  </span>
                )}
              </div>

              <ul className="mt-7 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm">
                    <Icon
                      name="Check"
                      size={16}
                      className={p.highlighted ? 'text-accent' : 'text-accent'}
                    />
                    <span className={p.highlighted ? '' : 'text-foreground'}>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={onLogin}
                className={`mt-8 h-11 w-full font-semibold ${
                  p.highlighted
                    ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {p.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Pricing;
