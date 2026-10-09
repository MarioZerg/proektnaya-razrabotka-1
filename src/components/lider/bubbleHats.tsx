import type { ReactNode } from 'react';

export const BUBBLE_HATS: { key: string; title: string }[] = [
  { key: 'cowboy', title: 'Ковбойская шляпа' },
  { key: 'crown', title: 'Бутафорская корона' },
  { key: 'propeller', title: 'Пропеллер' },
  { key: 'chef', title: 'Колпак повара' },
  { key: 'wizard', title: 'Колпак мага' },
  { key: 'sombrero', title: 'Сомбреро' },
  { key: 'party', title: 'Колпак именинника' },
  { key: 'ushanka', title: 'Ушанка' },
  { key: 'tophat', title: 'Цилиндр' },
  { key: 'viking', title: 'Шлем викинга' },
  { key: 'catears', title: 'Кошачьи ушки' },
  { key: 'duck', title: 'Уточка на голове' },
  { key: 'cone', title: 'Дорожный конус' },
  { key: 'banana', title: 'Банановая корона' },
];

const HatSvg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 80 56" className="h-full w-full overflow-visible drop-shadow-[0_3px_4px_rgba(0,0,0,.45)]">
    {children}
  </svg>
);

/** Смешная шляпа на пузырьке сотрудника. */
export const BubbleHat = ({ kind }: { kind?: string | null }) => {
  if (!kind) return null;
  switch (kind) {
    case 'cowboy':
      return (
        <HatSvg>
          <ellipse cx="40" cy="42" rx="36" ry="8" fill="#6b3f1d" />
          <path d="M18 40 Q40 8 62 40" fill="#8b5a2b" />
          <rect x="22" y="28" width="36" height="8" rx="2" fill="#c4a574" />
        </HatSvg>
      );
    case 'crown':
      return (
        <HatSvg>
          <path d="M12 44 L16 16 L28 32 L40 10 L52 32 L64 16 L68 44 Z" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
          <circle cx="16" cy="16" r="4" fill="#ef4444" />
          <circle cx="40" cy="10" r="5" fill="#22d3ee" />
          <circle cx="64" cy="16" r="4" fill="#a78bfa" />
        </HatSvg>
      );
    case 'propeller':
      return (
        <HatSvg>
          <ellipse cx="40" cy="44" rx="22" ry="8" fill="#ef4444" />
          <rect x="36" y="18" width="8" height="26" fill="#1e293b" />
          <ellipse cx="40" cy="16" rx="28" ry="7" fill="#38bdf8" />
          <ellipse cx="40" cy="16" rx="7" ry="4" fill="#0f172a" />
        </HatSvg>
      );
    case 'chef':
      return (
        <HatSvg>
          <rect x="26" y="28" width="28" height="18" fill="#f8fafc" />
          <circle cx="28" cy="24" r="10" fill="#fff" />
          <circle cx="40" cy="16" r="12" fill="#fff" />
          <circle cx="52" cy="24" r="10" fill="#fff" />
          <rect x="24" y="42" width="32" height="8" rx="2" fill="#e2e8f0" />
        </HatSvg>
      );
    case 'wizard':
      return (
        <HatSvg>
          <path d="M40 4 L64 48 L16 48 Z" fill="#4c1d95" />
          <circle cx="40" cy="22" r="4" fill="#fde68a" />
          <circle cx="32" cy="34" r="3" fill="#fbbf24" />
          <circle cx="50" cy="36" r="2.5" fill="#fde68a" />
          <ellipse cx="40" cy="48" rx="26" ry="6" fill="#1e1b4b" />
        </HatSvg>
      );
    case 'sombrero':
      return (
        <HatSvg>
          <ellipse cx="40" cy="44" rx="38" ry="9" fill="#eab308" />
          <path d="M24 42 Q40 12 56 42" fill="#ca8a04" />
          <path d="M22 40 Q40 36 58 40" fill="none" stroke="#b91c1c" strokeWidth="3" />
        </HatSvg>
      );
    case 'party':
      return (
        <HatSvg>
          <path d="M40 6 L62 48 L18 48 Z" fill="#fb7185" />
          <path d="M40 6 L50 48 L30 48 Z" fill="#38bdf8" />
          <circle cx="40" cy="8" r="5" fill="#facc15" />
        </HatSvg>
      );
    case 'ushanka':
      return (
        <HatSvg>
          <ellipse cx="40" cy="36" rx="24" ry="16" fill="#78716c" />
          <ellipse cx="16" cy="40" rx="10" ry="14" fill="#57534e" />
          <ellipse cx="64" cy="40" rx="10" ry="14" fill="#57534e" />
          <rect x="28" y="20" width="24" height="10" rx="3" fill="#a8a29e" />
        </HatSvg>
      );
    case 'tophat':
      return (
        <HatSvg>
          <ellipse cx="40" cy="46" rx="30" ry="7" fill="#111827" />
          <rect x="24" y="10" width="32" height="34" rx="3" fill="#1f2937" />
          <rect x="24" y="32" width="32" height="6" fill="#dc2626" />
        </HatSvg>
      );
    case 'viking':
      return (
        <HatSvg>
          <ellipse cx="40" cy="40" rx="22" ry="14" fill="#94a3b8" />
          <path d="M18 36 L6 12 L24 28 Z" fill="#f8fafc" />
          <path d="M62 36 L74 12 L56 28 Z" fill="#f8fafc" />
          <rect x="28" y="28" width="24" height="8" fill="#64748b" />
        </HatSvg>
      );
    case 'catears':
      return (
        <HatSvg>
          <path d="M16 44 L22 8 L38 40 Z" fill="#fb923c" />
          <path d="M64 44 L58 8 L42 40 Z" fill="#fb923c" />
          <path d="M20 36 L24 14 L34 34 Z" fill="#fed7aa" />
          <path d="M60 36 L56 14 L46 34 Z" fill="#fed7aa" />
        </HatSvg>
      );
    case 'duck':
      return (
        <HatSvg>
          <ellipse cx="40" cy="32" rx="18" ry="14" fill="#facc15" />
          <circle cx="34" cy="28" r="3" fill="#0f172a" />
          <path d="M54 32 L72 28 L54 38 Z" fill="#fb923c" />
        </HatSvg>
      );
    case 'cone':
      return (
        <HatSvg>
          <path d="M40 4 L58 50 L22 50 Z" fill="#ea580c" />
          <rect x="28" y="20" width="24" height="6" fill="#fff" />
          <rect x="26" y="34" width="28" height="6" fill="#fff" />
        </HatSvg>
      );
    case 'banana':
      return (
        <HatSvg>
          <path d="M16 40 Q28 8 44 20 Q58 10 68 36 Q50 22 40 28 Q28 18 16 40" fill="#facc15" stroke="#ca8a04" strokeWidth="2" />
          <ellipse cx="18" cy="40" rx="5" ry="4" fill="#854d0e" />
        </HatSvg>
      );
    default:
      return null;
  }
};

export const hatTitle = (key?: string | null) => BUBBLE_HATS.find((h) => h.key === key)?.title || '';
