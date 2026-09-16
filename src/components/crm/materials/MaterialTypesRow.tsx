import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Material, MaterialType } from '@/lib/materialsApi';

interface MaterialTypesRowProps {
  types: MaterialType[];
  materials: Material[];
  /** Выбранная группа: таблица ниже показывает только её материалы. */
  selectedTypeId: number | 'all';
  onSelectType: (id: number | 'all') => void;
  onDeleteType: (id: number, name: string) => void;
}

/** Группы материалов — это фильтр справочника, а не просто подписи.
 *  Раньше чипы только считали позиции, и чтобы найти ткань приходилось листать
 *  все страницы. Клик по группе оставляет в таблице только её материалы.
 *  Пустую группу можно удалить прямо здесь, чтобы в справочнике не висели
 *  лишние категории. Группа с материалами не удаляется. */
const MaterialTypesRow = ({
  types,
  materials,
  selectedTypeId,
  onSelectType,
  onDeleteType,
}: MaterialTypesRowProps) => {
  if (types.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Группы материалов</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={selectedTypeId === 'all' ? 'default' : 'outline'}
          className="h-8"
          onClick={() => onSelectType('all')}
        >
          Все
          <span className="opacity-70">{materials.length}</span>
        </Button>
        {types.map((t) => {
          const count = materials.filter((m) => m.typeId === t.id).length;
          const selected = selectedTypeId === t.id;
          return (
            <div key={t.id} className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                className="h-8"
                onClick={() => onSelectType(selected ? 'all' : t.id)}
              >
                {t.name}
                <span className="opacity-70">{count} шт</span>
              </Button>
              {count === 0 && (
                <button
                  type="button"
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
