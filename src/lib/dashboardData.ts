export interface DashboardWidget {
  label: string;
  value: number;
  icon: string;
  tone: 'default' | 'warning' | 'urgent';
}

export const dashboardWidgets: DashboardWidget[] = [
  { label: 'Новые задания на пошив', value: 24, icon: 'ListPlus', tone: 'default' },
  { label: 'Товары в пошиве', value: 58, icon: 'Shirt', tone: 'default' },
  { label: 'Товары в закрое', value: 33, icon: 'Scissors', tone: 'default' },
  { label: 'Срочные заказы (FBS)', value: 7, icon: 'Zap', tone: 'urgent' },
  { label: 'Товары к подбору со склада', value: 19, icon: 'PackageSearch', tone: 'default' },
  { label: 'Не отгруженные поставки в цех', value: 5, icon: 'TruckElectric', tone: 'warning' },
  { label: 'Не принятые поставки в цехе', value: 3, icon: 'PackageX', tone: 'warning' },
  { label: 'Товары на стикеровке', value: 41, icon: 'Tag', tone: 'default' },
  { label: 'Рулоны с малым остатком', value: 6, icon: 'AlertTriangle', tone: 'urgent' },
  { label: 'Раскроено', value: 112, icon: 'CheckCircle2', tone: 'default' },
];

export interface EmployeeShift {
  id: string;
  fio: string;
  role: string;
  shiftNumber: number | null;
  isOpen: boolean;
}

export const employeeShifts: EmployeeShift[] = [
  { id: '1', fio: 'Иванова А. С.', role: 'Швея', shiftNumber: 1, isOpen: true },
  { id: '2', fio: 'Петров Д. В.', role: 'Закройщик', shiftNumber: 1, isOpen: true },
  { id: '3', fio: 'Сидорова М. К.', role: 'Упаковщик', shiftNumber: 2, isOpen: false },
  { id: '4', fio: 'Кузнецов И. П.', role: 'Кладовщик', shiftNumber: 1, isOpen: true },
  { id: '5', fio: 'Смирнова Е. О.', role: 'Швея', shiftNumber: 2, isOpen: false },
  { id: '6', fio: 'Фёдорова Н. Р.', role: 'Уборщица', shiftNumber: 1, isOpen: false },
];

export interface ShiftDayRecord {
  date: string;
  employees: string[];
  activeShift: number;
}

export const shiftCalendar: ShiftDayRecord[] = [
  { date: '2026-07-29', employees: ['Иванова А. С.', 'Петров Д. В.'], activeShift: 1 },
  { date: '2026-07-30', employees: ['Сидорова М. К.', 'Кузнецов И. П.'], activeShift: 2 },
  { date: '2026-07-31', employees: ['Иванова А. С.', 'Петров Д. В.', 'Кузнецов И. П.'], activeShift: 1 },
];
