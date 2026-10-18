import Icon from '@/components/ui/icon';

interface RelabelBoxesBadgeProps {
  total: number;
  relabeled: number;
}

/**
 * Предупреждение в ленте поставок: поставку перенесли в другую заявку OZON
 * (смена кластера), на коробах висят стикеры старой заявки. Кладовщику нужно
 * закрыть короба заново и переклеить штрихкоды.
 */
const RelabelBoxesBadge = ({ total, relabeled }: RelabelBoxesBadgeProps) => {
  const left = Math.max(total - relabeled, 0);
  const done = total > 0 && left === 0;

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-amber-900"
    >
      <Icon name="ScanBarcode" fallback="Barcode" size={16} className="mt-px shrink-0" />
      <span>
        {done ? (
          <>
            Перенос заявки — требуется переклейка штрихкодов коробов
            <span className="font-bold"> · новые стикеры готовы на все {total}</span>
          </>
        ) : (
          <>
            Перенос заявки — требуется переклейка штрихкодов коробов
            {total > 0 && <span className="font-bold"> · осталось {left} из {total}</span>}
          </>
        )}
      </span>
    </div>
  );
};

export default RelabelBoxesBadge;
