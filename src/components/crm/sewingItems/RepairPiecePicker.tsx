import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchReservedPiece,
  fetchSuitablePieces,
  releaseRepairPiece,
  takeRepairPiece,
  type RepairPiece,
} from '@/lib/repairFabricApi';

interface RepairPiecePickerProps {
  orderId: number;
  /**
   * Вещь сейчас на раскрое — только тогда предлагаем куски.
   *
   * Дальше по конвейеру («Раскроено», «В работе», «Стикеровка», «Готовые»)
   * ткань уже разрезана: подбирать отрез нечему. Если бы список остался,
   * закройщик мог закрепить кусок за вещью, которую никто не будет кроить, —
   * отрез ушёл бы в резерв навсегда и пропал из перешива.
   */
  canTake?: boolean;
  /** Обновить карточку заказа после того, как кусок взят или откреплён. */
  onUsed?: () => void;
  /**
   * Кусок закреплён за заказом (или откреплён — null).
   *
   * По этому карточка прячет выбор рулона: ткань уже взята с перешива,
   * резать ещё и от рулона нельзя.
   */
  onReservedChange?: (piece: RepairPiece | null) => void;
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
 *
 * КУСОК ВЗЯТ — ВЫБОР ОКОНЧЕН, НО НЕ НАВСЕГДА.
 *
 * Раньше «Взять» списывало отрез мгновенно, а рядом в карточке как ни в чём
 * не бывало оставался выбор рулона: ткань уже на столе, а система предлагает
 * отрезать ещё. Передумать было нельзя — из перешива кусок исчезал, и вернуть
 * его было нечем.
 *
 * Теперь кусок закрепляется за заказом: список подбора сменяется карточкой
 * «взято с перешива», выбор рулона в карточке пропадает, а рядом стоит
 * «Открепить» — кусок вернётся в перешив к остальным, и рулоны появятся снова.
 */
const RepairPiecePicker = ({
  orderId,
  canTake = true,
  onUsed,
  onReservedChange,
}: RepairPiecePickerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [pieces, setPieces] = useState<RepairPiece[]>([]);
  const [reserved, setReserved] = useState<RepairPiece | null>(null);
  const [loading, setLoading] = useState(true);
  const [takingId, setTakingId] = useState<number | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [orderInfo, setOrderInfo] = useState<{
    material: string | null;
    width: number | null;
    height: number | null;
  } | null>(null);

  const applyReserved = (piece: RepairPiece | null) => {
    setReserved(piece);
    onReservedChange?.(piece);
  };

  const load = () => {
    setLoading(true);
    // Сначала спрашиваем, не закреплён ли уже кусок: если да, подбирать нечего —
    // показываем взятый отрез и кнопку «Открепить».
    // Когда вещь ушла с раскроя, подбор не запрашиваем вовсе — но уже взятый
    // кусок всё равно читаем: швея и админ должны видеть, из чего вещь скроена.
    Promise.all([
      fetchReservedPiece(orderId),
      canTake ? fetchSuitablePieces(orderId) : Promise.resolve(null),
    ])
      .then(([res, sug]) => {
        applyReserved(res.piece);
        setPieces(sug?.pieces ?? []);
        setOrderInfo(sug?.order ?? null);
      })
      .catch(() => {
        setPieces([]);
        applyReserved(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId, canTake]);

  const handleTake = async (piece: RepairPiece) => {
    setTakingId(piece.id);
    try {
      await takeRepairPiece(piece.id, orderId, { id: user?.id, name: user?.name });
      toast({
        title: 'Кусок закреплён за заказом',
        description: `${piece.material} ${piece.width}×${piece.height} — рулон для этой вещи брать не нужно`,
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

  const handleRelease = async () => {
    setReleasing(true);
    try {
      await releaseRepairPiece({ orderId }, { id: user?.id, name: user?.name });
      toast({
        title: 'Кусок возвращён в перешив',
        description: 'Он снова в общем списке. Для этой вещи выберите рулон',
      });
      load();
      onUsed?.();
    } catch (e) {
      toast({
        title: 'Не удалось открепить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      load();
    } finally {
      setReleasing(false);
    }
  };

  // ТКАНЬ УЖЕ ВЗЯТА С ПЕРЕШИВА.
  //
  // Показываем ровно один отрез — тот, что закреплён, — и кнопку вернуть его
  // обратно. Списка подбора здесь быть не должно: выбор сделан, второй кусок
  // на ту же вещь не берут.
  if (reserved) {
    // Открепить можно, только пока вещь на раскрое и кусок не пущен в дело.
    // Если заказ ушёл дальше по конвейеру, ткань фактически уже в изделии —
    // возвращать её в перешив нечем.
    const cut = reserved.status === 'used' || !canTake;
    return (
      <Card className="border-violet-400 bg-violet-50 shadow-none">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-violet-900">
              <Icon name="Scissors" size={16} />
              Ткань взята с перешива — рулон не нужен
            </p>
            <p className="text-sm text-violet-900">
              {reserved.material} {reserved.width}×{reserved.height}
              {reserved.usedByName ? ` · взял(а) ${reserved.usedByName}` : ''}
            </p>
            <p className="text-xs text-violet-900/70">
              {cut
                ? 'Кусок уже раскроен — вернуть его в перешив нельзя'
                : 'Пока вещь не раскроена, кусок можно вернуть в перешив и взять рулон'}
            </p>
          </div>
          {cut ? (
            <Badge variant="secondary">Раскроен</Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-violet-400 bg-white text-violet-800 hover:bg-violet-100"
              onClick={handleRelease}
              disabled={releasing}
            >
              <Icon
                name={releasing ? 'Loader2' : 'Undo2'}
                size={14}
                className={`mr-1.5 ${releasing ? 'animate-spin' : ''}`}
              />
              Открепить и вернуть в перешив
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Кусков нет — блок не показываем вовсе. Пустая карточка «ничего не найдено»
  // только загромождает экран: закройщик берёт рулон, как и раньше.
  if (!loading && pieces.length === 0) return null;

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