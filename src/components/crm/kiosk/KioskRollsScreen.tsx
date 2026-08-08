import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchRolls, closeRoll, type Roll } from '@/lib/rollsApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollsScreenProps {
  workshopId: number;
  /** Смена сотрудника — показываем рулоны только его смены. */
  shiftNumber: number | null;
  /** Сотрудник терминала — по нему определяем движение материала в текущей смене. */
  userId: number;
  /** Имя закройщика — попадает в статистику недостач по рулонам. */
  userName?: string;
  /** Роль сотрудника — определяет, с рулонами какого типа он может работать. */
  role: string;
}

/** С какими типами материалов работает роль: закройщик — ткань (Тюль), швея — тесьма
 * (Аксессуары), упаковщица — пакеты и этикетки (Упаковка). */
const allowedTypesByRole: Record<string, string[]> = {
  cutter: ['Тюль'],
  sewer: ['Аксессуары'],
  packer: ['Упаковка'],
};

/** Экран работы с рулонами на терминале: закройщик закрывает рулоны, у которых закончился
 * метраж. Если ткань кончилась раньше — указывает недостачу цифровой клавиатурой. */
const KioskRollsScreen = ({ workshopId, shiftNumber, userId, userName, role }: KioskRollsScreenProps) => {
  const { toast } = useToast();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Roll | null>(null);
  const [shortage, setShortage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchRolls({ status: 'in_workshop', usedSinceUserId: userId }),
      fetchMaterialsData(),
    ])
      .then(([list, matData]) => {
        // Показываем рулоны только своего цеха и только своей смены.
        setRolls(
          list.filter(
            (r) =>
              r.workshopId === workshopId &&
              (shiftNumber == null || r.shiftNumber === shiftNumber)
          )
        );
        setMaterials(matData.materials);
        setTypes(matData.types);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId, shiftNumber, userId]);

  const typeIdByMaterial = new Map(materials.map((m) => [m.id, m.typeId]));
  // Роль работает только со «своими» типами материалов (закройщик — ткань, швея — тесьма,
  // упаковщица — упаковка). Остальным ролям показываем всё.
  const allowedNames = allowedTypesByRole[role];
  const visibleTypes = allowedNames ? types.filter((t) => allowedNames.includes(t.name)) : types;
  const allowedTypeIds = new Set(visibleTypes.map((t) => t.id));

  const roleRolls = allowedNames
    ? rolls.filter((r) => {
        const tid = typeIdByMaterial.get(r.materialId);
        return tid != null && allowedTypeIds.has(tid);
      })
    : rolls;

  const visibleRolls =
    typeFilter === 'all'
      ? roleRolls
      : roleRolls.filter((r) => typeIdByMaterial.get(r.materialId) === typeFilter);

  const handleClose = async (withShortage: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      await closeRoll(selected.id, withShortage ? Number(shortage) || 0 : 0, userId, userName);
      toast({
        title: 'Рулон закрыт',
        description: withShortage && Number(shortage) > 0 ? `Недостача: ${shortage} ${selected.unit}` : undefined,
      });
      setSelected(null);
      setShortage('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось закрыть рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const pressDigit = (d: string) => setShortage((s) => (s + d).slice(0, 6));
  const pressDot = () => setShortage((s) => (s.includes('.') ? s : `${s || '0'}.`));
  const pressBack = () => setShortage((s) => s.slice(0, -1));

  if (selected) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">Рулон</p>
            <p className="font-mono-tech text-2xl font-bold">#{selected.barcode}</p>
            <p className="mt-1 text-lg">
              {selected.materialName} · остаток {formatQuantity(selected.remainingQuantity)}{' '}
              {selected.unit}
            </p>
          </div>

          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-sm text-muted-foreground">Недостача (если ткань закончилась раньше)</p>
            <p className="font-mono-tech text-3xl font-bold">{shortage || '0'}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Button key={d} variant="outline" className="h-16 text-2xl" onClick={() => pressDigit(d)}>
                {d}
              </Button>
            ))}
            <Button variant="outline" className="h-16 text-2xl" onClick={pressDot}>
              ,
            </Button>
            <Button variant="outline" className="h-16 text-2xl" onClick={() => pressDigit('0')}>
              0
            </Button>
            <Button variant="outline" className="h-16" onClick={pressBack}>
              <Icon name="Delete" size={24} />
            </Button>
          </div>

          <Button
            size="lg"
            className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
            onClick={() => handleClose(true)}
            disabled={saving}
          >
            <Icon
              name={saving ? 'Loader2' : 'Check'}
              size={24}
              className={`mr-2 ${saving ? 'animate-spin' : ''}`}
            />
            Закрыть рулон
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full"
            onClick={() => {
              setSelected(null);
              setShortage('');
            }}
          >
            Отмена
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Фильтр по типу материала: Ткань (Тюль), Аксессуары, Упаковка */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={typeFilter === 'all' ? 'default' : 'outline'}
          className="h-12 text-base"
          onClick={() => setTypeFilter('all')}
        >
          Все
        </Button>
        {visibleTypes.map((t) => (
          <Button
            key={t.id}
            variant={typeFilter === t.id ? 'default' : 'outline'}
            className="h-12 text-base"
            onClick={() => setTypeFilter(t.id)}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Icon name="Loader2" size={24} className="animate-spin" />
          Загрузка…
        </div>
      ) : visibleRolls.length === 0 ? (
        <p className="py-10 text-center text-lg text-muted-foreground">
          В вашей смене нет открытых рулонов
        </p>
      ) : (
        visibleRolls.map((r) => {
          // Рулон доступен, только если по нему уже было движение материала в этой смене
          // и поставка принята: непринятый материал мог не доехать, работать с ним нельзя.
          const active = !!r.usedInShift && !r.pendingAcceptance;
          return (
            <button
              key={r.id}
              onClick={() => active && setSelected(r)}
              disabled={!active}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left ${
                active ? 'hover:bg-accent' : 'cursor-not-allowed opacity-40 grayscale'
              }`}
            >
              <div className="min-w-0">
                <div className="font-mono-tech text-lg font-bold">#{r.barcode}</div>
                <div className="text-muted-foreground">{r.materialName}</div>
                {r.pendingAcceptance ? (
                  <div className="text-xs font-medium text-amber-600">
                    Не принят — подтвердите поставку
                  </div>
                ) : (
                  !active && (
                    <div className="text-xs text-muted-foreground">Нет движения в смене</div>
                  )
                )}
              </div>
              <Badge variant="secondary" className="shrink-0 text-base">
                {formatQuantity(r.remainingQuantity)} {r.unit}
              </Badge>
            </button>
          );
        })
      )}
    </div>
  );
};

export default KioskRollsScreen;