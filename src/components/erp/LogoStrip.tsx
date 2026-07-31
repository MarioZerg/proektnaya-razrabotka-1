const companies = [
  'ТехноПром',
  'СеверЛогистик',
  'АгроСила',
  'МебельГрад',
  'ФармаЛайн',
  'СтройРесурс',
];

const LogoStrip = () => {
  return (
    <section className="border-y border-border bg-secondary/40 py-8">
      <div className="container">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Нам доверяют управление бизнесом
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {companies.map((c) => (
            <span
              key={c}
              className="text-lg font-bold tracking-tight text-muted-foreground/70 transition-colors hover:text-primary"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LogoStrip;
