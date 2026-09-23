import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SupplyBox } from '@/lib/marketplaceSuppliesApi';

interface SupplyBoxActionsProps {
  box: SupplyBox;
  canEdit: boolean;
  isWbFbo: boolean;
  isOzonFbo: boolean;
  closing: boolean;
  printing: boolean;
  fetchingLabel: boolean;
  onCloseOzon: () => void;
  onCloseAndPrint: () => void;
  onFetchLabel: () => void;
  /** Печать стикера маркетплейса — тот же обработчик, что и в полосе короба. */
  onPrintSticker: () => void;
  /** Печать стикера короба WB — тот же обработчик, что и в полосе короба. */
  onPrintWbSticker: () => void;
  onReopenBox: (boxId: number) => void;
  onDeleteBox: (boxId: number) => void;
}

/**
 * Действия по коробу: закрыть, переоткрыть, забрать и напечатать этикетку.
 *
 * Опасные действия (закрыть, переоткрыть, удалить) живут ВНИЗУ раскрытого
 * короба, а не в шапке: там их нельзя задеть, целясь в стрелку раскрытия.
 * Набор зависит от площадки и того, ушло ли уже грузоместо — состояния
 * разведены намеренно, каждое со своим объяснением.
 *
 * Печать стикера продублирована в полосе короба (SupplyBoxCardHeader): она
 * безопасна и нужна чаще всего. Обработчики у обеих кнопок ОДНИ И ТЕ ЖЕ —
 * иначе поведение начало бы расходиться в зависимости от места нажатия.
 */
const SupplyBoxActions = ({
  box,
  canEdit,
  isWbFbo,
  isOzonFbo,
  closing,
  printing,
  fetchingLabel,
  onCloseOzon,
  onCloseAndPrint,
  onFetchLabel,
  onPrintSticker,
  onPrintWbSticker,
  onReopenBox,
  onDeleteBox,
}: SupplyBoxActionsProps) => (
  <>
    {/* КОРОБ ЗАКРЫТ — ОБЪЯСНЯЕМ, ПОЧЕМУ СОСТАВ НЕ ПРАВИТСЯ, И ДАЁМ ВЫХОД.
        Раньше кладовщик видел просто заблокированные кнопки и решал, что
        количество вообще нельзя редактировать. */}
    {isOzonFbo && box.closedAt && canEdit && box.items.length > 0 && (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="flex items-start gap-2 text-sm text-amber-900">
          <Icon name="Lock" size={14} className="mt-0.5 shrink-0" />
          <span>
            Короб закрыт, состав не меняется — на OZON по нему заведено
            грузоместо. Чтобы поправить количество, верните короб в работу
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full border-amber-500 text-amber-900 hover:bg-amber-100"
          onClick={() => onReopenBox(box.id)}
        >
          <Icon name="LockOpen" size={14} className="mr-1.5" />
          Открыть короб и поправить состав
        </Button>
      </div>
    )}

    {/* OZON FBO: короб набит — закрываем. Сервер заводит грузоместо на OZON
        и возвращает этикетку на ЭТОТ короб, её сразу можно печатать. */}
    {isOzonFbo && box.items.length > 0 && !box.closedAt && (
      <Button
        size="sm"
        className="w-full"
        onClick={onCloseOzon}
        disabled={closing}
      >
        <Icon
          name={closing ? 'Loader2' : 'PackageCheck'}
          size={14}
          className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
        />
        {closing ? 'Закрываем короб и получаем стикер…' : 'Закрыть короб'}
      </Button>
    )}

    {/* КОРОБ ЗАКРЫТ, НО СТИКЕРА ЕЩЁ НЕТ — ДАЁМ ЗАБРАТЬ ЕГО ОТДЕЛЬНО.
        OZON готовит файл не мгновенно, и закрытие короба его не ждёт:
        обе операции в один запрос не укладываются в отведённое время.
        Короб при этом закрыт корректно, не хватает только наклейки.

        Сюда же попадает случай, когда площадка ещё не присвоила номер
        грузоместа. Раньше он показывался отдельной жёлтой кнопкой
        «Повторить отправку на OZON» и выглядел как сбой, хотя место на
        площадке уже создавалось — номер приходил секундой позже. Та же
        кнопка «Получить этикетку» теперь сама доводит дело до конца:
        забирает номер по уже запущенной операции и тянет наклейку. */}
    {isOzonFbo && box.closedAt && !box.stickerUrl && box.items.length > 0 && (
      <div className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-3">
        <p className="flex items-start gap-2 text-sm text-sky-900">
          <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
          <span>
            {box.ozonCargoId
              ? 'Короб закрыт, грузоместо на OZON создано. Этикетка ещё готовится на стороне площадки'
              : 'Короб закрыт. OZON ещё присваивает номер грузоместа — нажмите «Получить этикетку»'}
          </span>
        </p>
        <Button
          size="sm"
          className="w-full bg-[#005BFF] text-white hover:bg-[#0047cc]"
          onClick={onFetchLabel}
          disabled={fetchingLabel}
        >
          <Icon
            name={fetchingLabel ? 'Loader2' : 'Download'}
            size={14}
            className={`mr-1.5 ${fetchingLabel ? 'animate-spin' : ''}`}
          />
          {fetchingLabel ? 'Запрашиваем у OZON…' : 'Получить этикетку'}
        </Button>
      </div>
    )}

    {isWbFbo && box.items.length > 0 && !box.closedAt && (
      <Button
        size="sm"
        className="w-full bg-[#CB11AB] text-white hover:bg-[#a60d8b]"
        onClick={onCloseAndPrint}
        disabled={closing}
      >
        <Icon
          name={closing ? 'Loader2' : 'PackageCheck'}
          size={14}
          className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
        />
        Закрыть короб и печать стикера
      </Button>
    )}

    {isWbFbo && box.closedAt && (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={printing}
        onClick={onPrintWbSticker}
      >
        <Icon
          name={printing ? 'Loader2' : 'Printer'}
          size={14}
          className={`mr-1.5 ${printing ? 'animate-spin' : ''}`}
        />
        {printing ? 'Готовим стикер…' : 'Печать стикера короба'}
      </Button>
    )}

    {box.stickerUrl && (
      <div className="space-y-1.5">
        {/* Стикер короба от маркетплейса печатаем на наклейке 75×120 — той же, что у WB.
            Раньше PDF просто открывался ссылкой и уходил на печать как A4.
            Печать не мгновенная: файл скачивается и перерисовывается в
            картинку. Без индикатора кладовщик жмёт кнопку повторно и
            получает несколько окон печати подряд. */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={printing}
          onClick={onPrintSticker}
        >
          <Icon
            name={printing ? 'Loader2' : 'Printer'}
            size={14}
            className={`mr-1.5 ${printing ? 'animate-spin' : ''}`}
          />
          {printing ? 'Готовим стикер…' : 'Печать стикера короба (75×120)'}
        </Button>
        <a
          href={box.stickerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <Icon name="FileText" size={12} />
          Открыть PDF
        </a>
      </div>
    )}

    {/* Удаление — внизу раскрытого короба, а не иконкой в шапке: чтобы
        случайно не снести короб, целясь в стрелку раскрытия. */}
    {canEdit && box.items.length === 0 && !box.closedAt && (
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-destructive hover:text-destructive"
        onClick={() => onDeleteBox(box.id)}
      >
        <Icon name="Trash2" size={14} className="mr-1.5" />
        Удалить пустой короб
      </Button>
    )}
  </>
);

export default SupplyBoxActions;