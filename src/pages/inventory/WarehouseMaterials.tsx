import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import InventoryTable from '@/components/crm/InventoryTable';
import Icon from '@/components/ui/icon';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';

const WarehouseMaterials = () => {
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMaterialsData()
      .then((data) => {
        setTypes(data.types);
        setMaterials(data.materials);
      })
      .finally(() => setLoading(false));
  }, []);

  const typesWithMaterials = types
    .map((t) => ({ type: t, items: materials.filter((m) => m.typeId === t.id && m.status === 'active') }))
    .filter((g) => g.items.length > 0);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Материалы на складе</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Что физически лежит на складе. Материал, выданный в цеха, сюда не входит —
            его видно в «Стоимости остатков» на странице рулонов
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : typesWithMaterials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Материалов пока нет. Добавьте их в разделе «Настройки → Материалы».
          </p>
        ) : (
          <div className="space-y-6">
            {typesWithMaterials.map(({ type, items }) => (
              <InventoryTable key={type.id} typeName={type.name} materials={items} />
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default WarehouseMaterials;
