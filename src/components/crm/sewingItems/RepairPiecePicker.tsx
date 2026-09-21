import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchSuitablePieces,
  takeRepairPiece,
  type RepairPiece,
} from '@/lib/repairFabricApi';

interface RepairPiecePickerProps {
  orderId: number;
  /** Обновить карточку заказа после того, как кусок взят. */
  onUsed?: () => void;
}

/**
 * ВЫБОР КУСКА ИЗ ПЕРЕШИВА ПОД КОНКРЕТНЫЙ ЗАКАЗ.
 *
 * ЗАЧЕМ. Раньше куски «распускались» в рулоны и превращались в обезличенные
 * метры: закройщик знал, что где-то в цехе лежит подходящий отрез, но найти
 * его мог только перебрав всё вручную. Чаще проще было взять новый рулон —
 * и годный кусок так и лежал до списания.
 *
 * ЧТО ПОКАЗЫВАЕМ. Только куски, которыми РЕАЛЬНО можно сшить этот заказ:
 *   * материал строго тот же — в карточке вуали не будет льна;
 *   * размер НЕ МЕНЬШЕ заказа по обеим сторонам.
 *
 * Из куска 300×255 штору 400×265 не сшить — такой кусок в список не попадёт
 * вовсе, даже если по одной стороне подходит. Это главная защита от ошибки:
 * закройщик физически не может выбрать неподходящий отрез.
 *
 * Сверху идут наименее расточительные куски: если есть впритык — он первый,
 * чтобы большой отрез не пустили на маленький заказ.
 */
const RepairPiecePicker = ({ orderId, onUsed }: RepairPiecePickerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [pieces, setPieces] = useState<RepairPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [takingId, setTakingId] = useState<number | null>(null);
  const [orderInfo, setOrderInfo] = useState<{
    material: string | null;
    width: number | null;
    height: number | null;
  } | null>(null);

  const load = () => {
    setLoading(true);
    fetchSuitablePieces(orderId)
      .then((r) => {
        setPieces(r.pieces);
        setOrderInfo(r.order);
      })
      .catch(() => setPieces([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId]);

  // Кусков нет — блок не показываем вовсе. Пустая карточка «ничего не найдено»
  // только загромождает экран: закройщик берёт рулон, как и раньше.
  if (!loading && pieces.length === 0) return null;

  const handleTake = async (piece: RepairPiece) => {
    setTakingId(piece.id);
    try {
      await takeRepairPiece(piece.id, orderId, { id: user?.id, name: user?.name });
      toast({
        title: 'Кусок взят в работу',
        description: `${piece.material} ${piece.width}×${piece.height} списан со склада перешива`,
      });
      load();
      onUsed?.();
    } catch (e) {
      toast({
        title: 'Не удалось взять кусок',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      // Кусок мог уйти другому закройщику — перечитываем список.
      load();
    } finally {
      setTakingId(null);
    }
  };

  return (
    <Card className="border-violet-300 bg-violet-50/60 shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div>
          <p className="flex items-center gap-2 font-semibold text-violet-900">
            <Icon name="Scissors" size={16} />
            Есть куски на перешив — можно не брать рулон
          </p>
          <p className="text-sm text-violet-900/80">
            {orderInfo?.material} {orderInfo?.width}×{orderInfo?.height} — показаны
            только куски, которых хватит на этот заказ
          </p>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={14} className="animate-spin" />
            Ищем подходящие куски…
          </p>
        ) : (
          <div className="space-y-1.5">
            {pieces.map((p) => {
              const exact = !p.extraWidth && !p.extraHeight;
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-white p-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.material} {p.width}×{p.height}
                      {/* Отрез впритык — самый выгодный, помечаем его явно. */}
                      {exact && (
                        <Badge className="ml-2 bg-emerald-600 text-white hover:bg-emerald-600">
                          точный размер
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {exact
                        ? 'Ровно под заказ, без обрезков'
                        : `Запас: +${p.extraWidth} см по ширине, +${p.extraHeight} см по высоте`}
                      {p.createdByName ? ` · отправил(а) ${p.createdByName}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0 bg-violet-600 text-white hover:bg-violet-700"
                    onClick={() => handleTake(p)}
                    disabled={takingId !== null}
                  >
                    <Icon
                      name={takingId === p.id ? 'Loader2' : 'Check'}
                      size={14}
                      className={`mr-1.5 ${takingId === p.id ? 'animate-spin' : ''}`}
                    />
                    Взять
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RepairPiecePicker;
