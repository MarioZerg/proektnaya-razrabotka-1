import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { LivePerson, LiveRace, LiveRaceRunner } from '@/lib/liveFloorApi';
import { initials, shortName } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import { useRaceAudio } from '@/components/lider/useRaceAudio';

/** Тропа: цех слева внизу → мост → магазин вариков → роща на лужайке → ворота замка. */
const PATH: { x: number; y: number }[] = [
  { x: 250, y: 742 },
  { x: 370, y: 700 },
  { x: 490, y: 658 },
  { x: 610, y: 618 },
  { x: 730, y: 582 },
  { x: 850, y: 552 },
  { x: 970, y: 528 },
  { x: 1090, y: 498 },
  { x: 1200, y: 438 },
  { x: 1310, y: 370 },
  { x: 1420, y: 328 },
  { x: 1520, y: 300 },
  { x: 1600, y: 282 },
  { x: 1654, y: 248 },
];

const CASTLE_SLOTS = [
  { x: 1660, y: 188 },
  { x: 1710, y: 198 },
  { x: 1618, y: 192 },
  { x: 1688, y: 158 },
  { x: 1636, y: 154 },
  { x: 1740, y: 176 },
];

const LAWN = { x: 1688, y: 742 };
const LAWN_SLOTS = [
  { x: 1618, y: 758 },
  { x: 1668, y: 788 },
  { x: 1578, y: 786 },
  { x: 1718, y: 778 },
  { x: 1598, y: 728 },
  { x: 1748, y: 748 },
];

const ROLE_RING: Record<string, string> = {
  cutter: '#f59e0b',
  sewer: '#7dd3fc',
  packer: '#fb923c',
  packer_returns: '#c4b5fd',
};

const atPath = (t: number, lane = 0, lanes = 1) => {
  const clamped = Math.max(0, Math.min(0.999, t));
  const f = clamped * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const frac = f - i;
  const a = PATH[i];
  const b = PATH[i + 1];
  const x = a.x + (b.x - a.x) * frac;
  const y = a.y + (b.y - a.y) * frac;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = (lane - (lanes - 1) / 2) * 48;
  return { x: x + (-dy / len) * offset, y: y + (dx / len) * offset };
};

const pathD = PATH.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

const runnerProgress = (r: LiveRaceRunner, race: LiveRace) => {
  if (typeof r.progress === 'number') return Math.max(0, Math.min(1, r.progress));
  const goal = Math.max(1, race.steps || 1);
  return Math.max(0, Math.min(1, (r.done || 0) / goal));
};

interface LiderTvRaceProps {
  race: LiveRace;
  people: LivePerson[];
  workingIds: Set<number>;
  idlePunishIds: Set<number>;
  active: boolean;
}

const Fireworks = ({ active }: { active: boolean }) => {
  if (!active) return null;
  const bursts = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    left: 74 + (i % 5) * 4.4,
    top: 4 + (i % 4) * 7,
    delay: (i * 0.22) % 2.4,
    color: ['#fbbf24', '#fb7185', '#38bdf8', '#a3e635', '#e879f9', '#fdba74'][i % 6],
  }));
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {bursts.map((b) => (
        <span
          key={b.id}
          className="absolute h-3 w-3 rounded-full"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            background: b.color,
            boxShadow: `0 0 12px ${b.color}`,
            animation: `race-fw 1.6s ease-out ${b.delay}s infinite`,
          }}
        />
      ))}
      {bursts.map((b) => (
        <span
          key={`spark-${b.id}`}
          className="absolute h-1.5 w-8 origin-left rounded-full"
          style={{
            left: `${b.left + 1}%`,
            top: `${b.top + 1.5}%`,
            background: b.color,
            animation: `race-fw-spark 1.4s ease-out ${b.delay + 0.1}s infinite`,
          }}
        />
      ))}
    </div>
  );
};

/** Вечерний город швей: кто на смене, тот на тропе. Метраж на карте не пишем. */
const LiderTvRace = ({ race, people, workingIds, idlePunishIds, active }: LiderTvRaceProps) => {
  const byId = new Map(people.map((p) => [p.id, p]));
  const punished = race.runners.filter((r) => idlePunishIds.has(r.id));
  const racing = race.runners.filter((r) => !idlePunishIds.has(r.id));
  const lead = racing.reduce((m, r) => Math.max(m, runnerProgress(r, race)), 0);
  const nearCastle = lead >= 0.68 || racing.some((r) => r.finished);
  const walking = racing.some((r) => workingIds.has(r.id) && !r.finished);

  useRaceAudio({
    enabled: active,
    walking,
    nearCastle,
    whipping: punished.length > 0,
  });

  const clustered = racing.map((r) => {
    const t = runnerProgress(r, race);
    const finished = t >= 1 || Boolean(r.finished);
    const sameNear = racing.filter((o) => {
      const ot = runnerProgress(o, race);
      return Math.abs(ot - t) < 0.045;
    });
    const slot = sameNear.findIndex((o) => o.id === r.id);
    const base = finished
      ? CASTLE_SLOTS[Math.min(slot, CASTLE_SLOTS.length - 1)]
      : atPath(t, slot, sameNear.length);
    return {
      ...r,
      t,
      finished,
      punished: false,
      x: base.x,
      y: base.y,
      working: workingIds.has(r.id),
      avatarUrl: r.avatarUrl || byId.get(r.id)?.avatarUrl,
    };
  });

  const onLawn = punished.map((r, i) => ({
    ...r,
    t: runnerProgress(r, race),
    finished: false,
    punished: true,
    x: LAWN_SLOTS[i % LAWN_SLOTS.length].x,
    y: LAWN_SLOTS[i % LAWN_SLOTS.length].y,
    working: false,
    avatarUrl: r.avatarUrl || byId.get(r.id)?.avatarUrl,
  }));

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-2xl">
      <style>{`
        @keyframes race-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes race-glow { 0%,100% { opacity: .45; } 50% { opacity: .9; } }
        @keyframes race-flow { to { stroke-dashoffset: -240; } }
        @keyframes race-flag { 0%,100% { transform: skewX(0deg); } 50% { transform: skewX(-8deg); } }
        @keyframes race-smoke {
          0% { transform: translateY(0) scale(1); opacity: .5; }
          100% { transform: translateY(-42px) scale(1.6); opacity: 0; }
        }
        @keyframes race-twinkle { 0%,100% { opacity: .2; } 50% { opacity: 1; } }
        @keyframes race-boat { 0% { transform: translate(0,0); } 50% { transform: translate(70px,-8px); } 100% { transform: translate(0,0); } }
        @keyframes race-whip {
          0%, 38% { transform: rotate(-28deg); }
          52% { transform: rotate(78deg); }
          68%, 100% { transform: rotate(-18deg); }
        }
        @keyframes race-ouch {
          0%, 100% { transform: translate(0,0) rotate(0); }
          28% { transform: translate(10px, 6px) rotate(12deg); }
          48% { transform: translate(-8px, 3px) rotate(-10deg); }
        }
        @keyframes race-fw {
          0% { transform: translate(0, 18px) scale(0.2); opacity: 0; }
          18% { opacity: 1; }
          100% { transform: translate(18px, -56px) scale(1.4); opacity: 0; }
        }
        @keyframes race-fw-spark {
          0% { transform: rotate(var(--r, 20deg)) scaleX(0.2); opacity: 0; }
          25% { opacity: 1; }
          100% { transform: rotate(var(--r, 20deg)) scaleX(1.6) translateX(22px); opacity: 0; }
        }
      `}</style>
      <svg viewBox="0 0 1920 920" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="race-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1024" />
            <stop offset="42%" stopColor="#1b2348" />
            <stop offset="72%" stopColor="#3a2a4a" />
            <stop offset="100%" stopColor="#6b3a32" />
          </linearGradient>
          <linearGradient id="race-land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b4332" />
            <stop offset="100%" stopColor="#10281e" />
          </linearGradient>
          <linearGradient id="race-water" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1d6d8a" />
            <stop offset="55%" stopColor="#1a8aaa" />
            <stop offset="100%" stopColor="#0e4a66" />
          </linearGradient>
          <radialGradient id="race-moon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7d6" />
            <stop offset="55%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="race-lantern" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="race-castle-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <filter id="race-soft">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.4" />
          </filter>
        </defs>

        <rect width="1920" height="920" fill="url(#race-sky)" />
        <circle cx="1520" cy="110" r="90" fill="url(#race-moon)" />
        <circle cx="1510" cy="104" r="38" fill="#fff8e1" />
        {[
          [180, 60], [260, 120], [340, 40], [520, 80], [700, 36], [880, 90],
          [1040, 48], [1180, 110], [1320, 42], [1600, 70], [1780, 40], [1860, 130],
          [80, 160], [430, 150], [960, 20],
        ].map(([x, y], i) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 2.4 : 1.5}
            fill="#fff7ed"
            style={{ animation: `race-twinkle ${2.4 + (i % 5) * 0.4}s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}

        <ellipse cx="420" cy="210" rx="220" ry="28" fill="#1e293b" opacity="0.25" />
        <ellipse cx="980" cy="160" rx="260" ry="24" fill="#1e293b" opacity="0.2" />

        <path d="M-40 250 C 280 180, 520 260, 820 210 S 1280 80, 1960 140 L 1960 920 L -40 920 Z" fill="url(#race-land)" />
        <path d="M-20 430 C 260 360, 420 520, 720 470 S 1100 560, 1380 420 S 1680 300, 1960 340 L 1960 920 L -20 920 Z" fill="#163528" />
        <path
          d="M-40 560 C 180 500, 320 640, 560 600 S 900 720, 1180 560 S 1500 430, 1960 500 L 1960 920 L -40 920 Z"
          fill="url(#race-water)"
        />
        <path
          d="M-40 575 C 200 515, 340 655, 580 615 S 920 735, 1200 575 S 1520 445, 1960 515"
          fill="none"
          stroke="#9ee7f2"
          strokeWidth="8"
          strokeDasharray="18 22"
          opacity="0.45"
          style={{ animation: 'race-flow 8s linear infinite' }}
        />

        <g style={{ animation: 'race-boat 11s ease-in-out infinite' }}>
          <ellipse cx="430" cy="640" rx="38" ry="10" fill="#0f172a" opacity="0.35" />
          <path d="M400 632 L460 632 L452 644 L408 644 Z" fill="#7c2d12" />
          <polygon points="428,632 428,598 448,632" fill="#fef3c7" opacity="0.85" />
        </g>
        <g style={{ animation: 'race-boat 14s ease-in-out 2s infinite' }}>
          <path d="M980 690 L1048 690 L1040 702 L988 702 Z" fill="#9a3412" />
          <polygon points="1010,690 1010,658 1028,690" fill="#fed7aa" />
        </g>

        <ellipse cx="240" cy="760" rx="210" ry="90" fill="#1d4a32" />
        <ellipse cx="900" cy="555" rx="190" ry="95" fill="#2a5a38" />
        <ellipse cx="1260" cy="518" rx="175" ry="88" fill="#2d6340" />
        {punished.length > 0 ? (
          <g>
            <ellipse cx={LAWN.x} cy={LAWN.y} rx="168" ry="92" fill="#3f6b2a" />
            <ellipse cx={LAWN.x} cy={LAWN.y + 8} rx="140" ry="70" fill="#4d7c30" />
          </g>
        ) : null}

        <g opacity="0.95">
          <ellipse cx="1198" cy="528" rx="32" ry="20" fill="#14532d" />
          <ellipse cx="1258" cy="508" rx="40" ry="24" fill="#166534" />
          <ellipse cx="1324" cy="532" rx="34" ry="20" fill="#15803d" />
          <ellipse cx="1288" cy="548" rx="28" ry="16" fill="#14532d" />
          <rect x="1192" y="528" width="12" height="26" fill="#3f2a14" />
          <rect x="1250" y="508" width="14" height="32" fill="#3f2a14" />
          <rect x="1318" y="532" width="12" height="24" fill="#3f2a14" />
          <rect x="1282" y="548" width="10" height="20" fill="#3f2a14" />
        </g>

        <g filter="url(#race-soft)">
          <rect x="78" y="700" width="86" height="70" rx="4" fill="#d6b48a" />
          <polygon points="72,700 121,658 176,700" fill="#9a3412" />
          <rect x="108" y="728" width="22" height="42" fill="#1e293b" />
          <rect x="90" y="714" width="16" height="16" fill="#fde68a" />
          <rect x="136" y="714" width="14" height="14" fill="#fbbf24" />
          <rect x="178" y="722" width="62" height="52" rx="3" fill="#c4a574" />
          <polygon points="174,722 209,690 244,722" fill="#7c2d12" />
          <rect x="196" y="742" width="14" height="14" fill="#fde68a" />
          <rect x="252" y="736" width="48" height="44" rx="3" fill="#b45309" />
          <polygon points="248,736 276,708 304,736" fill="#7c2d12" />
          <rect x="264" y="748" width="12" height="12" fill="#fcd34d" />
          <circle cx="118" cy="648" r="7" fill="#64748b" />
          <circle cx="118" cy="662" r="11" fill="#94a3b8" />
          <rect x="114" y="668" width="8" height="34" fill="#334155" />
        </g>
        <g>
          <circle cx="132" cy="678" r="8" fill="#cbd5e1" opacity="0.5" style={{ animation: 'race-smoke 3.2s ease-out infinite' }} />
          <circle cx="268" cy="698" r="7" fill="#cbd5e1" opacity="0.45" style={{ animation: 'race-smoke 4s ease-out 1s infinite' }} />
        </g>
        <path d="M70 760 L 310 748" stroke="#f59e0b" strokeWidth="3" opacity="0.55" />
        <path d="M90 754 L 160 730 L 230 752" fill="none" stroke="#fb923c" strokeWidth="6" opacity="0.7" />

        <g filter="url(#race-soft)">
          <rect x="828" y="508" width="92" height="62" rx="4" fill="#fde68a" />
          <polygon points="818,508 874,468 928,508" fill="#b45309" />
          <rect x="858" y="532" width="22" height="38" fill="#7c2d12" />
          <rect x="840" y="518" width="14" height="14" fill="#fbbf24" />
          <rect x="890" y="518" width="14" height="14" fill="#f59e0b" />
          <circle cx="874" cy="458" r="16" fill="#facc15" />
          <text x="874" y="464" textAnchor="middle" fill="#78350f" fontSize="16" fontWeight="800" fontFamily="Segoe UI, sans-serif">
            В
          </text>
          <rect x="930" y="528" width="48" height="42" rx="3" fill="#fcd34d" />
          <polygon points="924,528 954,502 984,528" fill="#92400e" />
          <rect x="946" y="544" width="12" height="12" fill="#fbbf24" />
        </g>

        <path d="M500 668 C 560 600, 640 600, 700 648" fill="none" stroke="#292524" strokeWidth="46" />
        <path d="M500 668 C 560 600, 640 600, 700 648" fill="none" stroke="#78716c" strokeWidth="28" />
        <path d="M512 672 Q 600 628 688 656" fill="none" stroke="#1e293b" strokeWidth="10" />
        <rect x="488" y="648" width="18" height="52" fill="#44403c" />
        <rect x="684" y="640" width="18" height="52" fill="#44403c" />

        <path d={pathD} fill="none" stroke="#2a1810" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathD} fill="none" stroke="#8b5a2b" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={pathD}
          fill="none"
          stroke="#e8c48a"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="16 10"
        />

        {PATH.slice(0, -2).map((p, i) => {
          const lit = lead >= i / Math.max(1, PATH.length - 1) - 0.02;
          return (
            <g key={`lantern-${i}`}>
              {lit ? <circle cx={p.x} cy={p.y - 18} r="22" fill="url(#race-lantern)" /> : null}
              <rect x={p.x - 2} y={p.y - 26} width="4" height="20" fill="#1c1917" />
              <rect x={p.x - 7} y={p.y - 36} width="14" height="12" rx="2" fill={lit ? '#fbbf24' : '#44403c'} />
              {lit ? (
                <rect
                  x={p.x - 5}
                  y={p.y - 34}
                  width="10"
                  height="8"
                  rx="1"
                  fill="#fff7ed"
                  style={{ animation: 'race-glow 1.8s ease-in-out infinite' }}
                />
              ) : null}
            </g>
          );
        })}

        <g transform="translate(1488,-6) scale(1.12)" filter="url(#race-soft)">
          <circle cx="150" cy="150" r="120" fill="url(#race-castle-glow)" />
          <path d="M20 230 L 40 150 L 260 138 L 290 230 Z" fill="#334155" />
          <rect x="36" y="118" width="64" height="130" fill="#475569" />
          <rect x="210" y="108" width="58" height="140" fill="#3f4c5c" />
          <rect x="92" y="78" width="110" height="170" fill="#64748b" />
          <polygon points="32,118 68,58 104,118" fill="#1e293b" />
          <polygon points="206,108 239,48 276,108" fill="#1e293b" />
          <polygon points="86,78 147,8 208,78" fill="#0f172a" />
          <rect x="118" y="168" width="60" height="82" fill="#0b1220" />
          <path d="M118 168 Q 148 142 178 168" fill="#111827" />
          <rect x="52" y="150" width="16" height="18" fill="#fde68a" />
          <rect x="228" y="142" width="14" height="16" fill="#fcd34d" />
          <rect x="112" y="112" width="18" height="18" fill="#fde68a" />
          <rect x="164" y="112" width="18" height="18" fill="#fbbf24" />
          <rect x="138" y="128" width="16" height="16" fill="#fef3c7" />
          <rect x="148" y="28" width="8" height="26" fill="#ea580c" />
          <g style={{ transformOrigin: '156px 28px', animation: 'race-flag 2.4s ease-in-out infinite' }}>
            <polygon points="156,28 198,40 156,52" fill="#dc2626" />
          </g>
          <rect x="8" y="228" width="292" height="18" fill="#1e293b" />
          <rect x="18" y="214" width="18" height="32" fill="#475569" />
          <rect x="268" y="214" width="18" height="32" fill="#475569" />
        </g>
        <path d="M1600 282 L 1654 248" fill="none" stroke="#8b5a2b" strokeWidth="22" strokeLinecap="round" />
        <path d="M1600 282 L 1654 248" fill="none" stroke="#e8c48a" strokeWidth="10" strokeLinecap="round" strokeDasharray="10 8" />

        {punished.length > 0 ? (
          <g>
            <text x={LAWN.x - 70} y={LAWN.y - 78} fill="#fecaca" fontSize="22" fontWeight="800" fontFamily="Segoe UI, sans-serif">
              Простой
            </text>
            <g transform={`translate(${LAWN.x + 36}, ${LAWN.y - 70})`}>
              <ellipse cx="18" cy="118" rx="22" ry="8" fill="#0f172a" opacity="0.35" />
              <rect x="8" y="48" width="22" height="52" rx="4" fill="#111827" />
              <rect x="4" y="48" width="30" height="14" fill="#020617" />
              <circle cx="19" cy="34" r="16" fill="#1c1917" />
              <rect x="6" y="28" width="26" height="14" rx="6" fill="#09090b" />
              <circle cx="13" cy="34" r="3" fill="#fca5a5" />
              <circle cx="25" cy="34" r="3" fill="#fca5a5" />
              <rect x="14" y="98" width="8" height="22" fill="#111827" />
              <rect x="22" y="98" width="8" height="22" fill="#111827" />
              <g style={{ transformOrigin: '32px 58px', animation: 'race-whip 1.3s ease-in-out infinite' }}>
                <path d="M32 58 C 70 48, 108 22, 128 8" fill="none" stroke="#1c1917" strokeWidth="4" strokeLinecap="round" />
                <path d="M128 8 C 136 4, 142 10, 134 16" fill="none" stroke="#7f1d1d" strokeWidth="3" strokeLinecap="round" />
              </g>
            </g>
          </g>
        ) : null}

        <text x="118" y="828" fill="#fed7aa" fontSize="26" fontWeight="800" fontFamily="Segoe UI, sans-serif">
          Цех
        </text>
        <text x="560" y="578" fill="#e2e8f0" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Мост
        </text>
        <text x="818" y="598" fill="#fde68a" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Варики
        </text>
        <text x="1228" y="588" fill="#bbf7d0" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Роща
        </text>
        <text x="1588" y="58" fill="#fde68a" fontSize="26" fontWeight="800" fontFamily="Segoe UI, sans-serif">
          Замок
        </text>
      </svg>

      <Fireworks active={active && nearCastle} />

      {[...clustered, ...onLawn].map((r) => (
        <div
          key={r.id}
          className="absolute -translate-x-1/2 -translate-y-[78%] transition-all duration-[1400ms] ease-out"
          style={{ left: `${(r.x / 1920) * 100}%`, top: `${(r.y / 920) * 100}%`, zIndex: 20 + (8 - r.place) }}
        >
          <div
            className="flex flex-col items-center"
            style={
              r.punished
                ? { animation: 'race-ouch 0.65s ease-in-out infinite' }
                : r.working && !r.finished
                  ? { animation: 'race-bob 0.9s ease-in-out infinite' }
                  : undefined
            }
          >
            {r.place === 1 && !race.winner && !r.punished ? (
              <span className="mb-0.5 text-2xl leading-none text-amber-300">♛</span>
            ) : null}
            {r.finished ? <span className="mb-0.5 text-xl leading-none text-amber-200">✦</span> : null}
            <Avatar
              className="h-[4.25rem] w-[4.25rem] shadow-lg"
              style={{
                boxShadow: `0 0 0 4px ${r.punished ? '#ef4444' : ROLE_RING[r.role] || '#94a3b8'}, 0 8px 18px rgba(0,0,0,.45)`,
              }}
            >
              {r.avatarUrl ? (
                <AvatarImage src={r.avatarUrl} alt={r.name} referrerPolicy="no-referrer" className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-slate-800 text-base font-bold text-white">
                {initials(r.name)}
              </AvatarFallback>
            </Avatar>
            <span className="mt-1 rounded-md bg-[#1c140c]/80 px-1.5 py-0.5 text-center text-sm font-bold tracking-wide text-amber-50">
              {initials(r.name)}
            </span>
          </div>
        </div>
      ))}

      <div className="absolute left-5 top-4 z-30 max-w-[40rem] rounded-2xl border border-amber-200/20 bg-[#0b1020]/70 px-5 py-3 backdrop-blur-sm">
        <p className="text-3xl font-black tracking-tight text-white">Путь к замку</p>
        <p className="text-xl text-amber-100">Первая швея в воротах получает +{race.prize} вариков</p>
      </div>

      {race.winner && (
        <div className="absolute right-6 top-4 z-30 rounded-2xl border border-amber-300/60 bg-amber-500/25 px-5 py-3 backdrop-blur-sm">
          <p className="text-lg uppercase tracking-[0.2em] text-amber-200">Замок взят</p>
          <p className="text-3xl font-black text-white">{shortName(race.winner.name)}</p>
          <p className="text-xl text-amber-100">+{race.winner.variki} вариков</p>
        </div>
      )}

      <ol className="absolute bottom-3 left-1/2 z-30 flex max-w-[96%] -translate-x-1/2 gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020]/70 px-4 py-2 backdrop-blur-sm">
        {race.runners.slice(0, 8).map((r) => (
          <li key={r.id} className="flex items-center gap-2 whitespace-nowrap text-lg text-slate-100">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-black ${
                idlePunishIds.has(r.id)
                  ? 'bg-red-500 text-white'
                  : r.place === 1
                    ? 'bg-amber-400 text-stone-900'
                    : r.place === 2
                      ? 'bg-slate-300 text-slate-900'
                      : r.place === 3
                        ? 'bg-orange-400 text-stone-900'
                        : 'bg-white/10 text-amber-200'
              }`}
            >
              {idlePunishIds.has(r.id) ? '!' : r.place}
            </span>
            {shortName(r.name)}
          </li>
        ))}
      </ol>
    </div>
  );
};

export default LiderTvRace;
