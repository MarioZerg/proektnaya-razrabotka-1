import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { fetchSewerAccrualPreview, type SewerAccrualPreview } from '@/lib/ordersApi';

interface Props {
  orderId: number;
  sewerId: number | null;
  sewerName?: string;
  /** Закрываем в «Готовые» прямо сейчас — начисление создастся этим переводом. */
  immediate: boolean;
}

/**
 * Что получит сотрудник за пошив. Админ видит сумму ДО перевода и то, что
 * второго начисления за тот же заказ не будет.
 */
const SewerAccrualPreviewBox = ({ orderId, sewerId, sewerName, immediate }: Props) => {
  const [data, setData] = useState<SewerAccrualPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSewerAccrualPreview(orderId, sewerId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [orderId, sewerId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Считаем начисление...
      </div>
    );
  }
  if (error) {
    return <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  }
  if (!data) return null;

  if (data.existing) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        <Icon name="ShieldCheck" size={18} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          За пошив этого заказа уже начислено{' '}
          <b>
            {data.existing.userName || `#${data.existing.userId}`} — {data.existing.amount} ₽
          </b>
          {data.existing.paid ? ' (выплачено)' : ''}. Повторного начисления не будет.
        </span>
      </div>
    );
  }

  if (data.amount > 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <Icon name="Wallet" size={18} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          {immediate ? 'Сейчас будет начислено' : 'Когда заказ станет «Готовые», будет начислено'}{' '}
          <b>
            {sewerName || 'сотруднику'}: {data.amount} ₽
          </b>
          <span className="block text-xs opacity-80">{data.description}. Один раз — дублей не будет.</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">Начисления не будет: {data.reason}</span>
    </div>
  );
};

export default SewerAccrualPreviewBox;
