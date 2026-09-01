import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { fetchVarikiPlayers, debitVariki, type VarikiPlayer } from '@/lib/varikiApi';

interface LototronCardProps {
  actorId?: number;
}

/** Карточка админа: лототрон на внутреннюю валюту «Варики». Показывает игроков с их
 * балансом (кто накопил на игру — подсвечен), позволяет списать варики выбранному игроку. */
const LototronCard = ({ actorId }: LototronCardProps) => {
  const { toast } = useToast();
  const [players, setPlayers] = useState<VarikiPlayer[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [selectedId, setSelectedId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetchVarikiPlayers().then(({ players: p, threshold: t }) => {
      setPlayers(p);
      setThreshold(t);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const handleDebit = async () => {
    const uid = Number(selectedId);
    const amt = Number(amount);
    if (!uid || !amt || amt <= 0) {
      toast({ title: 'Выберите игрока и количество вариков', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await debitVariki(uid, amt, actorId);
      toast({ title: 'Варики списаны', description: `Списано ${amt} вариков` });
      setAmount('');
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const readyPlayers = players.filter((p) => p.canPlay);

  return (
    <Card className="border-amber-300 bg-amber-50/40 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon name="Coins" size={18} className="text-amber-500" />
          Лототрон · Списание вариков
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Порог для игры — {threshold} вариков. Готовы играть: {readyPlayers.length}.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1 space-y-1.5">
            <Label>Игрок</Label>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите игрока" />
              </SelectTrigger>
              <SelectContent>
                {players.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет игроков</div>
                ) : (
                  players.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.fullName} — {p.variki} шт
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28 space-y-1.5">
            <Label>Списать</Label>
            <Input
              type="number"
              min={1}
              placeholder="Кол-во"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button onClick={handleDebit} disabled={saving}>
            <Icon name={saving ? 'Loader2' : 'Ticket'} size={16} className={`mr-1.5 ${saving ? 'animate-spin' : ''}`} />
            Сыграть
          </Button>
        </div>

        <div className="max-h-52 space-y-1 overflow-y-auto">
          {players.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-0"
            >
              <span className="truncate text-sm">{p.fullName}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-sm font-semibold">{p.variki}</span>
                <Icon name="Coins" size={13} className="text-amber-500" />
                {p.canPlay && (
                  <Badge className="bg-amber-500 text-white hover:bg-amber-500">Готов</Badge>
                )}
              </span>
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-sm text-muted-foreground">Пока нет игроков с вариками.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default LototronCard;