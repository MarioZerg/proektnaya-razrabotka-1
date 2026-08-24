import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { clearAppCache } from '@/lib/appUpdate';
import { roleLabels, type Role } from '@/lib/roles';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';
import type { KioskScreen } from '@/components/crm/kiosk/KioskMenu';

interface Props {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  isPreview: boolean;
  screen: KioskScreen;
  setScreen: (screen: KioskScreen) => void;
  onLogout: () => void;
}

/**
 * Шапка терминала: кто работает, в каком цехе и открыта ли смена.
 *
 * Зелёная в обычной работе и фиолетовая в режиме проверки — админ должен
 * видеть с порога, что смотрит чужой терминал, а не работает за сотрудника.
 */
const KioskWorkspaceHeader = ({
  user,
  shift,
  workshopId,
  isPreview,
  screen,
  setScreen,
  onLogout,
}: Props) => (
  <div
    className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
      isPreview ? 'bg-violet-100' : 'bg-emerald-100'
    }`}
  >
    {isPreview && (
      <Badge className="bg-violet-600 text-base text-white hover:bg-violet-600">
        <Icon name="Eye" size={14} className="mr-1.5" />
        Режим проверки · {roleLabels[user.role as Role] || user.role}
        {user.id ? ' · реальные данные' : ''}
      </Badge>
    )}
    <p
      className={`text-xl font-semibold ${
        isPreview ? 'text-violet-900' : 'text-emerald-900'
      }`}
    >
      Приветствую, {user.name}!
    </p>
    <Badge variant="secondary" className="text-base">
      Цех №{workshopId}
    </Badge>
    {shift?.isOpen ? (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Смена открыта</Badge>
    ) : (
      <Badge variant="secondary">Смена закрыта</Badge>
    )}
    {/* Кнопки прижаты вправо, но на узком планшете переносятся вниз целой
        группой, а не по одной — иначе «Выход» уезжал в другой ряд и попадал
        под палец при попытке нажать «В меню». */}
    <div className="ml-auto flex flex-wrap gap-2">
      {screen !== 'menu' && (
        <Button variant="outline" onClick={() => setScreen('menu')}>
          <Icon name="ArrowLeft" size={20} className="mr-1.5" />
          В меню
        </Button>
      )}
      {/* Планшет в цехе не закрывается сутками и может держать старую
          версию системы. Кнопка стирает сохранённые копии и загружает
          свежую версию — без похода в настройки браузера. */}
      <Button
        variant="outline"
        title="Загрузить свежую версию системы"
        onClick={() => {
          void clearAppCache();
        }}
      >
        <Icon name="RefreshCw" size={16} className="mr-1.5" />
        Обновить
      </Button>
      <Button variant="destructive" onClick={isPreview ? () => window.close() : onLogout}>
        {isPreview ? 'Закрыть проверку' : 'Выход'}
      </Button>
    </div>
  </div>
);

export default KioskWorkspaceHeader;
