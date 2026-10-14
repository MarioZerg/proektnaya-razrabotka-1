import Icon from '@/components/ui/icon';

interface WbFbsB2bNoticesProps {
  supplyIsB2b: boolean;
  otherKindCount: number;
}

/** Подсказки о заказах юрлиц (B2B): WB не принимает поставку, где они смешаны с обычными. */
const WbFbsB2bNotices = ({ supplyIsB2b, otherKindCount }: WbFbsB2bNoticesProps) => (
  <>
    {supplyIsB2b && (
      <div className="flex items-start gap-2 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-900">
        <Icon name="Building2" size={18} className="mt-0.5 shrink-0" />
        <p>
          <b>Поставка для юрлиц (B2B).</b> Сюда можно класть только заказы юрлиц —
          обычные WB в эту поставку не примет.
        </p>
      </div>
    )}
    {otherKindCount > 0 && (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
        <p>
          {supplyIsB2b
            ? `Ещё ${otherKindCount} обычных заказов ждут обычной поставки — в эту их положить нельзя.`
            : `Ещё ${otherKindCount} заказов юрлиц (B2B) ждут отдельной поставки — с обычными WB их не примет. Создайте для них поставку с типом «B2B».`}
        </p>
      </div>
    )}
  </>
);

export default WbFbsB2bNotices;
