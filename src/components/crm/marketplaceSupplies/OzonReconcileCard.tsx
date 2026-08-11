import Icon from '@/components/ui/icon';
import { Card } from '@/components/ui/card';
import type { SupplyReconcile } from '@/lib/marketplaceSuppliesApi';

/**
 * Сверка поставки FBS с кабинетом OZON.
 *
 * Кладовщик закрывает поставку и сверяет её с кабинетом: там «114», у него «152».
 * Числа расходятся не из-за ошибки — OZON считает ОТПРАВЛЕНИЯ, а склад ВЕЩИ.
 * Одно отправление бывает на семь штук: OZON покажет одну строку, а швеи отшили
 * семь и на складе искать нужно семь. Показываем обе единицы рядом и сразу
 * раскладываем, где вещи лежат, — видно, чего не хватает до закрытия.
 */
const OzonReconcileCard = ({
  data,
  readyInSupply,
}: {
  data: SupplyReconcile;
  /** Сколько вещей кладовщик уже видит готовыми в этой поставке. */
  readyInSupply?: number;
}) => {
  const rows = [
    {
      label: 'Уже в поставке',
      value: data.inSupply,
      icon: 'PackageCheck',
      tone: 'text-emerald-700',
    },
    {
      label: 'Готово к сборке',
      value: data.ready,
      icon: 'Tag',
      tone: 'text-sky-700',
      hint: 'отстикеровано, ждёт сканирования',
    },
    {
      label: 'Без ярлыка',
      value: data.noLabel,
      icon: 'TriangleAlert',
      tone: 'text-amber-700',
      hint: 'сканер развернёт — сначала напечатать стикер',
    },
    {
      label: 'На полке хранения',
      value: data.onShelf,
      icon: 'Archive',
      tone: 'text-amber-700',
      hint: 'заказ ждёт отгрузки, а вещь не отобрана в сборку',
    },
    {
      label: 'На конвейере',
      value: data.inProduction,
      icon: 'Factory',
      tone: 'text-muted-foreground',
      hint: 'ещё шьётся, до склада не дошло',
    },
    {
      label: 'Прочее',
      value: data.other,
      icon: 'CircleHelp',
      tone: 'text-muted-foreground',
      hint: 'редкие статусы вещей',
    },
    // Строки с нулём прячем: пустые «0 шт» только загромождают сверку. Но если
    // в строке что-то есть — показываем всегда, даже «Прочее»: именно там
    // всплывает вещь, которая иначе потерялась бы и сломала сумму.
  ].filter((r) => r.value > 0);

  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="Scale" size={16} className="text-muted-foreground" />
        <h3 className="text-sm font-semibold">Сверка с кабинетом OZON</h3>
      </div>

      <div className="mb-3 rounded-md bg-muted/50 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold">{data.units}</span>
          <span className="text-sm text-muted-foreground">
            шт ожидает отгрузки — это
          </span>
          <span className="text-2xl font-bold">{data.postings}</span>
          <span className="text-sm text-muted-foreground">
            отправлений в кабинете OZON
          </span>
        </div>
        {data.units !== data.postings && (
          // Главное объяснение расхождения. Без него кладовщик считает, что
          // система ошибается, и пересчитывает склад руками.
          <p className="mt-1.5 text-xs text-muted-foreground">
            В кабинете OZON видно {data.postings} — там считают отправления, а не
            штуки. В одном отправлении бывает несколько вещей, и собрать нужно
            каждую.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Icon
                name={r.icon}
                size={15}
                className={`mt-0.5 shrink-0 ${r.tone}`}
              />
              <div>
                <div className="text-sm">{r.label}</div>
                {r.hint && (
                  <div className="text-xs text-muted-foreground">{r.hint}</div>
                )}
              </div>
            </div>
            <span className={`shrink-0 text-sm font-semibold ${r.tone}`}>
              {r.value} шт
            </span>
          </div>
        ))}
      </div>

      {/* Итог столбика. Кладовщик всё равно складывает строки в уме и проверяет
          сходимость — показываем сумму сами, чтобы он не считал и не сомневался. */}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm font-medium">Итого</span>
        <span className="text-sm font-bold">{total} шт</span>
      </div>

      {typeof readyInSupply === 'number' && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          Счётчик поставки показывает {readyInSupply} шт — это вещи, готовые к
          отгрузке прямо сейчас. Остальное ещё в работе.
        </p>
      )}
    </Card>
  );
};

export default OzonReconcileCard;