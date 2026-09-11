import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface SupplyLockedScreenProps {
  /** Сообщение сервера: кто именно занял поставку. */
  reason: string;
  onBackToList: () => void;
}

/**
 * Поставку уже собирает другой кладовщик — вместо рабочего экрана показываем
 * предупреждение. Так двое не разложат заказы по чужим коробам.
 */
const SupplyLockedScreen = ({ reason, onBackToList }: SupplyLockedScreenProps) => (
  <div className="mx-auto max-w-md space-y-5 py-16 text-center">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
      <Icon name="Lock" size={28} />
    </div>
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">Поставка занята</h1>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <p className="text-sm text-muted-foreground">
        Дождитесь, пока он закончит: одну поставку одновременно собирает только
        один сотрудник.
      </p>
    </div>
    <div className="flex flex-col gap-2">
      <Button onClick={onBackToList}>
        <Icon name="ArrowLeft" size={16} className="mr-2" />
        К списку поставок
      </Button>
      <Button variant="outline" onClick={() => window.location.reload()}>
        <Icon name="RefreshCw" size={16} className="mr-2" />
        Проверить снова
      </Button>
    </div>
  </div>
);

export default SupplyLockedScreen;
