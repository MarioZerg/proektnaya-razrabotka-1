import Icon from '@/components/ui/icon';
import KioskManualSearch from '@/components/crm/kiosk/KioskManualSearch';
import type { KioskOrder } from '@/lib/kioskApi';

interface KioskScanPromptProps {
  searching: boolean;
  manualSearchAllowed: boolean;
  workshopId?: number | null;
  role?: string | null;
  onSelect: (found: KioskOrder) => void;
}

/**
 * Стартовый экран терминала: сотрудник сканирует QR с листка закройщика.
 *
 * Пока заказ не найден, на экране только крупная подсказка — в цехе смотрят
 * на терминал издалека, мелкие элементы там бесполезны.
 */
const KioskScanPrompt = ({
  searching,
  manualSearchAllowed,
  workshopId,
  role,
  onSelect,
}: KioskScanPromptProps) => (
  <div className="flex flex-col items-center gap-6 py-10">
    <Icon
      name={searching ? 'Loader2' : 'ScanLine'}
      size={72}
      className={`text-muted-foreground ${searching ? 'animate-spin' : ''}`}
    />
    <p className="text-center text-2xl font-semibold">
      {searching ? 'Ищем заказ…' : 'Отсканируйте QR-код с листка закройщика'}
    </p>
    <p className="text-center text-muted-foreground">
      Сканируются только заказы на стикеровке
    </p>
    {/* Запасной путь, если сканер сломался или QR затёрт: найти заказ по размеру.
        Включается настройкой цеха «Ручной поиск заказа на терминале». */}
    {manualSearchAllowed && (
      <div className="w-full max-w-md">
        <KioskManualSearch workshopId={workshopId} role={role} onSelect={onSelect} />
      </div>
    )}
  </div>
);

export default KioskScanPrompt;
