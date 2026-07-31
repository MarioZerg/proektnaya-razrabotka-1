import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import InventoryTable from '@/components/crm/InventoryTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { fetchCategories, type InventoryCategory } from '@/lib/inventoryApi';

const WarehouseMaterials = () => {
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  const tabs = Array.from(new Set(categories.map((c) => c.tab)));

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Материалы на складе</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Остатки материалов, аксессуаров и упаковки
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : tabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Категории ещё не созданы. Добавьте их в разделе «Настройки → Материалы».
          </p>
        ) : (
          <Tabs defaultValue={tabs[0]}>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab} value={tab} className="space-y-4">
                {categories
                  .filter((c) => c.tab === tab)
                  .map((c) => (
                    <InventoryTable key={c.id} category={c} />
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </CrmLayout>
  );
};

export default WarehouseMaterials;
