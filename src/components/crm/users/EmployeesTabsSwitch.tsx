import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type EmployeesTab = 'active' | 'archived' | 'candidates';

interface EmployeesTabsSwitchProps {
  tab: EmployeesTab;
  setTab: (tab: EmployeesTab) => void;
  activeCount: number;
  archivedCount: number;
  /** Чаты кандидатов видит только администратор в своей роли. */
  showCandidates?: boolean;
}

/** Переключатель «Работают» / «Архив — уволенные» со счётчиками. */
const EmployeesTabsSwitch = ({
  tab,
  setTab,
  activeCount,
  archivedCount,
  showCandidates = false,
}: EmployeesTabsSwitchProps) => (
  <>
    {/* На телефоне — выпадающий список, на компьютере вкладки: две подписи
        со счётчиками в ширину телефона не помещаются. */}
    <div className="sm:hidden">
      <Select value={tab} onValueChange={(v) => setTab(v as EmployeesTab)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Работают ({activeCount})</SelectItem>
          <SelectItem value="archived">Архив — уволенные ({archivedCount})</SelectItem>
          {showCandidates && <SelectItem value="candidates">Чаты с кандидатами</SelectItem>}
        </SelectContent>
      </Select>
    </div>

    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as EmployeesTab)}
      className="hidden sm:block"
    >
      <TabsList>
        <TabsTrigger value="active">Работают ({activeCount})</TabsTrigger>
        <TabsTrigger value="archived">Архив — уволенные ({archivedCount})</TabsTrigger>
        {showCandidates && <TabsTrigger value="candidates">Чаты с кандидатами</TabsTrigger>}
      </TabsList>
    </Tabs>
  </>
);

export default EmployeesTabsSwitch;
