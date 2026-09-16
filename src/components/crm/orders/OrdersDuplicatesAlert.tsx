import Icon from '@/components/ui/icon';

/**
 * Предупреждение о задвоенных заказах: одна вещь заведена дважды.
 * Разметка 1:1 перенесена из MarketplaceOrders.
 */
interface Props {
  duplicates: { postingNumber: string }[];
}

const OrdersDuplicatesAlert = ({ duplicates }: Props) => (
  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
    <Icon name="CopyX" size={18} className="mt-0.5 shrink-0 text-destructive" />
    <div className="min-w-0">
      <p className="font-medium text-destructive">
        Задвоенные заказы: {duplicates.length}
      </p>
      <p className="mt-1 text-muted-foreground">
        Одна вещь попала в систему дважды — лишнюю нужно отменить, иначе на неё
        спишется материал и начислится зарплата. Отправления:{' '}
        {duplicates.map((d) => d.postingNumber).join(', ')}
      </p>
    </div>
  </div>
);

export default OrdersDuplicatesAlert;
