import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import { fetchPendingEtrn, type EtrnPendingItem } from '@/lib/etrnApi';

const mpLabel: Record<string, string> = {
  OZON: 'OZON',
  WB: 'Wildberries',
  Yandex: 'Яндекс.Маркет',
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

/**
 * Транспортные накладные, ожидающие подписи руководителя.
 *
 * Пока ЭТрН не подписана, поставку нельзя перевести в отгрузку — машина будет стоять.
 * Документ при этом лежит в карточке поставки, куда руководитель обычно не заходит,
 * поэтому очередь вынесена на главную: подписание перестаёт быть тем, о чём надо
 * вспомнить, и становится тем, что видно сразу при входе.
 *
 * Сама подпись ставится в Диадоке через Рутокен — по закону ЭТрН подписывается только
 * через аккредитованного оператора ИС ЭПД. Отсюда ведут два перехода: в поставку и,
 * когда появится номер документа у оператора, сразу в Диадок. После подписания файл
 * загружают обратно в карточку поставки.
 */
const EtrnToSignCard = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<EtrnPendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingEtrn()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // Пустая очередь — не повод занимать место на главной: подписывать нечего.
  if (loading || items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name="FileSignature" size={18} className="text-amber-600" />
        Накладные на подпись
        <span className="rounded-full bg-amber-100 px-2 text-sm text-amber-700">
          {items.length}
        </span>
      </h2>

      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="space-y-2 pt-4">
          <p className="text-xs text-amber-900">
            Пока накладная не подписана, поставку нельзя отгрузить. Подпись ставится
            в Диадоке через Рутокен, затем подписанный файл загружается в поставку.
          </p>

          {items.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-background p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {d.number ? `ЭТрН № ${d.number}` : 'ЭТрН без номера'}
                  <Badge variant="outline">
                    {mpLabel[d.marketplace] || d.marketplace} · {d.supplyType}
                  </Badge>
                  {d.cluster && (
                    <span className="text-xs text-muted-foreground">{d.cluster}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {/* Водитель и машина — то, по чему руководитель узнаёт конкретный
                      выезд: номеров поставок он наизусть не помнит. */}
                  {d.driverName || 'Водитель не указан'}
                  {d.vehicleNumber ? ` · ${d.vehicleNumber}` : ''}
                  {d.cargoPlaces ? ` · мест: ${d.cargoPlaces}` : ''}
                  {d.deliveryAt ? ` · сдача ${fmtDate(d.deliveryAt)}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  На подписи с {formatDateTime(d.updatedAt)}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                {/* Прямой переход в Диадок появляется только когда известен номер
                    документа у оператора — до интеграции его вносят вручную. */}
                {d.operatorDocId && (
                  <Button size="sm" asChild>
                    <a
                      href="https://diadoc.kontur.ru/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="PenLine" size={14} className="mr-1.5" />
                      Подписать в Диадоке
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/crm/shipments/to-marketplace/${d.supplyId}`)}
                >
                  Открыть поставку
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default EtrnToSignCard;
