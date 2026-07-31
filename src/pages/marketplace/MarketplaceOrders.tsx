import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrders,
  createManualOrder,
  updateOrder,
  deleteOrder,
  type Order,
} from '@/lib/ordersApi';
import { emptyManualForm, type EditFormState } from '@/components/crm/orders/ordersShared';
import OrdersToolbar from '@/components/crm/orders/OrdersToolbar';
import OrdersTable from '@/components/crm/orders/OrdersTable';
import EditOrderDialog from '@/components/crm/orders/EditOrderDialog';
import CreateManualOrderDialog from '@/components/crm/orders/CreateManualOrderDialog';

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<EditFormState>(emptyManualForm);
  const [manualSaving, setManualSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      orderType: order.orderType,
      status: order.status,
      product: order.product,
    });
  };

  const closeEdit = () => {
    setEditingOrder(null);
    setForm(null);
  };

  const handleSave = async () => {
    if (!editingOrder || !form) return;
    setSaving(true);
    try {
      await updateOrder(editingOrder.id, {
        orderNumber: form.orderNumber.trim(),
        marketplace: form.marketplace,
        orderType: form.orderType,
        status: form.status,
        product: form.product,
      });
      closeEdit();
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить заказ',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteOrder(id);
    load();
  };

  const openManual = () => {
    setManualForm(emptyManualForm);
    setManualOpen(true);
  };

  const handleManualCreate = async () => {
    if (!manualForm.orderNumber.trim()) return;
    setManualSaving(true);
    try {
      await createManualOrder({
        orderNumber: manualForm.orderNumber.trim(),
        marketplace: manualForm.marketplace,
        orderType: manualForm.orderType,
        product: manualForm.product,
      });
      setManualOpen(false);
      load();
      toast({ title: 'Заказ создан', description: `№ ${manualForm.orderNumber}` });
    } catch (err) {
      toast({
        title: 'Заказ не создан',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        <OrdersToolbar onOpenManual={openManual} />

        <OrdersTable loading={loading} orders={orders} onEdit={openEdit} onDelete={handleDelete} />
      </div>

      <EditOrderDialog
        editingOrder={editingOrder}
        form={form}
        setForm={setForm}
        saving={saving}
        onClose={closeEdit}
        onSave={handleSave}
      />

      <CreateManualOrderDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        manualForm={manualForm}
        setManualForm={setManualForm}
        manualSaving={manualSaving}
        onCreate={handleManualCreate}
      />
    </CrmLayout>
  );
};

export default MarketplaceOrders;
