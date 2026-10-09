import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface RepackEmptyStateProps {
  countError: string | null;
  waiting: number;
  isAdmin: boolean;
  processing: boolean;
  onAskClear: () => void;
}

/**
 * Ничего не отсканировано — экран пустой. Список вещей намеренно не выводим:
 * упаковщица работает с той вещью, что держит в руках.
 */
const RepackEmptyState = ({
  countError,
  waiting,
  isAdmin,
  processing,
  onAskClear,
}: RepackEmptyStateProps) => (
  <div className="flex flex-col items-center gap-3 py-12">
    <Icon name="ScanLine" size={72} className="text-muted-foreground" />
    <p className="text-center text-2xl font-semibold">Отсканируйте вещь из тележки</p>
    <p className="max-w-md text-center text-muted-foreground">
      {countError
        ? 'Очередь не загрузилась — сканировать можно, список вещей на экране не показываем'
        : waiting > 0
        ? `В этом месяце на перепаковке ${waiting} шт. Берите вещь и подносите к сканеру`
        : 'Сюда попадают возвраты, которые кладовщик отправил переупаковать в этом месяце'}
    </p>
    {isAdmin && (
      <Button
        variant="outline"
        className="mt-4 h-14 border-violet-300 text-base text-violet-800 hover:bg-violet-50"
        onClick={onAskClear}
        disabled={processing || (!countError && waiting === 0)}
      >
        <Icon name="RotateCcw" size={22} className="mr-2" />
        Очистить очередь — начать с чистого листа
      </Button>
    )}
  </div>
);

export default RepackEmptyState;
