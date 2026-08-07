import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { fetchStackPreview, type StackPreview } from '@/lib/ordersApi';

interface NextStackHintProps {
  workshopId: number | null;
  /** Меняется после взятия стека — сигнал перечитать очередь. */
  refreshKey: number;
}

/** Подсказка закройщику: что сейчас первое в очереди его цеха — связка Яндекса или
 * обычный стек.
 *
 * ВАЖНО про формулировки: в смене работает несколько закройщиков и очередь у них общая.
 * Пока человек читает подсказку, тот же заказ может забрать коллега — поэтому здесь
 * НЕ обещают «вы получите», а пишут «сейчас в очереди» и прямо предупреждают, что
 * заказ может уйти другому. Иначе подсказка выглядела бы обманом. */
const NextStackHint = ({ workshopId, refreshKey }: NextStackHintProps) => {
  const [preview, setPreview] = useState<StackPreview | null>(null);

  useEffect(() => {
    if (!workshopId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchStackPreview(workshopId)
        .then((data) => {
          if (!cancelled) setPreview(data);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    };
    load();
    // Очередь общая на цех — обновляем, чтобы подсказка не устаревала, пока
    // закройщик стоит на странице, а коллеги разбирают заказы.
    const timer = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workshopId, refreshKey]);

  if (!preview || preview.kind === 'none' || preview.count === 0) return null;

  const isGroup = preview.kind === 'group';

  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        isGroup
          ? 'border-violet-300 bg-violet-50 text-violet-900'
          : 'border-border bg-muted/50 text-muted-foreground'
      }`}
    >
      <Icon name={isGroup ? 'Package' : 'Layers'} size={16} className="mt-0.5 shrink-0" />
      <p>
        {isGroup ? (
          <>
            Сейчас в очереди — <b>связка Яндекса из {preview.count} вещей</b>. Она выдаётся
            целиком и отдельно от обычного стека: раскроите её и повесьте вместе.
          </>
        ) : (
          <>
            Сейчас в очереди — обычный стек, готово к раскрою {preview.count}{' '}
            {preview.count % 10 === 1 && preview.count % 100 !== 11
              ? 'заказ'
              : [2, 3, 4].includes(preview.count % 10) &&
                  ![12, 13, 14].includes(preview.count % 100)
                ? 'заказа'
                : 'заказов'}
            .
          </>
        )}{' '}
        <span className="opacity-70">
          Очередь общая на цех — заказы может забрать другой закройщик раньше вас.
        </span>
      </p>
    </div>
  );
};

export default NextStackHint;
