import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { RepackItem } from '@/lib/kioskApi';

interface RepackItemCardProps {
  item: RepackItem;
  processing: boolean;
  onRepack: () => void;
  onUtilize: () => void;
  onRepair: () => void;
  onWrongItem: () => void;
  bagAsk: boolean;
  onBagAnswer: (newBag: boolean) => void;
  onBagCancel: () => void;
}

const RepackItemCard = ({
  item,
  processing,
  bagAsk,
  onBagAnswer,
  onBagCancel,
  onRepack,
  onUtilize,
  onRepair,
  onWrongItem,
}: RepackItemCardProps) => (
  <Card className="border-2 border-violet-500 shadow-none ring-4 ring-violet-200">
    <CardContent className="space-y-3 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold">
            {item.material && item.width
              ? `${item.material} ${item.width}×${item.height}`
              : item.product || 'Товар'}
          </p>
          <p className="break-all font-mono-tech text-sm text-muted-foreground">
            {item.storageBarcode} · {item.orderNumber || '—'}
          </p>
        </div>
        {item.marketplace && <Badge variant="secondary">{item.marketplace}</Badge>}
      </div>

      {item.returnReason && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Почему вернули:</p>
          <p>{item.returnReason}</p>
        </div>
      )}

      {/* ТРИ РЕШЕНИЯ — и всё. Раньше здесь сверху висели восемь кнопок с
          причинами брака («дырка», «затяжка», «пятно»...), и упаковщица
          сначала разбиралась с ними, а уже потом нажимала действие. На
          потоке это лишний шаг: причину всё равно смотрит администратор,
          когда вещь доходит до него со стикером.

          Кнопки одного размера и в один ряд: у каждой вещи ровно один
          исход, и выбор должен читаться с одного взгляда. */}
      {bagAsk ? (
        <div className="space-y-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
          <p className="text-center text-2xl font-bold text-emerald-900">
            Вы взяли новый пакет?
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-24 bg-emerald-600 text-xl text-white hover:bg-emerald-700"
              onClick={() => onBagAnswer(true)}
              disabled={processing}
            >
              <Icon name="PackagePlus" size={28} className="mr-2" />
              Да, новый
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-24 bg-white text-xl"
              onClick={() => onBagAnswer(false)}
              disabled={processing}
            >
              <Icon name="Package" size={28} className="mr-2" />
              Нет, прежний
            </Button>
          </div>
          <Button
            variant="ghost"
            className="h-12 w-full text-base"
            onClick={onBagCancel}
            disabled={processing}
          >
            Назад
          </Button>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          size="lg"
          className="h-24 bg-emerald-600 text-lg text-white hover:bg-emerald-700"
          onClick={onRepack}
          disabled={processing}
        >
          <div className="flex flex-col items-center gap-1">
            <Icon
              name={processing ? 'Loader2' : 'Check'}
              size={30}
              className={processing ? 'animate-spin' : ''}
            />
            <span>Перепаковка</span>
          </div>
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-24 border-2 border-violet-300 text-lg text-violet-700 hover:bg-violet-50 hover:text-violet-800"
          onClick={onRepair}
          disabled={processing}
        >
          <div className="flex flex-col items-center gap-1">
            <Icon name="Scissors" size={30} />
            <span>Кусок на перешив</span>
          </div>
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-24 border-2 border-destructive/40 text-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onUtilize}
          disabled={processing}
        >
          <div className="flex flex-col items-center gap-1">
            <Icon name="Trash2" size={30} />
            <span>Утилизация</span>
          </div>
        </Button>
      </div>
      )}

      {!bagAsk && (
        <Button
          variant="ghost"
          className="h-12 w-full text-base"
          onClick={onWrongItem}
          disabled={processing}
        >
          Это не та вещь — отсканировать другую
        </Button>
      )}
    </CardContent>
  </Card>
);

export default RepackItemCard;