import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

const SPARK_COLORS = ['#10b981', '#f59e0b', '#facc15', '#fb7185', '#38bdf8', '#fde68a', '#a3e635', '#f472b6'];

/** Частый залп из мелких тонких искр. */
const SPARKS = Array.from({ length: 32 }, (_, i) => {
  const upward = -Math.PI / 2 + ((i % 16) - 7.5) * 0.28;
  const angle = i % 2 === 0 ? upward : (i / 32) * Math.PI * 2;
  const dist = 150 + (i % 6) * 22;
  return {
    dx: `${Math.round(Math.cos(angle) * dist)}px`,
    dy: `${Math.round(Math.sin(angle) * dist)}px`,
    color: SPARK_COLORS[i % SPARK_COLORS.length],
    delay: `${(i * 24) % 760}ms`,
    size: 3 + (i % 3),
    confetti: i % 3 === 0,
    rot: `${(i % 2 === 0 ? 1 : -1) * (160 + (i % 5) * 50)}deg`,
  };
});

const COUNT_MS = 3000;
const FADE_MS = 700;

interface SalarySaluteProps {
  amount: number;
  onDone: () => void;
}

/**
 * Карточка по центру экрана: сумма набегает 3 секунды, салют идёт всё это время.
 * Когда сумма на месте, она прыгает, пока виджет не закроют крестиком
 * или кликом мимо карточки. После этого она плавно исчезает.
 */
const SalarySalute = ({ amount, onDone }: SalarySaluteProps) => {
  const [shown, setShown] = useState(0);
  const [pop, setPop] = useState(false);
  const [settled, setSettled] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const settledRef = useRef(false);
  const closingRef = useRef(false);

  const requestClose = () => {
    if (!settledRef.current || closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onDoneRef.current(), FADE_MS);
  };

  useEffect(() => {
    const finish = () => {
      setShown(amount);
      setPop(true);
      setSettled(true);
      settledRef.current = true;
    };

    if (reduced) {
      finish();
      return;
    }

    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / COUNT_MS);
      // Сначала сумма идёт бодро, последние цифры добираются медленно.
      const tail = t < 0.4 ? 0 : (t - 0.4) / 0.6;
      const eased = t < 0.4 ? 0.75 * (t / 0.4) : 0.75 + 0.25 * (1 - (1 - tail) ** 3);
      setShown(amount * eased);
      if (t < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [amount, reduced]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div
        className={`relative w-full max-w-[17rem] transition-opacity duration-700 sm:max-w-xs ${
          leaving ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {!settled && (
          <div className="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden>
            {SPARKS.map((spark, index) => (
              <span
                key={index}
                className={`salary-spark motion-reduce:hidden${spark.confetti ? ' salary-spark-confetti' : ''}`}
                style={{
                  background: spark.color,
                  boxShadow: `0 0 2px 0 ${spark.color}`,
                  animationDelay: spark.delay,
                  ['--dx' as string]: spark.dx,
                  ['--dy' as string]: spark.dy,
                  ['--size' as string]: `${spark.size}px`,
                  ['--rot' as string]: spark.rot,
                }}
              />
            ))}
          </div>
        )}
        <div className="salary-toast pointer-events-none relative z-0 mx-auto -mb-10 w-fit max-w-[78%] sm:-mb-12">
          <img
            src="/salary-toast.png"
            alt=""
            className="block h-48 w-auto [filter:drop-shadow(0_12px_16px_rgba(15,23,42,0.28))] sm:h-52"
          />
        </div>
        <div className="salary-card relative z-10 rounded-2xl border border-emerald-200 bg-card px-4 pb-6 pt-10 text-center shadow-xl sm:px-6 sm:pb-8">
          {settled && (
            <button
              type="button"
              onClick={requestClose}
              className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Закрыть"
            >
              <Icon name="X" size={16} />
            </button>
          )}
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            К выплате
          </p>
          <p className="salary-amount mt-3 font-bold tabular-nums text-emerald-700">
            <span className={pop ? 'salary-bounce' : undefined}>
              {formatMoney(shown)}&nbsp;₽
            </span>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SalarySalute;
