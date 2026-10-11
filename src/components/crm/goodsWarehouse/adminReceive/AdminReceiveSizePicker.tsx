import { Button } from '@/components/ui/button';
import { choiceClass, type Step } from './adminReceiveShared';

interface AdminReceiveSizePickerProps {
  step: Step;
  material: string;
  width: number | null;
  materials: string[];
  widths: number[];
  heights: number[];
  saving: boolean;
  onBack: () => void;
  onPickMaterial: (name: string) => void;
  onPickWidth: (value: number) => void;
  onPickHeight: (value: number) => void;
}

/** Товар без стикера: материал, затем ширина, затем высота. */
const AdminReceiveSizePicker = ({
  step,
  material,
  width,
  materials,
  widths,
  heights,
  saving,
  onBack,
  onPickMaterial,
  onPickWidth,
  onPickHeight,
}: AdminReceiveSizePickerProps) => (
  <div className="space-y-2">
    {step !== 'material' && (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {material}
          {step === 'height' && width ? ` · ${width}` : ''}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Назад
        </Button>
      </div>
    )}
    {step === 'material' && (
      <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">В этом магазине нет товаров с размером</p>
        ) : (
          materials.map((name) => (
            <button
              key={name}
              type="button"
              disabled={saving}
              className={choiceClass}
              onClick={() => onPickMaterial(name)}
            >
              {name}
            </button>
          ))
        )}
      </div>
    )}
    {step === 'width' && (
      <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
        {widths.map((value) => (
          <button
            key={value}
            type="button"
            disabled={saving}
            className={choiceClass}
            onClick={() => onPickWidth(value)}
          >
            {value}
          </button>
        ))}
      </div>
    )}
    {step === 'height' && (
      <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
        {heights.map((value) => (
          <button
            key={value}
            type="button"
            disabled={saving}
            className={choiceClass}
            onClick={() => onPickHeight(value)}
          >
            {value}
          </button>
        ))}
      </div>
    )}
  </div>
);

export default AdminReceiveSizePicker;
