import { cn } from '@/lib/utils';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import type { Material } from '@/lib/materialsApi';

export interface MaterialGroup {
  type: { id: number; name: string };
  items: Material[];
}

const MaterialChecks = ({
  items,
  selected,
  onToggle,
}: {
  items: Material[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) => (
  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
    {items.map((m) => {
      const on = selected.has(m.id);
      return (
        <button
          key={m.id}
          type="button"
          aria-pressed={on}
          onClick={() => onToggle(m.id)}
          className={cn(
            'flex min-h-9 items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-sm leading-tight',
            on
              ? 'border-emerald-600 bg-emerald-50'
              : 'border-border bg-background',
          )}
        >
          <span
            className={cn(
              'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
              on
                ? 'border-emerald-700 bg-emerald-700'
                : 'border-muted-foreground/50 bg-background',
            )}
          >
            {on && (
              <Icon name="Check" size={10} strokeWidth={3} className="text-white" />
            )}
          </span>
          <span className="min-w-0 break-words">{m.name}</span>
        </button>
      );
    })}
  </div>
);

interface WorkshopMaterialsSectionsProps {
  groupedMaterials: MaterialGroup[];
  allowedProducts: Set<number>;
  allowedMaterials: Set<number>;
  onToggleProduct: (id: number) => void;
  onToggleMaterial: (id: number) => void;
}

/** Галочки тканей: какие товары цех берёт в работу и какие материалы может заказывать. */
const WorkshopMaterialsSections = ({
  groupedMaterials,
  allowedProducts,
  allowedMaterials,
  onToggleProduct,
  onToggleMaterial,
}: WorkshopMaterialsSectionsProps) => (
  <>
    <FormSection
      title="Товары маркетплейсов"
      hint={`Отмечено ${allowedProducts.size}`}
    >
      <p className="-mt-1 text-sm text-muted-foreground">
        Какие ткани этот цех берёт в работу — все ширины и высоты.
      </p>
      {groupedMaterials.map((group) => (
        <div key={group.type.id} className="pt-1">
          <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.type.name}
          </p>
          <MaterialChecks
            items={group.items}
            selected={allowedProducts}
            onToggle={onToggleProduct}
          />
        </div>
      ))}
    </FormSection>

    <FormSection
      title="Материалы для заявок"
      hint={`Отмечено ${allowedMaterials.size}`}
    >
      <p className="-mt-1 text-sm text-muted-foreground">
        Что цех может заказывать со склада и что попадёт в автозаказ.
      </p>
      {groupedMaterials.map((group) => (
        <div key={group.type.id} className="pt-1">
          <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.type.name}
          </p>
          <MaterialChecks
            items={group.items}
            selected={allowedMaterials}
            onToggle={onToggleMaterial}
          />
        </div>
      ))}
    </FormSection>
  </>
);

export default WorkshopMaterialsSections;
