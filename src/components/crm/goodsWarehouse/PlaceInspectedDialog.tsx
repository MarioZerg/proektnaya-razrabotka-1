import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import PlaceInspectedBody from '@/components/crm/goodsWarehouse/PlaceInspectedBody';

interface PlaceInspectedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Приём осмотренных вещей из цеха на полки хранения — отдельное окно.
 *
 * Раньше это была вторая вкладка внутри «Разложить по полкам», и кладовщику
 * приходилось помнить, какая вкладка за что отвечает. Работы разные: сюда идут
 * возвраты после осмотра упаковщицей, туда — отказы клиентов прямо с конвейера.
 * Теперь у каждой свой вход с главной страницы склада.
 */
const PlaceInspectedDialog = ({ open, onOpenChange, onDone }: PlaceInspectedDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Принять осмотренные из цеха</DialogTitle>
      </DialogHeader>
      <PlaceInspectedBody
        active={open}
        onClose={() => onOpenChange(false)}
        onDone={onDone}
      />
    </DialogContent>
  </Dialog>
);

export default PlaceInspectedDialog;
