import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ShelfPhotoDialogProps {
  shelfName: string | null;
  photoUrl: string | null;
  onClose: () => void;
}

/**
 * Снимок полки по клику.
 *
 * Картинку не качаем, пока окно закрыто: на складе десятки карточек одной
 * полки, и заранее грузить одно и то же фото на каждую незачем.
 */
const ShelfPhotoDialog = ({ shelfName, photoUrl, onClose }: ShelfPhotoDialogProps) => (
  <Dialog open={!!photoUrl} onOpenChange={(open) => !open && onClose()}>
    <DialogContent confirmClose={false} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>Полка {shelfName}</DialogTitle>
      </DialogHeader>
      {photoUrl && (
        <img
          src={photoUrl}
          alt={`Где стоит контейнер на полке ${shelfName || ''}`}
          className="max-h-[75vh] w-full rounded-md object-contain"
        />
      )}
    </DialogContent>
  </Dialog>
);

export default ShelfPhotoDialog;
