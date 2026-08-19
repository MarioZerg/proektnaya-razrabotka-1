import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAllPurchases,
  attachCoupon,
  cancelPurchase,
  type VarikiPurchase,
} from '@/lib/varikiApi';
import { formatDateTime } from '@/lib/dateUtils';

/**
 * Покупки за варики — блок на панели администратора.
 *
 * Сотрудник купил подарок, варики с него уже списаны, а сертификат нужно достать
 * из внешнего сервиса и прислать. Без этого блока покупка терялась бы: человек
 * заплатил и ждёт, а админ о заявке не знает.
 *
 * Пока купон не прикреплён, блок висит на панели и не даёт про него забыть.
 * Прикрепили PDF — заявка уходит из списка, а файл появляется у сотрудника.
 */
/** «2026-09-01» -> «01.09.2026»: дата брони читается привычнее. */
const formatVisitDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const VarikiPurchasesCard = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [items, setItems] = useState<VarikiPurchase[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  const load = () => {
    if (!user?.id) return;
    fetchAllPurchases(user.id)
      .then((d) => setItems(d.purchases.filter((p) => p.status === 'pending')))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const pickFile = (purchaseId: number) => {
    setTargetId(purchaseId);
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Сбрасываем значение сразу: иначе повторный выбор ТОГО ЖЕ файла не вызовет
    // событие, и админ решит, что кнопка сломалась.
    e.target.value = '';
    if (!file || !targetId) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Файл больше 10 МБ', variant: 'destructive' });
      return;
    }

    setBusyId(targetId);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
      });
      await attachCoupon(targetId, base64, file.name, user?.id, user?.name);
      toast({
        title: 'Купон отправлен',
        description: 'Сотрудник увидит его в магазине вариков',
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось прикрепить купон',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
      setTargetId(null);
    }
  };

  const handleCancel = async (p: VarikiPurchase) => {
    const reason = window.prompt(
      `Отменить покупку «${p.title}»? Сотруднику вернётся ${p.price} вариков.\n\nПричина:`,
    );
    if (!reason?.trim()) return;
    setBusyId(p.id);
    try {
      await cancelPurchase(p.id, reason.trim(), user?.id, user?.name);
      toast({ title: 'Покупка отменена', description: 'Варики возвращены сотруднику' });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось отменить',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFile}
      />

      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name="Gift" size={18} className="text-violet-600" />
        Покупки за варики
        <span className="rounded-full bg-violet-100 px-2 text-sm text-violet-700">
          {items.length}
        </span>
      </h2>

      <div className="space-y-2">
        {items.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-300 bg-violet-50 p-3"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {p.userName || `Сотрудник #${p.userId}`} — {p.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.createdAt ? formatDateTime(p.createdAt) : ''} · списано {p.price} вариков
              </p>

              {/* Дата посещения — то, ради чего заявка вообще пришла: админ звонит
                  в организацию и бронирует место именно на этот день. Выделяем,
                  чтобы её было видно сразу, не вчитываясь в строку. */}
              {p.visitDate && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-violet-900">
                  <Icon name="CalendarCheck" size={15} className="shrink-0" />
                  Хочет посетить: {formatVisitDate(p.visitDate)}
                </p>
              )}

              {/* Куда звонить для брони — прямо здесь, чтобы не искать подарок. */}
              {p.visitDate && (p.orgAddress || p.orgPhone) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[p.orgAddress, p.orgPhone].filter(Boolean).join(' · ')}
                </p>
              )}

              <p className="mt-0.5 text-xs font-medium text-violet-800">
                {p.visitDate
                  ? 'Забронируйте место и прикрепите PDF-сертификат'
                  : 'Прикрепите PDF-купон — сотрудник получит его в магазине'}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="secondary">Ждёт купон</Badge>
              <Button
                size="sm"
                disabled={busyId === p.id}
                onClick={() => pickFile(p.id)}
              >
                <Icon
                  name={busyId === p.id ? 'Loader2' : 'Upload'}
                  size={15}
                  className={`mr-1.5 ${busyId === p.id ? 'animate-spin' : ''}`}
                />
                Прикрепить купон
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === p.id}
                onClick={() => handleCancel(p)}
              >
                Отменить
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VarikiPurchasesCard;
