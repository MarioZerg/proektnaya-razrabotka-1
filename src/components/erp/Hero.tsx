import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

interface HeroProps {
  onLogin: () => void;
}

const metrics = [
  { value: '2 400+', label: 'компаний' },
  { value: '−31%', label: 'издержек' },
  { value: '14 дней', label: 'на внедрение' },
];

const Hero = ({ onLogin }: HeroProps) => {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
      <div className="absolute top-40 -left-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="container relative">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Облачная ERP нового поколения
            </span>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-primary sm:text-5xl md:text-6xl text-balance">
              Весь бизнес
              <br />
              в одном окне
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground text-balance">
              «Ориентир» объединяет склад, финансы, продажи и производство в
              единую систему. Реальные данные, точные решения и порядок вместо
              десятка разрозненных таблиц.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={onLogin}
                className="h-12 bg-accent px-7 text-base font-semibold text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/20"
              >
                Начать бесплатно
                <Icon name="ArrowRight" size={18} className="ml-1.5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onLogin}
                className="h-12 px-7 text-base font-semibold border-border text-primary hover:bg-secondary"
              >
                <Icon name="LogIn" size={18} className="mr-1.5" />
                Войти в кабинет
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap gap-8">
              {metrics.map((m) => (
                <div key={m.label}>
                  <div className="font-mono text-2xl font-bold text-primary">
                    {m.value}
                  </div>
                  <div className="text-sm text-muted-foreground">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative animate-scale-in">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-accent/20 to-primary/10 blur-2xl" />
            <div className="relative animate-float rounded-3xl border border-border bg-card p-3 shadow-2xl">
              <img
                src="https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/48e5dbba-b467-4853-9d05-6ba801081756.jpg"
                alt="Дашборд ERP-системы Ориентир"
                className="w-full rounded-2xl"
                loading="eager"
              />
            </div>
            <div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-border bg-card px-5 py-4 shadow-xl sm:block">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                  <Icon name="TrendingUp" size={18} />
                </span>
                <div>
                  <div className="text-xs text-muted-foreground">Выручка за месяц</div>
                  <div className="font-mono text-sm font-bold text-primary">+18,4%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
