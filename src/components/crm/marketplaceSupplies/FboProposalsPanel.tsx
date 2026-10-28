import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  acceptFboProposal,
  buildFboProposals,
  fetchFboProposals,
  rejectFboProposal,
  type FboProposal,
} from '@/lib/marketplaceSuppliesApi';

interface FboProposalsPanelProps {
  shopId: number | null;
  actorId?: number;
  actorName?: string;
  isAdmin: boolean;
  onOpenSupply: (id: number) => void;
}

/** Список автопредложений FBO текущего магазина. */
const FboProposalsPanel = ({
  shopId,
  actorId,
  actorName,
  isAdmin,
  onOpenSupply,
}: FboProposalsPanelProps) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<FboProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!shopId) return;
    setLoading(true);
    // База иногда коротко отвечает «перегружена» — повторяем, а не показываем пустоту.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetchFboProposals(shopId, actorId, isAdmin ? 'admin' : undefined);
        setRows(res.proposals || []);
        setError(null);
        break;
      } catch (e) {
        if (attempt === 2) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить предложки');
        } else {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    setRows([]);
    load();
    // Магазин сменился — список другой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, isAdmin]);

  const form = async () => {
    if (!shopId) return;
    setBusy(true);
    try {
      const res = await buildFboProposals(shopId, actorId, 'admin');
      setRows(res.proposals || []);
      const skipped = (res.skipped || []).filter(Boolean);
      toast({
        title: res.created?.length
          ? `Предложки: ${res.created.join(', ')}`
          : 'Новых предложек нет',
        description: skipped.length ? skipped.join('\n') : undefined,
      });
    } catch (e) {
      toast({
        title: 'Не удалось сформировать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id: number) => {
    if (!shopId) return;
    setBusy(true);
    try {
      const res = await acceptFboProposal(shopId, id, actorId, actorName, 'admin');
      toast({
        title: 'Поставка создана',
        description:
          [
            res.ozonStorage
              ? `Ozon назначил склад ${res.ozonStorage} (в предложке был ${res.proposedStorage}) — поставка переписана на него`
              : '',
            res.toSewing
              ? `Со склада: ${res.fromStock ?? 0} шт., недостающие ${res.toSewing} шт. ушли в пошив`
              : '',
            res.ozonError || '',
          ]
            .filter(Boolean)
            .join('. ') || undefined,
        variant: res.ozonError ? 'destructive' : 'default',
      });
      if (res.supplyId) onOpenSupply(res.supplyId);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      // Список обновляем и при ошибке: видно, открыта ли предложка снова.
      load();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (id: number) => {
    if (!shopId) return;
    setBusy(true);
    try {
      await rejectFboProposal(shopId, id, actorId, 'admin');
      toast({ title: 'Предложка отклонена, вещи снова на полках' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отклонить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Предложка собирается на регион Ozon: конкретный склад внутри региона Ozon назначает
          сам при бронировании, и поставка автоматически переписывается на него. Вещи в
          предложке не уходят в подбор, пока её не подтвердят или не отклонят.
          {' '}Если до дня Газельки предложку не подтвердили, она закрывается сама и вещи
          возвращаются в подбор.
        </p>
        {isAdmin ? (
          <Button type="button" onClick={form} disabled={busy || !shopId}>
            <Icon name={busy ? 'Loader2' : 'Sparkles'} size={16} className={`mr-2 ${busy ? 'animate-spin' : ''}`} />
            Сформировать
          </Button>
        ) : (
          <p className="text-sm font-medium">Подтверждает или отклоняет администратор.</p>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Загрузка предложек…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Открытых предложек нет.</p>
      )}
      {rows.map((row) => (
        <article key={row.id} className="space-y-3 rounded-xl border-2 border-teal-600 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold underline">Регион: {row.cluster}</h2>
              <p className="text-sm">
                {row.pieces} шт.
                {row.pieces < 50 ? ' — меньше 50, подтвердить нельзя' : ''}
              </p>
              <p className="text-sm">
                В Газельку {row.gazelkaDate || '—'}
                {' · '}
                на воротах {row.gateDate || '—'}
                {row.gateTimeslot ? `, ${row.gateTimeslot}` : ''}
              </p>
            </div>
            {isAdmin && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => reject(row.id)}>
                Отклонить
              </Button>
              <Button type="button" disabled={busy} onClick={() => accept(row.id)}>
                Создать поставку
              </Button>
            </div>
            )}
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {row.articles.map((article) => (
              <li key={article.name} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>{article.name}</span>
                <span className="shrink-0 font-medium">
                  {article.quantity} шт. · {article.popular ? 'ходовой' : 'не ходовой'}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
};

export default FboProposalsPanel;
