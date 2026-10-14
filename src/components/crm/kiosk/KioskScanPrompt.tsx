import KioskManualSearch from '@/components/crm/kiosk/KioskManualSearch';
import ScanPromptHero from '@/components/crm/scan/ScanPromptHero';
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
  <div className="space-y-4">
    <ScanPromptHero
      title={searching ? 'Ищем заказ…' : 'Отсканируйте QR-код с листка закройщика'}
      subtitle="Сканируются только заказы на стикеровке"
      loading={searching}
    />
    {/* Запасной путь, если сканер сломался или QR затёрт: найти заказ по размеру.
        Включается настройкой цеха «Ручной поиск заказа на терминале». */}
    {manualSearchAllowed && (
      <div className="mx-auto w-full max-w-md">
        <KioskManualSearch workshopId={workshopId} role={role} onSelect={onSelect} />
      </div>
    )}
  </div>
);

export default KioskScanPrompt;
