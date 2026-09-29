import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { currencySymbols, type Supplier } from '@/lib/suppliersApi';

interface SupplierCardProps {
  supplier: Supplier;
  onPrices: (s: Supplier) => void;
  onEdit: (s: Supplier) => void;
  onDelete: (id: number) => void;
}

const currencyHint = (s: Supplier) => {
  if (!s.currency || s.currency === 'RUB') {
    return { text: 'Рубли', warn: false };
  }
  const sym = currencySymbols[s.currency] || s.currency;
  if (s.exchangeRate) {
    return { text: `1 ${sym} = ${s.exchangeRate} ₽`, warn: false };
  }
  return { text: `${s.currency} — нет курса`, warn: true };
};

/**
 * Карточка поставщика вместо строки широкой таблицы.
 *
 * В таблице на телефоне видны только номер и имя: прайс, курс и кнопки
 * уезжают за край. Здесь имя, чем платить и действия всегда на экране.
 */
const SupplierCard = ({ supplier: s, onPrices, onEdit, onDelete }: SupplierCardProps) => {
  const cur = currencyHint(s);
  const pricesCount = s.prices?.length || 0;
  const phoneHref = s.phone ? `tel:${s.phone.replace(/[^\d+]/g, '')}` : null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold leading-snug">{s.name}</p>

        {phoneHref ? (
          <a
            href={phoneHref}
            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-sm text-primary"
          >
            <Icon name="Phone" size={12} className="shrink-0" />
            {s.phone}
          </a>
        ) : null}

        {s.address ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={s.address}>
            {s.address}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={cur.warn ? 'destructive' : 'secondary'} className="font-normal">
            {cur.text}
          </Badge>
          <Badge variant="outline" className="font-normal">
            {pricesCount ? `${pricesCount} в прайсе` : 'Прайс пуст'}
          </Badge>
          {s.shortageNormPercent != null ? (
            <Badge variant="outline" className="font-normal">
              недостача {s.shortageNormPercent}%
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 sm:h-10 sm:w-10"
          title="Прайс материалов"
          onClick={() => onPrices(s)}
        >
          <Icon name="Tags" size={14} />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="h-9 w-9 sm:h-10 sm:w-10"
          title="Изменить"
          onClick={() => onEdit(s)}
        >
          <Icon name="Pencil" size={14} />
        </Button>
        <Button
          size="icon"
          variant="destructive"
          className="h-9 w-9 sm:h-10 sm:w-10"
          title="Удалить"
          onClick={() => onDelete(s.id)}
        >
          <Icon name="Trash2" size={14} />
        </Button>
      </div>
    </div>
  );
};

export default SupplierCard;
