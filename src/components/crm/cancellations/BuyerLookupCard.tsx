import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchBuyerCard, type BuyerCard } from '@/lib/cancellationAnalyticsApi';

const fmt = (s: string | null) =>
  s
    ? new Date(s).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * Поиск покупателя по лицевому счёту.
 *
 * Зачем: в поддержку OZON пишут по КОНКРЕТНОМУ случаю, и первое, что нужно, —
 * номера отправлений этого человека. Раньше их доставали из выгрузки или архива;
 * теперь достаточно ввести счёт и скопировать список одной кнопкой.
 */
const BuyerLookupCard = ({ days }: { days: number }) => {
  const { toast } = useToast();
  const [key, setKey] = useState('');
  const [card, setCard] = useState<BuyerCard | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    const value = key.trim();
    if (!value) return;
    setLoading(true);
    try {
      setCard(await fetchBuyerCard(value, days));
    } catch (e) {
      toast({
        title: 'Не удалось найти покупателя',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Номера отправлений — то, что просят приложить к обращению. Копируем списком,
  // чтобы не выписывать вручную из таблицы.
  const copyPostings = async () => {
    const list = (card?.postings || []).map((p) => p.posting).join('\n');
    try {
      await navigator.clipboard.writeText(list);
      toast({ title: 'Номера скопированы', description: 'Вставьте их в обращение' });
    } catch {
      toast({ title: 'Браузер не дал скопировать', variant: 'destructive' });
    }
  };

  const b = card?.buyer;

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Search" size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Поиск по лицевому счёту</p>
            <p className="text-xs text-muted-foreground">
              Введите номер счёта — покажем все заказы этого покупателя за всё время
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Например, 09482768"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            inputMode="numeric"
          />
          <Button onClick={search} disabled={loading || !key.trim()}>
            <Icon
              name={loading ? 'Loader2' : 'Search'}
              size={16}
              className={loading ? 'animate-spin' : ''}
            />
          </Button>
        </div>

        {card && !card.found && (
          <p className="text-sm text-muted-foreground">
            Заказов с таким лицевым счётом не нашлось. Проверьте номер — это первая
            часть номера отправления, до первого дефиса.
          </p>
        )}

        {card?.found && b && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border p-3">
              <div>
                <p className="text-xs text-muted-foreground">Вероятность скупки</p>
                <p
                  className={`text-2xl font-bold ${
                    b.probability >= 70 ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {b.probability > 0 ? `${b.probability}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Заказал</p>
                <p className="text-2xl font-bold">{b.totalItems}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Отменил</p>
                <p className="text-2xl font-bold text-destructive">{b.cancelledItems}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Выкупил</p>
                <p className="text-2xl font-bold">{b.aliveItems}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Заказов</p>
                <p className="text-2xl font-bold">{b.ordersCount}</p>
              </div>
            </div>

            {b.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {b.flags.map((f) => (
                  <Badge key={f} variant="outline" className="font-normal">
                    {f}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                Отправления: {card.postings?.length || 0}
              </p>
              <Button size="sm" variant="outline" onClick={copyPostings}>
                <Icon name="Copy" size={14} className="mr-1.5" />
                Скопировать номера
              </Button>
            </div>

            <div className="max-h-80 overflow-auto rounded-md border">
              {(card.postings || []).map((p) => (
                <div
                  key={p.posting}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b p-2.5 text-sm last:border-b-0 ${
                    p.cancelled ? 'bg-rose-50' : ''
                  }`}
                >
                  <span className="font-mono font-medium">{p.posting}</span>
                  <Badge
                    variant={p.cancelled ? 'destructive' : 'secondary'}
                    className="font-normal"
                  >
                    {p.statusLabel}
                  </Badge>
                  <span className="text-muted-foreground">{p.product}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    заказан {fmt(p.createdAt)}
                    {p.cancelledAt ? ` · отменён ${fmt(p.cancelledAt)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BuyerLookupCard;
