import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { PayoutPreview } from '@/lib/salaryApi';

interface PayoutSbpCardProps {
  preview: PayoutPreview;
  copied: boolean;
  setCopied: (v: boolean) => void;
}

/**
 * КУДА ПЕРЕВОДИТЬ.
 * Деньги уходят по СБП, а номер лежал только в профиле: чтобы перевести,
 * приходилось открывать вторую вкладку и переписывать телефон руками.
 * Показываем его прямо здесь, рядом с суммой.
 */
const PayoutSbpCard = ({ preview, copied, setCopied }: PayoutSbpCardProps) => (
  <div className="rounded-md border border-border bg-muted/40 p-3">
    {preview.sbpPhone ? (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Перевод по СБП</p>
            <p className="truncate text-base font-bold tracking-tight">
              {preview.sbpPhone}
            </p>
            {!!preview.sbpBank && (
              <p className="truncate text-xs text-muted-foreground">
                {preview.sbpBank}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => {
              navigator.clipboard?.writeText(preview.sbpPhone || '');
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Icon
              name={copied ? 'Check' : 'Copy'}
              size={13}
              className="mr-1"
            />
            {copied ? 'Скопировано' : 'Копировать'}
          </Button>
        </div>

        {/* Неподтверждённые реквизиты — не запрет, а повод сверить:
            деньги уйдут по этому номеру безвозвратно. */}
        {!preview.sbpConfirmed && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
            <Icon
              name="TriangleAlert"
              size={12}
              className="mt-0.5 shrink-0"
            />
            Реквизиты ещё не сверены администратором — проверьте номер перед
            переводом
          </p>
        )}
      </>
    ) : (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Icon
          name="Info"
          size={13}
          className="mt-0.5 shrink-0 text-amber-600"
        />
        Сотрудник не указал номер СБП в профиле.
        {preview.loginPhone ? ` Телефон для входа: ${preview.loginPhone}` : ''}
      </p>
    )}
  </div>
);

export default PayoutSbpCard;
