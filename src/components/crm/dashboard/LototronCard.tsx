import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchVarikiPlayers,
  debitVariki,
  creditVariki,
  type VarikiPlayer,
} from '@/lib/varikiApi';

interface LototronCardProps {
  actorId?: number;
}

type Mode = 'debit' | 'credit';

/**
 * Лототрон: внутренняя валюта «Варики» глазами администратора.
 *
 * Две операции живут в ОДНОЙ форме, а не в двух карточках: и списание за игру,
 * и ручное начисление — это одно и то же действие «поменять баланс человеку»,
 * отличается только знак. Две отдельные формы с одинаковыми полями админ путал
 * бы между собой, и цена ошибки тут прямая — деньги игрока.
 *
 * Начисление руками нужно потому, что автоматика знает только про заказы: она
 * не видит, что человек вышел в выходной или разобрал чужой завал. Причина
 * начисления уходит в журнал.
 */
const LototronCard = ({ actorId }: LototronCardProps) => {
  const { toast } = useToast();
  const [players, setPlayers] = useState<VarikiPlayer[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [selectedId, setSelectedId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<Mode>('debit');
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    fetchVarikiPlayers().then(({ players: p, threshold: t }) => {
      setPlayers(p);
      setThreshold(t);
    });
  };

  useEffect(load, []);

  const readyPlayers = useMemo(() => players.filter((p) => p.canPlay), [players]);
  const selected = players.find((p) => String(p.id) === selectedId) || null;

  const submit = async () => {
    const uid = Number(selectedId);
    const amt = Number(amount);
    if (!uid || !amt || amt <= 0) {
      toast({ title: 'Выберите сотрудника и количество вариков', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (mode === 'debit') {
        await debitVariki(uid, amt, actorId);
        toast({ title: 'Варики списаны', description: `Списано ${amt} у ${selected?.fullName}` });
      } else {
        await creditVariki(uid, amt, actorId, reason);
        toast({
          title: 'Варики начислены',
          description: `${selected?.fullName} получил +${amt}${reason ? ` — ${reason}` : ''}`,
        });
      }
      setAmount('');
      setReason('');
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // По умолчанию показываем только тех, кто дошёл до порога, плюс несколько
  // ближайших: полный список — это весь производственный штат, и он превращал
  // карточку в бесконечную ленту фамилий с нулями.
  const visible = showAll ? players : players.slice(0, Math.max(readyPlayers.length, 5));

  return (
    <div className="space-y-3">
      {/* Итог сверху: сколько человек дошло до порога — ради этого сюда и заходят. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <Icon name="Coins" size={16} className="shrink-0 text-amber-600" />
        <p className="text-sm text-amber-900">
          Готовы играть: <b>{readyPlayers.length}</b>
        </p>
        <span className="ml-auto text-xs text-amber-800">порог {threshold} вариков</span>
      </div>

      {/* Одна форма на оба действия: сотрудник → сколько → что делаем. */}
      <div className="space-y-2 rounded-lg border p-3">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {(
            [
              { key: 'debit', label: 'Списать за игру', icon: 'Ticket' },
              { key: 'credit', label: 'Начислить', icon: 'Plus' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                mode === m.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={m.icon} size={13} />
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedId} onValueChange={setSelectedId} disabled={saving}>
            <SelectTrigger className="sm:flex-1">
              <SelectValue placeholder="Сотрудник" />
            </SelectTrigger>
            <SelectContent>
              {players.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет сотрудников</div>
              ) : (
                players.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.fullName} — {p.variki}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Кол-во"
              className="w-24 sm:w-28"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button
              onClick={submit}
              disabled={saving}
              className="flex-1 sm:flex-none"
              variant={mode === 'credit' ? 'default' : 'secondary'}
            >
              <Icon
                name={saving ? 'Loader2' : mode === 'debit' ? 'Ticket' : 'Plus'}
                size={16}
                className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
              />
              {mode === 'debit' ? 'Сыграть' : 'Начислить'}
            </Button>
          </div>
        </div>

        {/* Причина — только у начисления: списание всегда одно и то же (игра),
            а вот «за что дали» через месяц не вспомнит никто. */}
        {mode === 'credit' && (
          <Input
            placeholder="За что начисляем (попадёт в журнал)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
        )}

        {mode === 'debit' && selected && !selected.canPlay && (
          <p className="text-xs text-amber-700">
            У {selected.fullName} {selected.variki} — до порога не хватает{' '}
            {threshold - selected.variki}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="divide-y">
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(String(p.id))}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50 ${
                String(p.id) === selectedId ? 'bg-accent' : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-sm">{p.fullName}</span>
              {p.canPlay && (
                <Badge className="shrink-0 bg-amber-500 text-white hover:bg-amber-500">
                  Готов
                </Badge>
              )}
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                <span className="text-sm font-semibold">{p.variki}</span>
                <Icon name="Coins" size={13} className="text-amber-500" />
              </span>
            </button>
          ))}
          {players.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Пока нет игроков с вариками.</p>
          )}
        </div>
        {players.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full border-t bg-muted/40 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Показать всех — ещё {players.length - visible.length}
          </button>
        )}
        {showAll && players.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="w-full border-t bg-muted/40 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Свернуть
          </button>
        )}
      </div>
    </div>
  );
};

export default LototronCard;
