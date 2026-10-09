import { useEffect, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { LiveFloorData, LivePerson } from '@/lib/liveFloorApi';
import { initials, shortName, useTicker } from '@/components/crm/dashboard/liveFloor/liveFloorShared';
import { BubbleHat } from '@/components/lider/bubbleHats';

const ROLE_RING: Record<string, string> = {
  cutter: '#f59e0b',
  sewer: '#38bdf8',
  packer: '#fb923c',
  packer_returns: '#c4b5fd',
};

const workOf = (person: LivePerson, today?: LiveFloorData['today']) => {
  const s = today?.[String(person.id)] || {};
  if (person.role === 'cutter') return s.cut || 0;
  if (person.role === 'packer' || person.role === 'packer_returns') return s.packed || 0;
  return s.sewn || 0;
};

const workLabel = (role: string) => {
  if (role === 'cutter') return 'раскрой';
  if (role === 'packer') return 'упаковка';
  if (role === 'packer_returns') return 'перепаковка';
  return 'пошив';
};

interface Body {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  work: number;
  tx: number;
  ty: number;
  wait: number;
  zone: number;
  /** Насколько шляпа торчит над кружком. Без шляпы — 0. */
  crown: number;
}

const radiusFor = (work: number, maxWork: number) => {
  const t = Math.sqrt(Math.max(0, work) / Math.max(1, maxWork));
  return 56 + t * 118;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Цель в одной из 6 зон поля, чтобы не крутились в одном углу. */
const fieldTarget = (w: number, h: number, r: number, zone: number, crown = 0) => {
  const cols = 3;
  const rows = 2;
  const col = ((zone % 6) + 6) % 6 % cols;
  const row = Math.floor((((zone % 6) + 6) % 6) / cols);
  const padX = r + crown * 0.4 + 16;
  const padY = r + crown + 12;
  const x0 = (w / cols) * col;
  const x1 = (w / cols) * (col + 1);
  const y0 = (h / rows) * row;
  const y1 = (h / rows) * (row + 1);
  const left = Math.max(padX, x0 + 10);
  const right = Math.min(w - padX, x1 - 10);
  const top = Math.max(padY, y0 + 10);
  const bottom = Math.min(h - r - 40, y1 - 10);
  return {
    tx: rand(left, Math.max(left + 4, right)),
    ty: rand(top, Math.max(top + 4, bottom)),
  };
};

const boostLeft = (until: string | null | undefined, nowMs: number) => {
  if (!until) return '';
  const end = new Date(until).getTime();
  if (!Number.isFinite(end) || end <= nowMs) return '';
  const sec = Math.floor((end - nowMs) / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `3 заказа · ${days}д ${hours}ч`;
  if (hours > 0) return `3 заказа · ${hours}ч ${mins}м`;
  return `3 заказа · ${Math.max(1, mins)}м`;
};

const scatter = (w: number, h: number, r: number, zone: number, crown: number, used: { x: number; y: number; r: number }[]) => {
  for (let tryN = 0; tryN < 28; tryN += 1) {
    const spot = fieldTarget(w, h, r, zone + tryN, crown);
    const hit = used.some((u) => Math.hypot(u.x - spot.tx, u.y - spot.ty) < u.r + r + 20);
    if (!hit) return spot;
  }
  return fieldTarget(w, h, r, zone, crown);
};

interface LiderTvBubblesProps {
  active: boolean;
  people: LivePerson[];
  today: LiveFloorData['today'];
}

/** Второй экран ТВ: сотрудники смены. Кто больше сделал — крупнее и отталкивает мелких. */
const LiderTvBubbles = ({ active, people, today }: LiderTvBubblesProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef(new Map<number, HTMLDivElement>());
  const simRef = useRef<Body[]>([]);

  const maxWork = Math.max(1, ...people.map((p) => workOf(p, today)));
  const ranked = [...people].sort((a, b) => workOf(b, today) - workOf(a, today) || a.name.localeCompare(b.name, 'ru'));
  const nowMs = useTicker();

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth || 1920;
    const h = wrap.clientHeight || 920;
    const prev = new Map(simRef.current.map((b) => [b.id, b]));
    const placed: { x: number; y: number; r: number }[] = [];
    simRef.current = people.map((p) => {
      const work = workOf(p, today);
      const r = radiusFor(work, maxWork);
      const old = prev.get(p.id);
      const zone = old?.zone ?? placed.length;
      const crown = p.bubbleHat ? r * 1.35 : 0;
      const spawn = old ? { tx: old.x, ty: old.y } : scatter(w, h, r, zone, crown, placed);
      const aim = old ? { tx: old.tx, ty: old.ty } : fieldTarget(w, h, r, zone, crown);
      placed.push({ x: spawn.tx, y: spawn.ty, r });
      return {
        id: p.id,
        x: spawn.tx,
        y: spawn.ty,
        vx: old?.vx ?? rand(-80, 80),
        vy: old?.vy ?? rand(-70, 70),
        r,
        mass: r * r,
        work,
        tx: aim.tx,
        ty: aim.ty,
        wait: old?.wait ?? rand(1.6, 4.8),
        zone,
        crown,
      };
    });
  }, [people, today, maxWork]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      const wrap = wrapRef.current;
      const bodies = simRef.current;
      if (!wrap || bodies.length === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!last) last = t;
      const dt = Math.min(0.032, (t - last) / 1000);
      last = t;

      let cx = 0;
      let cy = 0;
      for (let i = 0; i < bodies.length; i += 1) {
        cx += bodies[i].x;
        cy += bodies[i].y;
      }
      cx /= bodies.length;
      cy /= bodies.length;

      for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i];
        a.wait -= dt;
        let tdx = a.tx - a.x;
        let tdy = a.ty - a.y;
        let tdist = Math.hypot(tdx, tdy);
        if (tdist < 36 || a.wait <= 0) {
          a.zone += 1 + Math.floor(Math.random() * 3);
          const next = fieldTarget(w, h, a.r, a.zone, a.crown);
          a.tx = next.tx;
          a.ty = next.ty;
          a.wait = rand(2.4, 5.8);
          tdx = a.tx - a.x;
          tdy = a.ty - a.y;
          tdist = Math.hypot(tdx, tdy);
        }
        const cruise = 92 + (1 - a.r / 200) * 78 + (a.id % 7) * 5;
        const nx = tdx / Math.max(1, tdist);
        const ny = tdy / Math.max(1, tdist);
        a.vx += (nx * cruise - a.vx) * 1.7 * dt;
        a.vy += (ny * cruise - a.vy) * 1.7 * dt;
        const fromC = Math.hypot(a.x - cx, a.y - cy) || 1;
        a.vx += ((a.x - cx) / fromC) * 38 * dt;
        a.vy += ((a.y - cy) / fromC) * 38 * dt;
        a.vx += (Math.random() - 0.5) * 52 * dt;
        a.vy += (Math.random() - 0.5) * 52 * dt;
        a.x += a.vx * dt;
        a.y += a.vy * dt;
      }

      for (let i = 0; i < bodies.length; i += 1) {
        for (let j = i + 1; j < bodies.length; j += 1) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 0.001) {
            dx = 0.4;
            dy = 0.2;
            dist = Math.hypot(dx, dy);
          }
          const nx = dx / dist;
          const ny = dy / dist;
          const min = a.r + b.r + 8;
          const bigger = a.r >= b.r ? a : b;
          const smaller = a.r >= b.r ? b : a;
          const bully = Math.max(1, bigger.r / Math.max(36, smaller.r));
          const field = min * (1.18 + (bully - 1) * 0.22);
          if (dist < field) {
            const push = ((field - dist) / field) * bully;
            const away = smaller === b ? 1 : -1;
            smaller.vx += nx * away * push * 220 * dt;
            smaller.vy += ny * away * push * 220 * dt;
            bigger.vx -= nx * away * push * 40 * dt;
            bigger.vy -= ny * away * push * 40 * dt;
          }
          if (dist < min) {
            const overlap = min - dist;
            const inv = 1 / (a.mass + b.mass);
            a.x -= nx * overlap * b.mass * inv * (a.r < b.r ? 1.35 : 0.55);
            a.y -= ny * overlap * b.mass * inv * (a.r < b.r ? 1.35 : 0.55);
            b.x += nx * overlap * a.mass * inv * (b.r < a.r ? 1.35 : 0.55);
            b.y += ny * overlap * a.mass * inv * (b.r < a.r ? 1.35 : 0.55);
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const e = 0.55;
              const jImp = (-(1 + e) * rv) / (1 / a.mass + 1 / b.mass);
              a.vx -= (jImp / a.mass) * nx;
              a.vy -= (jImp / a.mass) * ny;
              b.vx += (jImp / b.mass) * nx;
              b.vy += (jImp / b.mass) * ny;
            }
          }
        }
      }

      for (const a of bodies) {
        const padX = 10 + a.crown * 0.4;
        const padTop = 8 + a.crown;
        let bounced = false;
        if (a.x < a.r + padX) {
          a.x = a.r + padX;
          a.vx = Math.abs(a.vx) * 0.85;
          bounced = true;
        }
        if (a.x > w - a.r - padX) {
          a.x = w - a.r - padX;
          a.vx = -Math.abs(a.vx) * 0.85;
          bounced = true;
        }
        if (a.y < a.r + padTop) {
          a.y = a.r + padTop;
          a.vy = Math.abs(a.vy) * 0.85;
          bounced = true;
        }
        if (a.y > h - a.r - 36) {
          a.y = h - a.r - 36;
          a.vy = -Math.abs(a.vy) * 0.85;
          bounced = true;
        }
        if (bounced) {
          a.zone += 2;
          const next = fieldTarget(w, h, a.r, a.zone, a.crown);
          a.tx = next.tx;
          a.ty = next.ty;
          a.wait = rand(2.4, 5.2);
        }
        const spd = Math.hypot(a.vx, a.vy);
        if (spd > 220) {
          a.vx = (a.vx / spd) * 220;
          a.vy = (a.vy / spd) * 220;
        }
        const el = nodeRef.current.get(a.id);
        if (el) el.style.transform = `translate3d(${a.x - a.r}px, ${a.y - a.r}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-[#07101c]">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(900px 520px at 20% 15%, rgba(56,189,248,.16), transparent 60%), radial-gradient(700px 480px at 85% 80%, rgba(251,191,36,.12), transparent 55%)',
        }}
      />
      <div className="absolute left-5 top-4 z-20 max-w-[40rem] rounded-2xl border border-white/10 bg-[#0b1020]/70 px-5 py-3 backdrop-blur-sm">
        <p className="text-3xl font-black tracking-tight text-white">Сотрудники смены</p>
        <p className="text-xl text-slate-300">Кто больше сделал — тот крупнее и отпихивает мелких</p>
      </div>
      <div ref={wrapRef} className="absolute inset-0 overflow-visible">
        {ranked.map((p, place) => {
          const work = workOf(p, today);
          const r = radiusFor(work, maxWork);
          const ring = ROLE_RING[p.role] || '#94a3b8';
          const boost = boostLeft(p.hatBoostUntil, nowMs);
          return (
            <div
              key={p.id}
              ref={(el) => {
                if (el) nodeRef.current.set(p.id, el);
                else nodeRef.current.delete(p.id);
              }}
              className="absolute left-0 top-0 overflow-visible will-change-transform"
              style={{ width: r * 2, zIndex: 10 + Math.round(r) }}
            >
              <div className="relative overflow-visible" style={{ width: r * 2, height: r * 2 }}>
              {p.bubbleHat ? (
                <div
                  className="pointer-events-none absolute left-1/2 z-20"
                  style={{
                    bottom: '62%',
                    width: '150%',
                    transform: 'translateX(-50%)',
                    aspectRatio: '80 / 56',
                  }}
                >
                  <BubbleHat kind={p.bubbleHat} />
                </div>
              ) : null}
              <div
                className="relative h-full w-full overflow-hidden rounded-full shadow-[0_12px_28px_rgba(0,0,0,.45)]"
                style={{
                  boxShadow: `0 0 0 5px ${ring}, 0 12px 28px rgba(0,0,0,.45)`,
                }}
              >
                <Avatar className="h-full w-full">
                  {p.avatarUrl ? (
                    <AvatarImage src={p.avatarUrl} alt={p.name} referrerPolicy="no-referrer" className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-slate-800 text-3xl font-black text-white">{initials(p.name)}</AvatarFallback>
                </Avatar>
                <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_22%,rgba(255,255,255,.35),transparent_42%)]" />
              </div>
              </div>
              <div className="mt-1 text-center">
                <p className="truncate text-lg font-bold text-white drop-shadow">
                  {place === 0 ? '♛ ' : ''}
                  {shortName(p.name)}
                </p>
                <p className="text-sm font-semibold text-slate-300">
                  {work} · {workLabel(p.role)}
                </p>
                {boost ? (
                  <p className="mt-0.5 text-sm font-black text-amber-300 drop-shadow">{boost}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LiderTvBubbles;
