import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fetchWaybill, type WaybillDocument } from '@/lib/waybillApi';

const day = (value: string | null | undefined) => {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (y && m && d && value.includes('T')) {
    const time = String(value).slice(11, 16);
    return time ? `${d}.${m}.${y} ${time}` : `${d}.${m}.${y}`;
  }
  return y && m && d ? `${d}.${m}.${y}` : String(value);
};

const text = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  return String(value);
};

/**
 * Транспортная накладная на нашем адресе.
 *
 * Раньше кнопка открывала Excel с внешнего хранилища: в адресе был чужой
 * сервис, а длинный текст обрезался фиксированной высотой ячейки. Здесь
 * документ рисуется на странице yarplan.ru, текст переносится внутри рамки,
 * печать в PDF делает браузер.
 */
const WaybillPrint = () => {
  const { id } = useParams();
  const [doc, setDoc] = useState<WaybillDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchWaybill(Number(id))
      .then((d) => {
        if (!d) setError('Накладная не заведена');
        else setDoc(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить накладную'));
  }, [id]);

  if (error) {
    return <p className="p-6 text-sm">{error}</p>;
  }
  if (!doc) {
    return <p className="p-6 text-sm text-muted-foreground">Загрузка накладной…</p>;
  }

  const pair = (
    left: string,
    leftCap: string,
    right?: string,
    rightCap?: string,
  ) => (
    <div className={rightCap !== undefined || right !== undefined ? 'grid grid-cols-2' : ''}>
      <div className="border border-black p-1.5">
        <p className="whitespace-pre-wrap break-words text-[11pt] leading-snug">{left}</p>
        <p className="mt-1 text-[8pt] leading-snug text-neutral-600">{leftCap}</p>
      </div>
      {(rightCap !== undefined || right !== undefined) && (
        <div className="border border-black border-l-0 p-1.5">
          <p className="whitespace-pre-wrap break-words text-[11pt] leading-snug">{right || '—'}</p>
          <p className="mt-1 text-[8pt] leading-snug text-neutral-600">{rightCap}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white text-black">
      <div className="print:hidden flex justify-end gap-2 border-b p-3">
        <Button onClick={() => window.print()}>
          <Icon name="Printer" size={16} className="mr-1.5" />
          Печать PDF
        </Button>
      </div>
      <article className="mx-auto max-w-[190mm] px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <p className="text-right text-[9pt]">Приложение № 4</p>
        <p className="text-right text-[9pt]">к Правилам перевозок грузов автомобильным транспортом</p>
        <p className="text-right text-[9pt]">(в ред. Постановления Правительства РФ от 30.11.2021 № 2116)</p>
        <h1 className="my-4 text-center text-[16pt] font-bold">ТРАНСПОРТНАЯ НАКЛАДНАЯ</h1>

        <div className="space-y-1 text-[11pt]">
          {pair(
            `№ ${text(doc.number)}   от ${day(doc.docDate)}`,
            'Дата и номер транспортной накладной',
            `Заказ (заявка) № ${text(doc.orderNumber)}   от ${day(doc.orderDate)}`,
            'Дата и номер заказа (заявки)',
          )}
          {pair(`Экземпляр № ${text(doc.copyNumber)}`, 'Номер экземпляра')}

          <h2 className="pt-3 text-[12pt] font-bold">1. Грузоотправитель</h2>
          {pair(text(doc.shipperDetails), '(реквизиты, позволяющие идентифицировать Грузоотправителя)')}
          {doc.customerDetails && (
            <>
              <h2 className="pt-3 text-[12pt] font-bold">1а. Заказчик услуг по организации перевозки груза</h2>
              {pair(
                text(doc.customerDetails),
                '(реквизиты, позволяющие идентифицировать Заказчика услуг)',
                text(doc.customerContract),
                '(реквизиты договора на выполнение услуг по организации перевозки)',
              )}
            </>
          )}

          <h2 className="pt-3 text-[12pt] font-bold">2. Грузополучатель</h2>
          {pair(text(doc.consigneeDetails), '(реквизиты, позволяющие идентифицировать Грузополучателя)')}
          {pair(text(doc.deliveryAddress), '(адрес места доставки груза)')}

          <h2 className="pt-3 text-[12pt] font-bold">3. Груз</h2>
          {pair(
            text(doc.cargoName),
            '(отгрузочное наименование груза, его состояние и другая информация о грузе)',
            text(doc.cargoPlaces),
            '(количество грузовых мест, маркировка, вид тары и способ упаковки)',
          )}
          {pair(
            text(doc.cargoWeight),
            '(масса груза брутто в килограммах, масса груза нетто, размеры, объём)',
            text(doc.cargoValue),
            '(объявленная стоимость (ценность) груза)',
          )}

          <h2 className="pt-3 text-[12pt] font-bold">4. Сопроводительные документы</h2>
          {pair(text(doc.accompanyingDocs), '(перечень прилагаемых документов)')}

          <h2 className="pt-3 text-[12pt] font-bold">6. Перевозчик</h2>
          {pair(
            text(doc.carrierDetails),
            '(реквизиты перевозчика)',
            text(doc.driverDetails),
            '(реквизиты водителя)',
          )}

          <h2 className="pt-3 text-[12pt] font-bold">7. Транспортное средство</h2>
          {pair(
            text(doc.vehicleDetails),
            '(тип, марка, грузоподъёмность)',
            text(doc.vehicleNumber),
            '(регистрационный номер)',
          )}

          <h2 className="pt-3 text-[12pt] font-bold">8. Приём груза</h2>
          {pair(text(doc.loaderDetails), '(кто осуществляет погрузку)')}
          {pair(
            text(doc.loadingAddress),
            '(адрес места погрузки)',
            day(doc.plannedLoadingAt),
            '(дата и время подачи под погрузку — в Газельку)',
          )}
          {pair(
            text(doc.loadingPlaces),
            '(количество грузовых мест)',
            text(doc.packaging),
            '(тара, упаковка)',
          )}
          {pair(text(doc.loadingWeight), '(масса груза при погрузке)')}

          <h2 className="pt-3 text-[12pt] font-bold">10. Выдача груза</h2>
          {pair(
            text(doc.unloadingAddress),
            '(адрес места выгрузки — склад маркетплейса)',
            day(doc.plannedUnloadingAt),
            '(дата и время подачи под выгрузку)',
          )}
          {pair(
            text(doc.cargoCondition),
            '(состояние груза)',
            text(doc.unloadPlaces),
            '(количество грузовых мест)',
          )}

          <h2 className="pt-3 text-[12pt] font-bold">12. Стоимость перевозки</h2>
          {pair(
            text(doc.transportCost),
            '(стоимость без налога)',
            text(doc.transportCostTotal),
            '(стоимость с налогом)',
          )}
          {doc.comment && (
            <>
              <h2 className="pt-3 text-[12pt] font-bold">Комментарий</h2>
              {pair(text(doc.comment), '')}
            </>
          )}
        </div>
      </article>
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .border { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default WaybillPrint;
