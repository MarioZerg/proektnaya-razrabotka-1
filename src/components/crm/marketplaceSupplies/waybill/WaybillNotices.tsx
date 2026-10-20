import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { WaybillDocument } from '@/lib/waybillApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface WaybillNoticesProps {
  supply: SupplyDetail;
  doc: WaybillDocument;
  isManager: boolean;
}

/** Пояснение к форме и предупреждения: расхождение мест, кто подтвердил, ожидание менеджера. */
const WaybillNotices = ({ supply, doc, isManager }: WaybillNoticesProps) => (
  <>
    <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
      Форма по Приложению № 4 к Правилам перевозок грузов автомобильным
      транспортом. PDF открывается на yarplan.ru, длинный текст остаётся
      внутри рамки. После сохранения на полоске обновятся дата, число коробов
      и даты доставки в Газельку и на маркетплейс.
    </p>

    {supply.boxes?.length > 0 && doc.loadingPlaces !== String(supply.boxes.length) && (
      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
        В накладной мест: {doc.loadingPlaces || '—'}, а коробов собрано:{' '}
        {supply.boxes.length}. Проверьте разделы «Груз» и «Приём груза».
      </p>
    )}

    {doc.isReady && (
      <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
        <Icon name="Check" size={15} className="mt-0.5 shrink-0" />
        Подтвердил: {doc.readyByName || '—'}
        {doc.readyAt ? `, ${formatDateTime(doc.readyAt)}` : ''}. Кладовщик видит
        кнопку печати.
      </p>
    )}

    {!isManager && !doc.isReady && (
      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Icon name="Clock" size={15} className="mt-0.5 shrink-0" />
        Менеджер ещё не подтвердил накладную. Отгружать поставку без документа
        нельзя — дождитесь готовности.
      </p>
    )}
  </>
);

export default WaybillNotices;
