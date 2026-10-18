import { useEffect, useState } from 'react';
import { driverAssigned } from '@/lib/gazelkaPlate';
import SupplyTypeBadge from './SupplyTypeBadge';
import RelabelBoxesBadge from './RelabelBoxesBadge';
import B2bBadge from './B2bBadge';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Supply } from '@/lib/marketplaceSuppliesApi';
import { formatDate } from '@/lib/dateUtils';
import { marketplaceLogo, statusVariant } from './toMarketplaceConstants';

interface ToMarketplaceCardsProps {
  supplies: Supply[];
  onOpen: (id: number) => void;
}

type PieceStat = { label: string; value: string; className: string };

/** Штуки по заявке: короба, пошив и то, что ещё не отсканировано. */
const pieceStats = (s: Supply): PieceStat[] => {
  const stats: PieceStat[] = [];
  if (s.type === 'FBO' && s.plannedQuantity) {
    stats.push({
      label: 'В коробах',
      value: `${s.itemsCount} из ${s.plannedQuantity}`,
      className: s.itemsCount >= s.plannedQuantity ? 'text-emerald-700' : 'text-amber-700',
    });
  } else {
    stats.push({
      label: 'В поставке',
      value: String(s.itemsCount),
      className: 'text-foreground',
    });
  }
  if ((s.sewingTotal || 0) > 0) {
    const done = s.sewingDone || 0;
    const total = s.sewingTotal || 0;
    stats.push({
      label: 'Сшито',
      value: `${done} из ${total}`,
      className: done >= total ? 'text-emerald-700' : 'text-foreground',
    });
  }
  if (s.readyToScanCount && s.status !== 'Выполнена') {
    stats.push({
      label: 'Ждёт скана',
      value: String(s.readyToScanCount),
      className: 'text-amber-700',
    });
  }
  return stats;
};

/** FBO без кластера, Газельки или даты на маркетплейс ещё не заполнена. */
const fboIncomplete = (s: Supply) => {
  if (s.type !== 'FBO') return false;
  if (['Отгружено', 'Принята', 'Выполнена', 'Отменена'].includes(s.status)) return false;
  // Даты слота и номера плана в списке может ещё не быть: отсутствие поля — та же дыра, что и пустое значение.
  return !s.cluster || !s.gazelkaId || !s.gazelkaPlanId || !s.shipToGazelkaAt || !s.supplyDate;
};

const RoadTruck = () => (
  <span className="supply-road text-foreground" aria-hidden>
    <span className="supply-road-line" />
    <Icon name="Truck" size={26} className="supply-truck" />
  </span>
);

/**
 * Плотная лента поставок: одна строка — одна поставка.
 * На телефоне и на широком экране одинаково, без высокой карточки и без таблицы.
 */
const ToMarketplaceCards = ({ supplies, onOpen }: ToMarketplaceCardsProps) => (
  <div className="space-y-3">
    {supplies.map((s) => (
      <button
        key={s.id}
        type="button"
        onClick={() => onOpen(s.id)}
        className={`group relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border-2 bg-card text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
          s.type === 'FBS'
            ? 'border-orange-500'
            : s.type === 'FBO'
              ? 'border-teal-600'
              : 'border-border'
        }`}
      >
        <div className={fboIncomplete(s) ? 'opacity-50 transition-opacity group-hover:opacity-100' : ''}>
        <div className="flex min-w-0 items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
            <SupplyTypeBadge type={s.type} />
            <span className={marketplaceLogo[s.marketplace]?.className}>
              {marketplaceLogo[s.marketplace]?.label || s.marketplace}
            </span>
            {s.isB2b && <B2bBadge />}
            <span className="font-semibold leading-tight">
              {s.supplyNumber || `Поставка №${s.id}`}
            </span>
            <span className="text-xs font-medium text-black">создана {formatDate(s.createdAt)}</span>
            {s.type !== 'FBS' && s.gazelkaId && (
              <span className="inline-flex items-center rounded bg-[#004cdb] px-2 py-1 text-xs font-bold leading-none text-white">
                Газелька
              </span>
            )}
            {s.type !== 'FBS' && s.gazelkaId && (
              <span className="text-xs font-semibold text-black">{s.gazelkaId}</span>
            )}
          </div>
          {s.relabelBoxes && !['Отгружено', 'Принята', 'Выполнена', 'Отменена'].includes(s.status) && (
            <div className="mt-1.5">
              <RelabelBoxesBadge total={s.boxesTotal ?? 0} relabeled={s.boxesRelabeled ?? 0} />
            </div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground empty:hidden">
            {s.completedAt && (
              <span className="font-medium text-black">выполнена {formatDate(s.completedAt)}</span>
            )}
            {s.lockedByName && (
              <span className="inline-flex items-center gap-1 text-amber-800">
                <Icon name="Lock" size={11} />
                {s.lockedByName}
              </span>
            )}
            {s.status === 'Отгрузка' && !!s.fbsMissingCount && (
              <span className="text-destructive">не отсканировано: {s.fbsMissingCount}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {s.cluster && (
            <span className="max-w-[11rem] text-right text-xs font-bold leading-tight text-black underline">
              {s.cluster}
            </span>
          )}
          <Badge className={statusVariant[s.status]?.className || ''}>{s.status}</Badge>
        </div>
        </div>
        {(s.type === 'FBS' || s.supplyDate || (s.type !== 'FBS' && s.shipToGazelkaAt)) && (
          <>
            <div className="border-t border-border" />
            <div className="flex items-center gap-2 px-3 py-2">
              {s.type === 'FBS' && (
                <>
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-black">Со склада</span>
                  {s.status === 'Отгружено' || s.status === 'Выполнена' ? (
                    <span
                      className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center text-emerald-600"
                      title={s.marketplace === 'WB' ? 'ШК поставки отсканирован' : 'Всё отсканировано'}
                    >
                      <Icon name="CircleCheck" size={26} />
                    </span>
                  ) : (
                    <RoadTruck />
                  )}
                  {s.marketplace === 'WB' && (
                    <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-black">Склад WB</span>
                  )}
                  {s.marketplace === 'OZON' && (
                    <span className="inline-flex shrink-0 flex-col items-start leading-none">
                      <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs font-semibold leading-none text-black">
                        ПВЗ
                        {s.itemsCount > 0 && <span>{s.itemsCount}</span>}
                      </span>
                      {s.status !== 'Отгружено' && s.status !== 'Выполнена' && <PvzCutoffCountdown />}
                    </span>
                  )}
                  {s.status === 'Отгружено' && s.autoStatusAt && <FbsCloseHint at={s.autoStatusAt} />}
                </>
              )}
              {s.type !== 'FBS' && s.gazelkaPickup && (
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-black">Со склада</span>
              )}
              {s.type !== 'FBS' && s.gazelkaPickup && (
                driverAssigned(s.gazelkaVehicleNumber) ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-emerald-600"
                    title="Водитель назначен, поставка уедет"
                  >
                    <Icon name="CircleCheck" size={26} />
                    <span className="whitespace-nowrap rounded border border-black px-1.5 py-0.5 font-mono text-xs font-bold leading-none text-black">
                      {s.gazelkaVehicleNumber?.toUpperCase()}
                    </span>
                  </span>
                ) : (
                  <span
                    className="inline-flex shrink-0 items-center gap-1"
                    title="Номер авто не сменили — водитель ещё не назначен"
                  >
                    <RoadTruck />
                    <span className="whitespace-nowrap text-xs font-medium text-amber-700">
                      водитель не назначен
                    </span>
                  </span>
                )
              )}
              {s.type !== 'FBS' && s.shipToGazelkaAt && (
                <span className="inline-flex shrink-0 flex-col items-start leading-none">
                  <span className="whitespace-nowrap text-xs font-medium leading-none text-black">
                    в Газельку {formatDate(s.shipToGazelkaAt)}
                  </span>
                  {!['Отгружено', 'Принята', 'Выполнена', 'Отменена'].includes(s.status) && (
                    <GazelkaCountdown at={s.shipToGazelkaAt} />
                  )}
                </span>
              )}
              {s.type !== 'FBS' && s.shipToGazelkaAt && (
                ['Принята', 'Выполнена'].includes(s.status) ? (
                  <span
                    className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center text-emerald-600"
                    title="Маркетплейс принял поставку"
                  >
                    <Icon name="CircleCheck" size={26} />
                  </span>
                ) : (
                  <RoadTruck />
                )
              )}
              {s.supplyDate && (
                <span className="-ml-1 shrink-0 whitespace-nowrap text-xs font-medium text-black">
                  на маркетплейс {formatDate(s.supplyDate)}
                  {s.timeslot ? `, ${s.timeslot}` : ''}
                </span>
              )}
            </div>
          </>
        )}
        <PieceStrip supply={s} />
        </div>
        {fboIncomplete(s) && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center transition-opacity group-hover:opacity-0">
            <span className="max-w-full text-2xl font-bold leading-tight text-black">
              Не хватает данных по заявке
            </span>
          </span>
        )}
      </button>
    ))}
  </div>
);

const ruDays = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
};

/** Сколько осталось до даты отгрузки в Газельку. Без даты компонент не рисуется. */
/** Ближайшие 12:30 по Москве: машина на ПВЗ уезжает раз в день. */
const nextPvzDeparture = (now: number) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let target = Date.UTC(num('year'), num('month') - 1, num('day'), 9, 30, 0);
  if (now >= target) target += 86_400_000;
  return target;
};

const PvzCutoffCountdown = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, nextPvzDeparture(now) - now);
  const totalMin = Math.floor(left / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return (
    <span className="mt-0.5 text-[11px] font-semibold leading-none text-red-600">
      до 12:30 {hours > 0 ? `${hours} ч ` : ''}
      {minutes} мин
    </span>
  );
};

/** FBS: всё отсканировано — «Отгружено», сама закроется через 12 часов. */
const FbsCloseHint = ({ at }: { at: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const left = new Date(at).getTime() + 12 * 3_600_000 - now;
  const text =
    left <= 0
      ? 'закроется при ближайшей проверке'
      : `закроется через ${Math.floor(left / 3_600_000) > 0 ? `${Math.floor(left / 3_600_000)} ч ` : ''}${Math.floor((left % 3_600_000) / 60_000)} мин`;
  return <span className="ml-auto shrink-0 whitespace-nowrap text-xs font-medium text-red-600">{text}</span>;
};

const GazelkaCountdown = ({ at }: { at: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const target = new Date(at).getTime();
  if (Number.isNaN(target)) return null;
  const left = target - now;
  let text = 'срок вышел';
  if (left > 0) {
    const totalMin = Math.floor(left / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin - days * 60 * 24) / 60);
    const minutes = totalMin % 60;
    const seconds = Math.floor((left % 60000) / 1000);
    text =
      days > 0
        ? `осталось ${days} ${ruDays(days)} ${hours} ч`
        : hours > 0
          ? `осталось ${hours} ч ${String(minutes).padStart(2, '0')} мин`
          : `осталось ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return (
    <span className="mt-0.5 text-[11px] font-semibold leading-none text-red-600">
      {text}
    </span>
  );
};

const PieceStrip = ({ supply }: { supply: Supply }) => {
  const stats = pieceStats(supply);
  return (
    <div
      className="grid w-full gap-2 border-t border-border bg-muted/40 px-3 py-2.5"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-center shadow-sm">
          <div className="text-[11px] leading-none text-muted-foreground">{stat.label}</div>
          <div className={`mt-0.5 text-sm font-semibold leading-tight ${stat.className}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
};

export default ToMarketplaceCards;