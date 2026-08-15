import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';

interface KioskIdleTimerProps {
  /** Выход из профиля на терминале, когда время ожидания истекло. */
  onTimeout: () => void;
  /** Через сколько бездействия показать предупреждение (мс). */
  idleMs?: number;
  /** Сколько секунд идёт обратный отсчёт в предупреждении. */
  countdownSec?: number;
}

/** Автовыход из профиля на терминале при бездействии: через минуту без действий появляется
 * предупреждение с обратным отсчётом, и если сотрудник не отреагировал — профиль закрывается,
 * чтобы терминал не остался открытым под чужой учётной записью. */
const KioskIdleTimer = ({ onTimeout, idleMs = 60000, countdownSec = 30 }: KioskIdleTimerProps) => {
  const [warning, setWarning] = useState(false);
  const [left, setLeft] = useState(countdownSec);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const clearAll = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    idleTimer.current = null;
    tickTimer.current = null;
  };

  const startIdle = () => {
    clearAll();
    setWarning(false);
    setLeft(countdownSec);
    idleTimer.current = setTimeout(() => setWarning(true), idleMs);
  };

  // Любая активность сбрасывает таймер бездействия.
  useEffect(() => {
    startIdle();
    const reset = () => {
      if (!warning) startIdle();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warning, idleMs, countdownSec]);

  // Обратный отсчёт в окне предупреждения.
  useEffect(() => {
    if (!warning) return;
    tickTimer.current = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearAll();
          onTimeoutRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
  }, [warning]);

  return (
    <Dialog open={warning} onOpenChange={(open) => !open && startIdle()}>
      <DialogContent className="kiosk-root sm:max-w-md" confirmClose={false}>
        <DialogTitle className="sr-only">Профиль скоро закроется</DialogTitle>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Icon name="TimerReset" size={56} className="text-amber-500" />
          <p className="text-2xl font-bold">Профиль закроется через {left} сек.</p>
          <p className="text-muted-foreground">Нажмите «Я тут», чтобы остаться в системе</p>
          <Button size="lg" className="h-16 w-full text-lg" onClick={startIdle}>
            Я тут
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskIdleTimer;
