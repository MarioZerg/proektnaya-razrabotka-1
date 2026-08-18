import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import DefectScanTab from '@/components/crm/defects/DefectScanTab';
import DefectReceivedTab from '@/components/crm/defects/DefectReceivedTab';
import DefectMissingTab from '@/components/crm/defects/DefectMissingTab';

/**
 * Приёмка брака из цеха на складе.
 *
 * Три вкладки:
 *  — «Приёмка»: кладовщик сканирует стикеры кусков. Поля ручного ввода нет:
 *    каждый кусок обязан пройти по своему стикеру, иначе к сданному браку можно
 *    было бы подмешать лишний материал.
 *  — «Принятый брак»: таблица со всей статистикой — кто сдал, из какого рулона и
 *    поставки, сколько. Отрезанные куски поставщик не забирает, но эту выборку
 *    ему показывают как претензию по качеству партии.
 *  — «Не найдено»: куски, которые не доехали до склада. Решение по ним принимает
 *    администратор — удержать стоимость или списать как потерянные.
 */
const DefectReceive = () => {
  const { user } = useAuth();
  const canView = user?.role === 'admin' || isStorekeeperRole(user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('scan');

  // Из уведомления на панели админа приходит ссылка сразу на нужную вкладку.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'missing' || t === 'received' || t === 'scan') setTab(t);
  }, [searchParams]);

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен складу и администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Приём брака из цеха</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Каждый кусок проходит на склад по своему стикеру
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setSearchParams(v === 'scan' ? {} : { tab: v }, { replace: true });
          }}
        >
          <TabsList>
            <TabsTrigger value="scan">Приёмка</TabsTrigger>
            <TabsTrigger value="received">Принятый брак</TabsTrigger>
            <TabsTrigger value="missing">Не найдено</TabsTrigger>
          </TabsList>

          <TabsContent value="scan" className="mt-4">
            <DefectScanTab />
          </TabsContent>
          <TabsContent value="received" className="mt-4">
            <DefectReceivedTab />
          </TabsContent>
          <TabsContent value="missing" className="mt-4">
            <DefectMissingTab />
          </TabsContent>
        </Tabs>
      </div>
    </CrmLayout>
  );
};

export default DefectReceive;
