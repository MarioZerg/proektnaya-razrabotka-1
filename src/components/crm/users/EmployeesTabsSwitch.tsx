export type EmployeesTab = 'active' | 'archived' | 'candidates';

interface EmployeesTabsSwitchProps {
  tab: EmployeesTab;
  setTab: (tab: EmployeesTab) => void;
  activeCount: number;
  archivedCount: number;
  /** Чаты кандидатов видит только администратор в своей роли. */
  showCandidates?: boolean;
}

/** Кнопки разделов. На телефоне тоже кнопки, не выпадающий список:
    «Чаты с кандидатами» иначе не видно, пока не откроешь меню. */
const EmployeesTabsSwitch = ({
  tab,
  setTab,
  activeCount,
  archivedCount,
  showCandidates = false,
}: EmployeesTabsSwitchProps) => {
  const items: { id: EmployeesTab; label: string; short: string }[] = [
    { id: 'active', label: `Работают (${activeCount})`, short: `Работают ${activeCount}` },
    { id: 'archived', label: `Архив — уволенные (${archivedCount})`, short: `Архив ${archivedCount}` },
  ];
  if (showCandidates) {
    items.push({ id: 'candidates', label: 'Чаты с кандидатами', short: 'Чаты' });
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
          >
            <span className="sm:hidden">{item.short}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default EmployeesTabsSwitch;
