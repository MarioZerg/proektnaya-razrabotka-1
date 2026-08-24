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

/**
 * Автовыход из профиля на терминале при бездействии.
 *
 * Планшет стоит в цехе на проходе: сотрудник отошёл за тканью, а его профиль
 * остался открытым — следующий подошедший спишет брак и закроет заказы от его
 * имени, и в отчётах это будет его работа. Поэтому через 30 секунд без действий
 * появляется предупреждение с отсчётом, а ещё через 15 профиль закрывается и
 * терминал ждёт нового скана QR.
 *
 * Пороги короткие намеренно: работа за терминалом занимает секунды — отсканировал,
 * напечатал, закрыл. Полминуты неподвижного экрана означают, что человек ушёл.
 */
const KioskIdleTimer = ({ onTimeout, idleMs = 30000, countdownSec = 15 }: KioskIdleTimerProps) => {
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

  // Показано ли окно — держим в ссылке, а не только в состоянии.
  //
  // Иначе подписка на события ниже зависела бы от warning и пересоздавалась при
  // каждом его изменении. А это ломало автовыход целиком: как только окно
  // появлялось, эффект перезапускался, вызывал startIdle() и тут же гасил
  // окно обратно. Сотрудник ничего не видел, и профиль не закрывался НИКОГДА —
  // терминал так и стоял открытым под чужой учётной записью.
  const warningRef = useRef(false);
  warningRef.current = warning;

  // Любая активность сбрасывает таймер бездействия.
  useEffect(() => {
    startIdle();
    const reset = () => {
      // Пока окно на экране, случайное касание планшета его НЕ снимает: остаться
      // в системе можно только кнопкой. Иначе задетый локтем экран продлевал бы
      // чужую сессию бесконечно.
      if (!warningRef.current) startIdle();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleMs, countdownSec]);

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
        <DialogTitle className="sr-only">Терминал скоро закроется</DialogTitle>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Icon name="TimerReset" size={56} className="text-amber-500" />
          <p className="text-2xl font-bold">Терминал закроется через</p>
          {/* Секунды крупно и отдельной строкой: планшет висит на стене, и
              сотрудник смотрит на него от рабочего места, за пару метров. */}
          <p className="font-mono-tech text-7xl font-bold text-amber-600">{left}</p>
          <p className="text-lg text-muted-foreground">
            Нажмите «Остаться на странице» — иначе придётся заново сканировать свой
            QR-код сотрудника
          </p>
          <Button
            size="lg"
            className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
            onClick={startIdle}
          >
            <Icon name="Hand" size={26} className="mr-2" />
            Остаться на странице
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskIdleTimer;
