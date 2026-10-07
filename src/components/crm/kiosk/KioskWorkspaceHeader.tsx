import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { clearAppCache } from '@/lib/appUpdate';
import { roleLabels, type Role } from '@/lib/roles';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';
import type { KioskScreen } from '@/components/crm/kiosk/KioskMenu';

/** Должности, между которыми можно переключаться прямо на терминале. */
const SWITCH_ROLES: Record<string, { label: string; icon: string }> = {
  cutter: { label: 'Закройщик', icon: 'Scissors' },
  sewer: { label: 'Швея', icon: 'Shirt' },
  packer: { label: 'Упаковщик', icon: 'Package' },
  packer_returns: { label: 'Упаковщица-возвраты', icon: 'PackageOpen' },
};

interface Props {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  isPreview: boolean;
  screen: KioskScreen;
  setScreen: (screen: KioskScreen) => void;
  onLogout: () => void;
  shiftSaving?: boolean;
  onSwitchRole?: (role: string) => void;
}

/**
 * Шапка терминала: кто работает, в каком цехе, открыта ли смена и в какой должности.
 *
 * Кому админ разрешил несколько должностей, тот видит сверху переключатель:
 * встала с шитья на раскрой — нажала «Закройщик», работа швеи закрылась,
 * и терминал сразу показывает функционал закройщика.
 */
const KioskWorkspaceHeader = ({
  user,
  shift,
  workshopId,
  isPreview,
  screen,
  setScreen,
  onLogout,
  shiftSaving,
  onSwitchRole,
}: Props) => {
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const currentRole = shift?.role || user.role;
  const roleChoices = Array.from(
    new Set([...(user.allowedRoles || []), user.role].filter((r) => SWITCH_ROLES[r]))
  );
  const canSwitch = !!(shift?.isOpen && onSwitchRole && roleChoices.length > 1);
  const label = (r: string) => SWITCH_ROLES[r]?.label || roleLabels[r as Role] || r;

  return (
    <>
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
        {!canSwitch && shift?.isOpen && (
          <Badge variant="outline" className="text-base">
            {label(currentRole)}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {screen !== 'menu' && (
            <Button variant="outline" onClick={() => setScreen('menu')}>
              <Icon name="ArrowLeft" size={20} className="mr-1.5" />
              В меню
            </Button>
          )}
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

      {canSwitch && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2">
          <span className="text-base text-muted-foreground">Работаю как:</span>
          {roleChoices.map((r) => {
            const active = r === currentRole;
            return (
              <Button
                key={r}
                size="lg"
                variant={active ? 'default' : 'outline'}
                disabled={shiftSaving}
                className="h-12 text-lg"
                onClick={() => !active && setPendingRole(r)}
              >
                <Icon name={SWITCH_ROLES[r].icon} size={22} className="mr-2" />
                {SWITCH_ROLES[r].label}
                {active && <Icon name="Check" size={20} className="ml-2" />}
              </Button>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!pendingRole} onOpenChange={(o) => !o && setPendingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl">
              Переключиться на «{pendingRole ? label(pendingRole) : ''}»?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-lg">
              Работа в должности «{label(currentRole)}» будет закрыта, и терминал покажет
              функционал новой должности. Смена продолжается — опозданием это не считается.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 text-lg">Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="h-12 text-lg"
              onClick={() => {
                if (pendingRole) onSwitchRole?.(pendingRole);
                setPendingRole(null);
              }}
            >
              Переключиться
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default KioskWorkspaceHeader;
