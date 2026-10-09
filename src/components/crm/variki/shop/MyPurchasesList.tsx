import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { couponLink, type VarikiPurchase } from '@/lib/varikiApi';
import { formatDateTime } from '@/lib/dateUtils';
import { formatDate } from '@/components/crm/variki/shop/varikiShopUtils';

interface MyPurchasesListProps {
  purchases: VarikiPurchase[];
  userId?: number;
}

/** «Мои покупки»: дата визита, контакты, статус и ссылка на купон. */
const MyPurchasesList = ({ purchases, userId }: MyPurchasesListProps) => (
  <div className="rounded-md border border-border">
    <div className="border-b border-border bg-muted/50 px-4 py-2 text-sm font-semibold">
      Мои покупки
    </div>
    <div className="divide-y divide-border">
      {purchases.map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-center justify-between gap-3 p-4"
        >
          <div className="min-w-0">
            <p className="font-medium">{p.title}</p>
            <p className="text-xs text-muted-foreground">
              {p.createdAt ? formatDateTime(p.createdAt) : ''} · {p.price} вариков
            </p>
            {p.lootTitle && p.status !== 'cancelled' && (
              <p className="mt-0.5 text-xs font-medium text-foreground">
                Выпало: {p.lootTitle}
              </p>
            )}
            {/* Своя дата визита: сотрудник помнит, на когда записался,
                и видит, что заявка ушла именно на этот день. */}
            {p.visitDate && p.status !== 'cancelled' && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Icon name="CalendarCheck" size={13} className="shrink-0" />
                Посещение: {formatDate(p.visitDate)}
              </p>
            )}

            {p.status === 'cancelled' && p.cancelReason && (
              <p className="mt-0.5 text-xs text-destructive">
                Отменено: {p.cancelReason}. Варики возвращены
              </p>
            )}

            {/* Главное место для контактов: сотрудник открывает свои
                покупки, чтобы записаться на услугу по сертификату.
                У отменённых не показываем — идти уже некуда. */}
            {p.status !== 'cancelled' && (p.orgAddress || p.orgPhone) && (
              <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {p.orgAddress && (
                  <p className="flex items-start gap-1.5">
                    <Icon name="MapPin" size={13} className="mt-0.5 shrink-0" />
                    <span>{p.orgAddress}</span>
                  </p>
                )}
                {p.orgPhone && (
                  <p className="flex items-center gap-1.5">
                    <Icon name="Phone" size={13} className="shrink-0" />
                    <a
                      href={`tel:${p.orgPhone.replace(/[^\d+]/g, '')}`}
                      className="font-medium hover:text-foreground hover:underline"
                    >
                      {p.orgPhone}
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>

          {p.status === 'issued' && p.hasCoupon ? (
            <Button asChild variant="default" className="shrink-0">
              <a
                href={couponLink(p.id, userId)}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="FileDown" size={16} className="mr-1.5" />
                Скачать купон
              </a>
            </Button>
          ) : p.status === 'issued' && p.lootTitle ? (
            <Badge className="shrink-0 bg-amber-100 text-amber-900 hover:bg-amber-100">
              На пузырьке
            </Badge>
          ) : p.status === 'pending' ? (
            <Badge variant="secondary" className="shrink-0">
              {p.visitDate
                ? 'Бронируем место'
                : 'Ждём купон от администратора'}
            </Badge>
          ) : p.status === 'cancelled' ? (
            <Badge variant="outline" className="shrink-0">
              Отменено
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              Выдано
            </Badge>
          )}
        </div>
      ))}
    </div>
  </div>
);

export default MyPurchasesList;
