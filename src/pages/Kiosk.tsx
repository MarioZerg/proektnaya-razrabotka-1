import { useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchKioskOrder, closeKioskOrder, type KioskOrder } from '@/lib/kioskApi';
import { playScanSound } from '@/lib/scanSound';

const Kiosk = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [orderNumber, setOrderNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<KioskOrder | null>(null);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    const value = orderNumber.trim();
    if (!value) return;
    setSearching(true);
    setOrder(null);
    try {
      const found = await fetchKioskOrder(value);
      playScanSound();
      setOrder(found);
    } catch (e) {
      toast({ title: 'Заказ не найден', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const handleClose = async () => {
    if (!order || !user) return;
    setClosing(true);
    try {
      await closeKioskOrder(order.id, user.id, user.id, user.name);
      toast({ title: `Заказ ${order.orderNumber} закрыт`, description: 'Начислена зарплата швее и упаковщице' });
      setOrder(null);
      setOrderNumber('');
      inputRef.current?.focus();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setClosing(false);
    }
  };

  return (
    <CrmLayout>
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-xl font-bold">Терминал стикеровки</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Найдите заказ по номеру и закройте его после стикеровки
          </p>
        </div>

        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Отсканируйте или введите номер заказа
            </div>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                autoFocus
                placeholder="Номер заказа"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                disabled={searching}
                className="font-mono-tech"
              />
              <Button onClick={handleSearch} disabled={searching || !orderNumber.trim()}>
                {searching ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Найти'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {order && (
          <Card className="border-border shadow-none">
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Номер заказа</span>
                  <span className="font-mono-tech font-medium">{order.orderNumber}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Товар</span>
                  <span className="font-medium">{order.product}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Материал / размер</span>
                  <span className="font-medium">
                    {order.material} {order.width}×{order.height}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Швея</span>
                  <span className="font-medium">{order.assignedUserName || '—'}</span>
                </div>
              </div>
              <Button className="w-full" onClick={handleClose} disabled={closing}>
                {closing ? (
                  <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="Check" size={16} className="mr-2" />
                )}
                Закрыть заказ
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </CrmLayout>
  );
};

export default Kiosk;