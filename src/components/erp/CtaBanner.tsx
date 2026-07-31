import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

interface CtaBannerProps {
  onLogin: () => void;
}

const CtaBanner = ({ onLogin }: CtaBannerProps) => {
  return (
    <section className="py-20 md:py-28">
      <div className="container">
        <div className="relative overflow-hidden rounded-[2rem] bg-primary px-8 py-14 text-center md:px-16 md:py-20">
          <div className="absolute inset-0 grid-bg opacity-20" />
          <div className="absolute -top-16 right-10 h-56 w-56 rounded-full bg-accent/30 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-primary-foreground md:text-4xl text-balance">
              Наведите порядок в бизнесе уже сегодня
            </h2>
            <p className="mt-4 text-primary-foreground/70 text-balance">
              14 дней бесплатно. Подключение за один день, перенос данных и
              обучение команды — на нас.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={onLogin}
                className="h-12 bg-accent px-8 text-base font-semibold text-accent-foreground hover:bg-accent/90"
              >
                Начать бесплатно
                <Icon name="ArrowRight" size={18} className="ml-1.5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onLogin}
                className="h-12 border-primary-foreground/25 bg-transparent px-8 text-base font-semibold text-primary-foreground hover:bg-primary-foreground/10"
              >
                Заказать демонстрацию
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CtaBanner;
