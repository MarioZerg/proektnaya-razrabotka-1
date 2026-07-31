import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const faqs = [
  {
    q: 'Сколько времени занимает внедрение?',
    a: 'В среднем 14 дней. Персональный менеджер помогает перенести данные из ваших таблиц или прежней системы, настроить процессы и обучить команду.',
  },
  {
    q: 'Нужно ли устанавливать программу на компьютеры?',
    a: 'Нет. «Ориентир» работает в облаке — достаточно браузера. Есть мобильная версия для работы с планшета и телефона.',
  },
  {
    q: 'Можно ли перенести данные из 1С или Excel?',
    a: 'Да. Мы поддерживаем импорт из большинства учётных систем и таблиц. Наши специалисты сделают перенос за вас на этапе внедрения.',
  },
  {
    q: 'Что будет с данными после окончания пробного периода?',
    a: 'Все данные сохраняются. Вы можете продолжить работу на платном тарифе или выгрузить информацию в удобном формате.',
  },
  {
    q: 'Есть ли интеграции с другими сервисами?',
    a: 'Да. Доступны интеграции с банками, маркетплейсами, службами доставки и телефонией, а также открытый API для собственных решений.',
  },
];

const Faq = () => {
  return (
    <section id="faq" className="border-t border-border bg-secondary/40 py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-accent">
            Вопросы и ответы
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-primary md:text-4xl text-balance">
            Отвечаем на частые вопросы
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((item, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="rounded-2xl border border-border bg-card px-6 data-[state=open]:border-accent/40"
              >
                <AccordionTrigger className="text-left text-base font-semibold text-primary hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default Faq;
