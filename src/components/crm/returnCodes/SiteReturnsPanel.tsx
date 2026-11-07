import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dateUtils';
import { printLabelPdf } from '@/lib/printMarketplaceLabel';
import {
  fetchSiteReturnDocument,
  type SiteReturnParcel,
  type SiteReturns,
} from '@/lib/returnCodesApi';

const groupStyle: Record<SiteReturnParcel['group'], string> = {
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
 * ВОЗВРАТЫ МЕГАТЮЛЬ.РФ — ВМЕСТО ШТРИХКОДА ПВЗ.
 *
 * Сайт отправляет посылки через Ozon Доставку для интернет-магазинов. Штрихкода
 * для пункта выдачи там нет: отказы и невостребованное едут на склад возврата,
 * и там их выдают нам по расходному документу. Поэтому здесь адрес склада,
 * посылки по трекингу Ozon и документы на выдачу.
 */
const SiteReturnsPanel = ({ data, isAdmin }: SiteReturnsPanelProps) => {
  const { toast } = useToast();
  const [printing, setPrinting] = useState<string | null>(null);

  if (!data || !data.connected) {
    return (
      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="space-y-2 py-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="KeyRound" size={16} />
            Ozon Доставка не подключена
          </p>
          <p>
            Посылки сайта ездят через Ozon Доставку: штрихкода для ПВЗ у неё нет,
            возвраты выдают на складе возврата по документу. Чтобы видеть, что
            едет обратно, впишите ключи Rocket API (Client ID и Client Secret из
            кабинета Ozon Доставки, «Настройки → Интеграция API»).
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

  const ready = data.parcels.filter((p) => p.group === 'ready').length;
  const coming = data.parcels.filter((p) => p.group === 'coming').length;

  const printDoc = async (id: string, number: string | null) => {
    setPrinting(id);
    try {
      await printLabelPdf(await fetchSiteReturnDocument(id), `Документ на возврат ${number || ''}`);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать документ',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(null);
    }
  };

  return (
    <div className="space-y-4">
      {data.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{data.error}</p>
      )}

      <Card className="border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon name="MapPin" size={16} />
            Куда ехать за возвратами
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {data.places.length === 0 ? (
            <p className="text-muted-foreground">Ozon Доставка не сообщила склад возврата</p>
          ) : (
            data.places.map((p) => (
              <p key={String(p.id)}>
                <span className="font-medium">{p.name || 'Склад возврата'}</span>
                {p.city || p.address ? ` — ${[p.city, p.address].filter(Boolean).join(', ')}` : ''}
              </p>
            ))
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            Штрихкода нет: посылки выдают по расходному документу (ниже).
          </p>
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Icon name="Undo2" fallback="RotateCcw" size={16} />
            Посылки, которые возвращаются
            {ready > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                ждут нас: {ready}
              </span>
            )}
            {coming > 0 && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                в пути: {coming}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.parcels.length === 0 ? (
            <p className="text-sm text-muted-foreground">Возвратов нет — все посылки у покупателей или в пути к ним</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.parcels.map((p) => (
                <li key={`${p.orderId}-${p.tracking}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${groupStyle[p.group]}`}>
                    {p.statusText}
                  </span>
                  <span className="font-medium">{p.siteOrder || p.orderNumber}</span>
                  <span className="text-muted-foreground">{p.product}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {p.tracking}
                    {p.at ? ` · ${formatDateTime(p.at)}` : ''}
                    {p.place ? ` · ${p.place}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon name="FileText" size={16} />
            Документы на выдачу возвратов
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">За 60 дней документов на выдачу нет</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-medium">№{d.number || d.id}</span>
                  <span className="text-muted-foreground">
                    {[d.date ? formatDateTime(d.date) : null, d.state, d.place].filter(Boolean).join(' · ')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={printing === d.id}
                    onClick={() => printDoc(d.id, d.number)}
                  >
                    <Icon
                      name={printing === d.id ? 'Loader2' : 'Printer'}
                      size={14}
                      className={`mr-1.5 ${printing === d.id ? 'animate-spin' : ''}`}
                    />
                    Печать
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SiteReturnsPanel;
