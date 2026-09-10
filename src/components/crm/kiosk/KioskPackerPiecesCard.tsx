import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { PackerPiece } from '@/lib/rollsApi';

interface Props {
  total: number;
  pieces: PackerPiece[];
  unit: string;
  rollBarcode?: string | null;
  materialName?: string | null;
  onClose: () => void;
}

/**
 * Рулон не закрыть: в цехе лежат куски ткани от упаковщицы.
 *
 * При перепаковке упаковщица возвращает на рулон годный материал — он ложится в
 * остаток и должен уйти в заказы. Раньше закройщица видела на этом месте короткую
 * ошибку внизу экрана: непонятно, сколько кусков искать и каких.
 *
 * Теперь список кусков виден крупно, от станка: столько-то штук, такого-то размера,
 * с датой возврата. Их надо перекроить — и рулон закроется сам.
 */
const KioskPackerPiecesCard = ({
  total,
  pieces,
  unit,
  rollBarcode,
  materialName,
  onClose,
}: Props) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-center gap-3 text-destructive">
        <Icon name="Scissors" size={32} />
        <h2 className="text-2xl font-bold">Сначала перекроите материал</h2>
      </div>

      <p className="mt-3 text-lg">
        {materialName || 'Рулон'}{' '}
        {rollBarcode && <span className="font-mono-tech">{rollBarcode}</span>}
      </p>

      <div className="mt-4 rounded-xl border-2 border-destructive bg-destructive/10 p-4">
        <p className="text-base text-muted-foreground">
          Упаковщица вернула в цех годную ткань
        </p>
        <p className="mt-1 text-4xl font-bold">
          {total.toLocaleString('ru-RU')} {unit}
        </p>
        <p className="mt-1 text-base">
          {pieces.length} {pieces.length === 1 ? 'кусок' : pieces.length < 5 ? 'куска' : 'кусков'} —
          найдите их в цехе
        </p>
      </div>

      {/* Каждый кусок отдельной строкой: три по 3 метра и один на 9 ищутся
          по-разному, поэтому общей суммы закройщице мало. */}
      <div className="mt-4 space-y-2">
        {pieces.map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
          >
            <span className="flex items-center gap-3 text-xl font-semibold">
              <Icon name="Layers" size={20} className="text-muted-foreground" />
              {p.quantity.toLocaleString('ru-RU')} {unit}
            </span>
            <span className="text-sm text-muted-foreground">
              вернули {new Date(p.returnedAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-muted p-4 text-base">
        Перекроите эту ткань в заказы — после этого рулон закроется. Если кусок
        испорчен, спишите его через брак.
      </div>

      <Button className="mt-5 h-14 w-full text-lg" onClick={onClose}>
        Понятно
      </Button>
    </div>
  </div>
);

export default KioskPackerPiecesCard;