import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { TableCell, TableRow } from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyGroup } from '@/lib/marketplaceSuppliesApi';
import type { Row } from './fbsChecklistShared';

/**
 * Шапка связки и её вещи под ней.
 *
 * Связка — заказ покупателя из нескольких вещей с одним общим ярлыком (Яндекс).
 * Отгрузить половину нельзя: остаток застрянет на складе, а покупателю уедет
 * неполная посылка. Поэтому вещи показываем не вперемешку с одиночными
 * заказами, а одной группой со счётчиком «3 из 4».
 *
 * Неполные связки раскрыты сразу — по ним есть работа. Собранные свёрнуты:
 * кладовщик к ним уже не вернётся.
 */
const BundleBlock = ({
  group,
  rows,
  renderRow,
  colSpan,
  supplyId,
  onLabelScanned,
}: {
  group: SupplyGroup;
  rows: Row[];
  renderRow: (row: Row) => JSX.Element;
  colSpan: number;
  supplyId: number;
  onLabelScanned: () => void;
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(!group.isComplete);
  const [labelCode, setLabelCode] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const short = group.total - group.inSupply;

  // Второй шаг: общий ярлык маркетплейса на коробку. Открывается, только когда
  // все вещи связки собраны — иначе коробку заклеят с неполным заказом.
  const submitLabel = async () => {
    setSavingLabel(true);
    try {
      const { scanBundleLabel } = await import('@/lib/marketplaceSuppliesApi');
      await scanBundleLabel(supplyId, group.groupKey, labelCode.trim(), user?.id, user?.name);
      toast({
        title: 'Ярлык подтверждён',
        description: 'Наклейте его на коробку со связкой',
      });
      setLabelCode('');
      onLabelScanned();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить ярлык',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingLabel(false);
    }
  };

  return (
    <>
      <TableRow
        className={`cursor-pointer ${
          group.isComplete ? 'bg-emerald-100/70' : 'bg-amber-100/70'
        } hover:bg-muted`}
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell colSpan={colSpan} className="py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Icon
              name={open ? 'ChevronDown' : 'ChevronRight'}
              size={16}
              className="shrink-0 text-muted-foreground"
            />
            <Icon name="Package" size={15} className="shrink-0" />
            <span className="font-semibold">Связка</span>
            <span className="break-all font-mono-tech text-sm">{group.groupKey}</span>
            <Badge
              className={`px-1.5 py-0 text-[11px] text-white ${
                group.isComplete
                  ? 'bg-emerald-600 hover:bg-emerald-600'
                  : 'bg-amber-600 hover:bg-amber-600'
              }`}
            >
              {group.inSupply} из {group.total} в коробе
            </Badge>
            {!group.isComplete && (
              // ЧТО ЗНАЧИТ «0 из 2».
              //
              // Это НЕ потеря вещей: счётчик показывает, сколько вещей связки уже
              // отсканировано В КОРОБ. «0 из 2» значит, что обе вещи готовы и лежат
              // на складе, но в короб их ещё не пикнули. Кладовщики читали это как
              // «связка развалилась» и шли искать пропажу, которой не было.
              //
              // Поэтому пишем прямым текстом, что именно осталось сделать.
              <span className="text-xs font-medium text-amber-800">
                {group.inSupply === 0
                  ? `отсканируйте обе вещи в короб (${group.total} шт.) — заказ едет только целиком`
                  : `отсканируйте в короб ещё ${short} — заказ едет только целиком`}
              </span>
            )}
            {group.isComplete && group.labelScanned && (
              <span className="flex items-center gap-1 text-xs text-emerald-700">
                <Icon name="CircleCheck" size={13} />
                ярлык наклеен — можно отгружать
              </span>
            )}
            {group.isComplete && !group.labelScanned && (
              <span className="text-xs font-medium text-amber-800">
                вещи собраны — осталось наклеить общий ярлык
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {open ? 'свернуть' : 'показать товары'}
            </span>
          </div>
        </TableCell>
      </TableRow>

      {/* ВТОРОЙ ШАГ. Вещи собраны — теперь общий ярлык маркетплейса на коробку.
          Он у связки один на весь заказ: кладовщик сканирует его один раз и
          клеит на коробку. Пока не подтверждён, поставку не отгрузить. */}
      {group.isComplete && !group.labelScanned && (
        <TableRow className="bg-amber-50">
          <TableCell colSpan={colSpan} className="py-2">
            <div
              className="flex flex-wrap items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="ScanLine" size={16} className="shrink-0 text-amber-700" />
              <span className="text-sm font-medium text-amber-900">
                Шаг 2: отсканируйте общий ярлык заказа и наклейте его на коробку
              </span>
              <Input
                value={labelCode}
                onChange={(e) => setLabelCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && labelCode.trim() && void submitLabel()}
                placeholder="Номер с ярлыка маркетплейса"
                className="h-8 w-56 font-mono-tech text-sm"
                disabled={savingLabel}
              />
              <Button
                size="sm"
                onClick={() => void submitLabel()}
                disabled={savingLabel || !labelCode.trim()}
              >
                {savingLabel ? (
                  <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
                ) : (
                  <Icon name="Check" size={14} className="mr-1" />
                )}
                Ярлык наклеен
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}

      {open && rows.map(renderRow)}

      {/* ВЕЩИ СВЯЗКИ, КОТОРЫХ НЕТ В СПИСКЕ.
          
          В чек-лист попадают только вещи, дошедшие до склада: отсканированные
          в короб и застикерованные, ждущие скана. Вещь, которая ещё шьётся или
          висит на стикеровке в цехе, в списке отсутствует — и кладовщик, открыв
          связку «из 2», видел там ОДНУ строку. Выглядело как пропажа.
          
          Пишем прямо: сколько вещей связки ещё не доехало из цеха. */}
      {open && rows.length < group.total && (
        <TableRow className="bg-amber-50">
          <TableCell colSpan={colSpan} className="py-2">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <Icon name="Factory" size={15} className="mt-0.5 shrink-0" />
              <span>
                <b>
                  Ещё {group.total - rows.length} из {group.total} — в цехе.
                </b>{' '}
                Эти вещи заказа пока не застикерованы: их не видно в списке, пока
                упаковщица не закроет их на терминале. Связка едет только целиком —
                дождитесь их, прежде чем заклеивать коробку.
                {group.orderNumbers && (
                  <span className="mt-0.5 block font-mono-tech text-xs text-amber-800">
                    Вещи заказа: {group.orderNumbers}
                  </span>
                )}
              </span>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export default BundleBlock;