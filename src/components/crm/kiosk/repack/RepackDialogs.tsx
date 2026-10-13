import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';

interface RepackDialogsProps {
  isAdmin: boolean;
  clearAsk: boolean;
  setClearAsk: (value: boolean) => void;
  waiting: number;
  processing: boolean;
  onClearQueue: () => void;
}

const RepackDialogs = ({
  isAdmin,
  clearAsk,
  setClearAsk,
  waiting,
  processing,
  onClearQueue,
}: RepackDialogsProps) => (
  <>
    <Dialog open={isAdmin && clearAsk} onOpenChange={(v) => !v && setClearAsk(false)}>
      <DialogContent className="kiosk-root sm:max-w-lg" confirmClose={false}>
        <DialogHeader>
          <DialogTitle className="text-2xl">Очистить очередь перепаковки?</DialogTitle>
        </DialogHeader>
        <p className="text-lg text-muted-foreground">
          {waiting > 0
            ? `Все ${waiting} шт. уйдут обратно кладовщику на разбор. Зарплата не начисляется.`
            : 'Очередь на экране станет пустой. Зарплата не начисляется.'}{' '}
          Кладовщик заново отправит в цех только вещи, которые реально забрал с
          маркетплейса.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="outline"
            className="h-20 text-xl"
            onClick={() => setClearAsk(false)}
            disabled={processing}
          >
            Отмена
          </Button>
          <Button
            size="lg"
            variant="destructive"
            className="h-20 text-xl"
            onClick={onClearQueue}
            disabled={processing}
          >
            <Icon name="RotateCcw" size={24} className="mr-2" />
            Очистить
          </Button>
        </div>
      </DialogContent>
    </Dialog>

  </>
);

export default RepackDialogs;