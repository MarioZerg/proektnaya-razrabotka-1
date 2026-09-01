import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EmployeesTabsSwitchProps {
  tab: 'active' | 'archived';
  setTab: (tab: 'active' | 'archived') => void;
  activeCount: number;
  archivedCount: number;
}

/** Переключатель «Работают» / «Архив — уволенные» со счётчиками. */
const EmployeesTabsSwitch = ({
  tab,
  setTab,
  activeCount,
  archivedCount,
}: EmployeesTabsSwitchProps) => (
  <>
    {/* На телефоне — выпадающий список, на компьютере вкладки: две подписи
        со счётчиками в ширину телефона не помещаются. */}
    <div className="sm:hidden">
      <Select value={tab} onValueChange={(v) => setTab(v as 'active' | 'archived')}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Работают ({activeCount})</SelectItem>
          <SelectItem value="archived">Архив — уволенные ({archivedCount})</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'active' | 'archived')}
      className="hidden sm:block"
    >
      <TabsList>
        <TabsTrigger value="active">Работают ({activeCount})</TabsTrigger>
        <TabsTrigger value="archived">Архив — уволенные ({archivedCount})</TabsTrigger>
      </TabsList>
    </Tabs>
  </>
);

export default EmployeesTabsSwitch;
