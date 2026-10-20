import type { MouseEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { WaybillDocument } from '@/lib/waybillApi';
import { boxCount, showDay } from './waybillFields';

interface WaybillStripProps {
  doc: WaybillDocument | null;
  isManager: boolean;
  showPrint: boolean;
  onOpen: () => void;
  onPrint: (event: MouseEvent) => void;
}

/** Полоска накладной на шаге отгрузки: статус, коробов, даты и кнопка печати. */
const WaybillStrip = ({ doc, isManager, showPrint, onOpen, onPrint }: WaybillStripProps) => (
  <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
    <button
      type="button"
      className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left sm:px-4 ${
        isManager ? 'hover:bg-muted/50' : 'cursor-default'
      }`}
      onClick={() => isManager && onOpen()}
    >
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold leading-snug">Транспортная накладная</span>
          {!doc && <Badge variant="destructive">Не заведена</Badge>}
          {doc?.isReady && <Badge>Готова</Badge>}
          {doc && !doc.isReady && <Badge variant="outline">Черновик</Badge>}
          {doc?.number && <span className="font-mono-tech text-xs">№ {doc.number}</span>}
        </span>
        {doc ? (
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>Заполнена {formatDateTime(doc.updatedAt)}</span>
            <span>Коробов: {boxCount(doc)}</span>
            <span>В Газельку: {showDay(doc.plannedLoadingAt)}</span>
            <span>На маркетплейс: {showDay(doc.plannedUnloadingAt)}</span>
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {isManager
              ? 'Нажмите, чтобы завести документ'
              : 'Накладную заполняет менеджер — без неё груз не отгружаем'}
          </span>
        )}
      </div>
    </button>
    {showPrint && (
      <button
        type="button"
        className="flex shrink-0 items-center border-l border-border px-3 text-primary hover:bg-muted/50"
        title="Печать накладной"
        onClick={onPrint}
      >
        <Icon name="Printer" size={18} />
      </button>
    )}
  </div>
);

export default WaybillStrip;
