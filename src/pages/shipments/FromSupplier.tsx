import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import useFromSupplierList from '@/components/crm/shipments/useFromSupplierList';
import useFromSupplierForms from '@/components/crm/shipments/useFromSupplierForms';
import FromSupplierContent from '@/components/crm/shipments/FromSupplierContent';

const FromSupplier = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Кладовщик правит состав приёмки, пока её не принял администратор: свою опечатку
  // он замечает сразу при разгрузке, а раньше ждал админа — машина уже уехала.
  const canEditPending = isStorekeeperRole(user?.role);

  const list = useFromSupplierList();
  const forms = useFromSupplierForms({
    isAdmin,
    userId: user?.id,
    suppliers: list.suppliers,
    load: list.load,
  });

  return (
    <CrmLayout>
      <FromSupplierContent
        isAdmin={isAdmin}
        canEditPending={canEditPending}
        list={list}
        forms={forms}
      />
    </CrmLayout>
  );
};

export default FromSupplier;
