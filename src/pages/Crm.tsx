import Icon from '@/components/ui/icon';

const Crm = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary p-6 text-primary-foreground">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Icon name="Compass" size={28} />
        </span>
        <h1 className="text-2xl font-extrabold">Пространство «Ориентир»</h1>
        <p className="text-primary-foreground/70">Вы вошли в систему.</p>
      </div>
    </div>
  );
};

export default Crm;
