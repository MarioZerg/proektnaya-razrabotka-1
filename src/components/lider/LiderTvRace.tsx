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
  { x: 1648, y: 196 },
  { x: 1756, y: 188 },
  { x: 1548, y: 210 },
  { x: 1708, y: 128 },
  { x: 1596, y: 132 },
  { x: 1810, y: 168 },
];

const MIN_PATH_GAP = 0.07;
const MIN_FIG_PX = 100;

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
  const offset = (lane - (lanes - 1) / 2) * 72;
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
  active: boolean;
}

const sewerRunners = (race: LiveRace, people: LivePerson[]): LiveRaceRunner[] => {
  const onShift = new Set(people.filter((p) => p.role === 'sewer').map((p) => p.id));
  return race.runners
    .filter((r) => r.role === 'sewer' || onShift.has(r.id))
    .sort((a, b) => runnerProgress(b, race) - runnerProgress(a, race) || a.name.localeCompare(b.name, 'ru'))
    .map((r, i) => ({ ...r, place: i + 1 }));
};

const separate = (pts: { x: number; y: number }[]) => {
  for (let iter = 0; iter < 12; iter += 1) {
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= MIN_FIG_PX) continue;
        const push = (MIN_FIG_PX - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        pts[i].x -= ux * push;
        pts[i].y -= uy * push;
        pts[j].x += ux * push;
        pts[j].y += uy * push;
      }
    }
  }
};

const RaceFigure = ({
  name,
  avatarUrl,
  walking,
  finished,
  lead,
}: {
  name: string;
  avatarUrl?: string | null;
  walking: boolean;
  finished: boolean;
  lead: boolean;
}) => (
  <div className="flex flex-col items-center">
    {lead && !finished ? <span className="mb-0.5 text-2xl leading-none text-amber-300">♛</span> : null}
    {finished ? <span className="mb-0.5 text-xl leading-none text-amber-200">✦</span> : null}
    <div
      className="relative flex w-[4.6rem] flex-col items-center"
      style={walking ? { animation: 'race-bob 0.72s ease-in-out infinite' } : undefined}
    >
      <Avatar className="relative z-10 h-14 w-14 border-[3px] border-sky-200 shadow-[0_4px_14px_rgba(0,0,0,.45)]">
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt={name} referrerPolicy="no-referrer" className="object-cover" />
        ) : null}
        <AvatarFallback className="bg-sky-800 text-base font-bold text-white">{initials(name)}</AvatarFallback>
      </Avatar>
      <svg viewBox="0 0 72 72" className="-mt-1 h-[4.5rem] w-[4.6rem] overflow-visible">
        <ellipse cx="36" cy="68" rx="16" ry="4" fill="#0f172a" opacity="0.35" />
        <rect x="32" y="0" width="8" height="9" rx="3" fill="#e8b492" />
        <path d="M24 8 C24 8 19 14 18 22 L22 46 L50 46 L54 22 C53 14 48 8 48 8 Z" fill="#38bdf8" />
        <path d="M22 44 L50 44 L55 60 L17 60 Z" fill="#0284c7" />
        <g
          style={{
            transformOrigin: '20px 16px',
            animation: walking ? 'race-arm-l 0.72s ease-in-out infinite' : undefined,
          }}
        >
          <path d="M22 14 C 8 20, 8 34, 14 42" fill="none" stroke="#7dd3fc" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g
          style={{
            transformOrigin: '52px 16px',
            animation: walking ? 'race-arm-r 0.72s ease-in-out infinite' : undefined,
          }}
        >
          <path d="M50 14 C 64 20, 64 34, 58 42" fill="none" stroke="#7dd3fc" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g
          style={{
            transformOrigin: '28px 58px',
            animation: walking ? 'race-leg-l 0.72s ease-in-out infinite' : undefined,
          }}
        >
          <rect x="24" y="58" width="8" height="14" rx="4" fill="#1e3a5f" />
        </g>
        <g
          style={{
            transformOrigin: '44px 58px',
            animation: walking ? 'race-leg-r 0.72s ease-in-out infinite' : undefined,
          }}
        >
          <rect x="40" y="58" width="8" height="14" rx="4" fill="#1e3a5f" />
        </g>
      </svg>
    </div>
    <span className="mt-0.5 max-w-[8rem] truncate rounded-md bg-[#1c140c]/80 px-1.5 py-0.5 text-center text-sm font-bold text-amber-50">
      {shortName(name)}
    </span>
  </div>
);

/** На тропе только швеи, человечком с аватаркой вместо головы. Метраж не пишем. */
const LiderTvRace = ({ race, people, workingIds, active }: LiderTvRaceProps) => {
  const byId = new Map(people.map((p) => [p.id, p]));
  const racing = sewerRunners(race, people);
  const lead = racing.reduce((m, r) => Math.max(m, runnerProgress(r, race)), 0);
  const walking = racing.some((r) => workingIds.has(r.id) && !r.finished);

  useRaceAudio({ enabled: active, walking });

  const n = Math.max(1, racing.length);
  const items = racing.map((r) => ({ r, t: runnerProgress(r, race) }));
  for (let i = 1; i < items.length; i += 1) {
    items[i].t = Math.max(0, Math.min(items[i].t, items[i - 1].t - MIN_PATH_GAP));
  }
  const clustered = items.map((it, i) => {
    const finished = it.t >= 0.98 || Boolean(it.r.finished);
    const base = finished ? CASTLE_SLOTS[Math.min(i, CASTLE_SLOTS.length - 1)] : atPath(it.t, i, n);
    return {
      ...it.r,
      t: it.t,
      finished,
      x: base.x,
      y: base.y,
      working: workingIds.has(it.r.id),
      avatarUrl: it.r.avatarUrl || byId.get(it.r.id)?.avatarUrl,
    };
  });
  separate(clustered);

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
        @keyframes race-arm-l { 0%,100% { transform: rotate(14deg); } 50% { transform: rotate(-24deg); } }
        @keyframes race-arm-r { 0%,100% { transform: rotate(-14deg); } 50% { transform: rotate(24deg); } }
        @keyframes race-leg-l { 0%,100% { transform: rotate(-18deg); } 50% { transform: rotate(16deg); } }
        @keyframes race-leg-r { 0%,100% { transform: rotate(18deg); } 50% { transform: rotate(-16deg); } }
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
        <ellipse cx="720" cy="290" rx="340" ry="150" fill="#2f6a3c" />
        <ellipse cx="700" cy="300" rx="280" ry="118" fill="#357544" />

        <g opacity="0.95">
          <ellipse cx="640" cy="268" rx="42" ry="26" fill="#14532d" />
          <ellipse cx="708" cy="248" rx="50" ry="30" fill="#166534" />
          <ellipse cx="778" cy="272" rx="40" ry="24" fill="#15803d" />
          <ellipse cx="738" cy="292" rx="34" ry="20" fill="#14532d" />
          <ellipse cx="668" cy="300" rx="30" ry="18" fill="#166534" />
          <rect x="632" y="268" width="14" height="32" fill="#3f2a14" />
          <rect x="698" y="248" width="16" height="38" fill="#3f2a14" />
          <rect x="770" y="272" width="14" height="28" fill="#3f2a14" />
          <rect x="732" y="292" width="12" height="24" fill="#3f2a14" />
          <rect x="662" y="300" width="12" height="22" fill="#3f2a14" />
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

        <g filter="url(#race-soft)" transform="translate(40,-20)">
          <rect x="828" y="248" width="100" height="70" rx="4" fill="#fde68a" />
          <polygon points="818,248 878,204 938,248" fill="#b45309" />
          <rect x="864" y="276" width="24" height="42" fill="#7c2d12" />
          <rect x="844" y="260" width="16" height="16" fill="#fbbf24" />
          <rect x="896" y="260" width="16" height="16" fill="#f59e0b" />
          <circle cx="878" cy="194" r="18" fill="#facc15" />
          <text x="878" y="201" textAnchor="middle" fill="#78350f" fontSize="18" fontWeight="800" fontFamily="Segoe UI, sans-serif">
            В
          </text>
          <rect x="938" y="268" width="52" height="50" rx="3" fill="#fcd34d" />
          <polygon points="932,268 964,238 996,268" fill="#92400e" />
          <rect x="954" y="286" width="14" height="14" fill="#fbbf24" />
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

        <text x="118" y="828" fill="#fed7aa" fontSize="26" fontWeight="800" fontFamily="Segoe UI, sans-serif">
          Цех
        </text>
        <text x="560" y="578" fill="#e2e8f0" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Мост
        </text>
        <text x="868" y="348" fill="#fde68a" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Варики
        </text>
        <text x="658" y="368" fill="#bbf7d0" fontSize="22" fontWeight="700" fontFamily="Segoe UI, sans-serif">
          Роща
        </text>
        <text x="1588" y="58" fill="#fde68a" fontSize="26" fontWeight="800" fontFamily="Segoe UI, sans-serif">
          Замок
        </text>
      </svg>

      {clustered.map((r) => (
        <div
          key={r.id}
          className="absolute -translate-x-1/2 -translate-y-[82%] transition-all duration-[1400ms] ease-out"
          style={{ left: `${(r.x / 1920) * 100}%`, top: `${(r.y / 920) * 100}%`, zIndex: 20 + (8 - r.place) }}
        >
          <RaceFigure
            name={r.name}
            avatarUrl={r.avatarUrl}
            walking={r.working && !r.finished}
            finished={r.finished}
            lead={r.place === 1 && !race.winner}
          />
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
        {racing.slice(0, 8).map((r) => (
          <li key={r.id} className="flex items-center gap-2 whitespace-nowrap text-lg text-slate-100">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-black ${
                r.place === 1
                  ? 'bg-amber-400 text-stone-900'
                  : r.place === 2
                    ? 'bg-slate-300 text-slate-900'
                    : r.place === 3
                      ? 'bg-orange-400 text-stone-900'
                      : 'bg-white/10 text-amber-200'
              }`}
            >
              {r.place}
            </span>
            {shortName(r.name)}
          </li>
        ))}
      </ol>
    </div>
  );
};

export default LiderTvRace;
