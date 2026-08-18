/** Одна строка «свойство — значение» в карточке. */
export const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-right text-sm font-medium">{value}</span>
  </div>
);
