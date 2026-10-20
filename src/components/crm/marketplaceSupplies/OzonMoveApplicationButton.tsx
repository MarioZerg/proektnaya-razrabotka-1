import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { moveOzonSupplyToApplication } from '@/lib/ozonFboApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

const CLOSED = ['Выполнена', 'Отменена', 'Принята'];

/**
 * Перенос собранной поставки в другую заявку OZON — когда заявку пересоздали
 * под другой кластер. Заказы и короба переезжают как есть, пошив не создаётся.
 */
const OzonMoveApplicationButton = ({ supply }: { supply: SupplyDetail }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  if (user?.role !== 'admin' || user.isImpersonated || CLOSED.includes(supply.status)) return null;

  const handleMove = async () => {
    setBusy(true);
    try {
      const r = await moveOzonSupplyToApplication(supply.id, number.trim());
      toast({
        title: `Поставка перенесена в заявку ${r.orderNumber}`,
        description: `Кластер: ${r.cluster || '—'}. Заказов: ${r.movedOrders}, коробов: ${r.movedBoxes}. Закройте короба заново и переклейте стикеры. Заявка Газельки сброшена — привяжите новую под этот склад.`,
      });
      setOpen(false);
      navigate(`/crm/shipments/to-marketplace/${r.supplyId}`);
    } catch (e) {
      toast({
        title: 'Не удалось перенести',
        description: e instanceof Error ? e.message : 'Ошибка',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Icon name="ArrowRightLeft" size={14} className="mr-1.5" />
        Перенести в другую заявку OZON
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Перенос в другую заявку OZON</DialogTitle>
            <DialogDescription>
              Все заказы и короба переедут в новую поставку с кластером новой заявки. В пошив ничего не
              уйдёт. Эта поставка станет «Отменена». Короба откроются — их нужно закрыть заново и
              переклеить новые стикеры. Старую заявку на OZON отмените вручную.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Номер новой заявки OZON</Label>
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="Например: 2000070845299"
              inputMode="numeric"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button onClick={() => void handleMove()} disabled={busy || number.trim().length < 6}>
              {busy && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
              Перенести
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OzonMoveApplicationButton;