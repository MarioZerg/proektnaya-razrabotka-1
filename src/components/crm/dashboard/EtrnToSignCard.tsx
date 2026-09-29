import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import { fetchPendingEtrn, type EtrnPendingItem } from '@/lib/etrnApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const mpLabel: Record<string, string> = {
  OZON: 'OZON',
  WB: 'WB',
  Yandex: 'Я.Маркет',
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

/** Дата без года — на узком экране «24.09.2026, 16:18» не помещается в строку. */
const fmtSignedSince = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });

/** Строка метаданных без пустых кусков — иначе на телефоне остаются висячие «·». */
const metaLine = (parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ');

/**
 * Транспортные накладные, ожидающие подписи руководителя.
 *
 * Показывается ТОЛЬКО администратору. Подпись ЭТрН ставится в Диадоке через Рутокен —
 * это не работа кладовщика и не работа менеджера: перевозчик оформляет накладную сам,
 * а очередь на главной нужна тому, у кого ключ. Карточка в поставке тоже только у админа.
 *
 * Закрытая FBO сюда не входит: ЭТрН к ней уже не заполняют, уведомлять не о чем.
 */
const EtrnToSignCard = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<EtrnPendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchPendingEtrn()
      .then((list) => {
        setListError(null);
        setItems(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить накладные');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Пустая очередь — не повод занимать место на главной: подписывать нечего.
  // FRONTEND-ONLY: сбой не прячем — иначе кажется, что подписывать нечего.
  if (loading && items.length === 0 && !listError) return null;

  if (listError && items.length === 0) {
    return (
      <WarehouseFetchError
        title="ЭТрН не загрузились"
        description={listError}
        onRetry={load}
      />
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="flex min-w-0 items-center gap-2 font-semibold">
        <Icon name="FileSignature" size={18} className="shrink-0 text-amber-600" />
        <span className="min-w-0 truncate">ЭТрН на подпись</span>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 text-sm text-amber-700">
          {items.length}
        </span>
      </h2>

      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="space-y-2 pt-4">
          <p className="text-xs leading-snug text-amber-900 md:hidden">
            Подпись в Диадоке. Закрытые FBO сюда не попадают.
          </p>
          <p className="hidden text-xs leading-snug text-amber-900 md:block">
            Очередь на подпись по живым поставкам. У закрытой FBO накладную
            заполнять уже не нужно — такие заявки с главной убраны.
          </p>

          {items.map((d) => {
            const facts = metaLine([
              d.cargoPlaces ? `мест: ${d.cargoPlaces}` : null,
              d.deliveryAt ? `сдача ${fmtDate(d.deliveryAt)}` : null,
            ]);
            const who = metaLine([
              d.driverName || null,
              d.vehicleNumber || null,
            ]);

            return (
              <div
                key={d.id}
                className="flex flex-col gap-2 rounded-md border border-amber-200 bg-background p-3 md:flex-row md:items-center md:gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {d.number
                        ? `ЭТрН № ${d.number}`
                        : d.supplyNumber
                          ? `Поставка ${d.supplyNumber}`
                          : 'ЭТрН без номера'}
                    </p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {mpLabel[d.marketplace] || d.marketplace}
                      {d.supplyType ? ` · ${d.supplyType}` : ''}
                    </Badge>
                  </div>
                  {d.cluster && (
                    <p className="break-words text-xs leading-snug text-muted-foreground">
                      {d.cluster}
                    </p>
                  )}
                  {facts && (
                    <p className="text-xs leading-snug text-muted-foreground">{facts}</p>
                  )}
                  {who && (
                    <p className="hidden truncate text-xs text-muted-foreground md:block">
                      {who}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    <span className="md:hidden">С {fmtSignedSince(d.updatedAt)}</span>
                    <span className="hidden md:inline">
                      На подписи с {formatDateTime(d.updatedAt)}
                    </span>
                  </p>
                </div>

                <div
                  className={`grid gap-1.5 md:flex md:shrink-0 md:flex-col ${
                    d.operatorDocId ? 'grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {d.operatorDocId && (
                    <Button size="sm" asChild className="w-full">
                      <a
                        href="https://diadoc.kontur.ru/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="PenLine" size={14} className="mr-1.5 shrink-0" />
                        <span className="md:hidden">Диадок</span>
                        <span className="hidden md:inline">Подписать в Диадоке</span>
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      navigate(`/crm/shipments/to-marketplace/${d.supplyId}`)
                    }
                  >
                    <span className="md:hidden">Поставка</span>
                    <span className="hidden md:inline">Открыть поставку</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default EtrnToSignCard;
