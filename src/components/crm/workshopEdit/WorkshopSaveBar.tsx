import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface WorkshopSaveBarProps {
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

/** Нижняя панель «Отмена / Сохранить»: на телефоне прилипает к низу экрана. */
const WorkshopSaveBar = ({ saving, onCancel, onSave }: WorkshopSaveBarProps) => (
  <div
    className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-3 pr-20 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:pr-0 sm:backdrop-blur-none"
    style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
  >
    <div className="flex gap-2 sm:gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-11 flex-1 sm:h-10 sm:flex-none"
        onClick={onCancel}
      >
        Отмена
      </Button>
      <Button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-10 sm:flex-none"
      >
        {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
      </Button>
    </div>
  </div>
);

export default WorkshopSaveBar;
