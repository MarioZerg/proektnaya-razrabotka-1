import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { SiteReturn, SiteReturns } from '@/lib/returnCodesApi';

const groupStyle: Record<SiteReturn['group'], string> = {
  ready: 'bg-emerald-100 text-emerald-800',
  coming: 'bg-sky-100 text-sky-800',
  problem: 'bg-red-100 text-red-800',
  done: 'bg-muted text-muted-foreground',
};

interface SiteReturnsPanelProps {
  data: SiteReturns | null;
  isAdmin: boolean;
}

/**
 * ВОЗВРАТЫ МЕГАТЮЛЬ.РФ ПО OZON ДОСТАВКЕ.
 *
 * Сайт отправляет посылки через Ozon Доставку для интернет-магазинов — это
 * отдельный кабинет со своим штрихкодом возвратов (карточка выше) и своим
 * списком возвратов. Здесь видно, что едет обратно, что уже ждёт нас в пункте
 * выдачи и где именно.
 */
const SiteReturnsPanel = ({ data, isAdmin }: SiteReturnsPanelProps) => {
  if (!data || !data.connected) {
    return (
      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="space-y-2 py-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="KeyRound" size={16} />
            Ozon Доставка не подключена
          </p>
          <p>
            Посылки сайта ездят через Ozon Доставку — у неё свой штрихкод возвратов.
            Впишите Client ID и Client Secret из кабинета Ozon Доставки в «Интеграции»,
            магазин «мегатюль.рф».
          </p>
          {data?.error && <p className="text-destructive">{data.error}</p>}
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/crm/settings/marketplace-integrations">
                <Icon name="Settings" size={14} className="mr-1.5" />
                Открыть «Интеграции»
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const ready = data.returns.filter((r) => r.group === 'ready');
  const coming = data.returns.filter((r) => r.group === 'coming').length;
  // Куда ехать: пункты, где возвраты уже ждут нас.
  const places = Array.from(
    new Map(ready.map((r) => [`${r.place}|${r.address}`, r])).values(),
  );

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icon name="Undo2" fallback="RotateCcw" size={16} />
          Возвраты посылок сайта
          {ready.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              ждут нас: {ready.length}
            </span>
          )}
          {coming > 0 && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
              едут: {coming}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{data.error}</p>
        )}

        {places.length > 0 && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">
            <p className="font-medium">Куда ехать — покажите там штрихкод «Ozon Доставка»:</p>
            {places.map((r) => (
              <p key={`${r.place}|${r.address}`}>
                {r.place || 'Пункт выдачи'}
                {r.address ? ` — ${r.address}` : ''}
              </p>
            ))}
          </div>
        )}

        {data.returns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Возвратов нет — все посылки сайта у покупателей или в пути к ним
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.returns.map((r) => (
              <li key={r.number || r.barcode || r.orderNumber || ''} className="space-y-0.5 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${groupStyle[r.group]}`}>
                    {r.statusText}
                  </span>
                  <span className="font-medium">{r.orderNumber || r.number}</span>
                  <span className="text-xs text-muted-foreground">{r.type}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.changedAt ? formatDateTime(r.changedAt) : ''}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[r.description, r.reason, r.place].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default SiteReturnsPanel;
