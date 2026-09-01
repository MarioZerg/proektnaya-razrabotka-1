import Icon from '@/components/ui/icon';
import type { Material, MaterialType } from '@/lib/materialsApi';

interface MaterialTypesRowProps {
  types: MaterialType[];
  materials: Material[];
  onDeleteType: (id: number, name: string) => void;
}

/** Группы материалов: пустую группу можно удалить прямо здесь, чтобы в справочнике
 *  не висели лишние категории. Группа с материалами не удаляется. */
const MaterialTypesRow = ({ types, materials, onDeleteType }: MaterialTypesRowProps) => {
  if (types.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Группы материалов</p>
      <div className="flex flex-wrap gap-2">
        {types.map((t) => {
          const count = materials.filter((m) => m.typeId === t.id).length;
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">{count} шт</span>
              {count === 0 && (
                <button
                  onClick={() => onDeleteType(t.id, t.name)}
                  className="text-muted-foreground transition hover:text-destructive"
                  aria-label={`Удалить группу ${t.name}`}
                >
                  <Icon name="X" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MaterialTypesRow;
