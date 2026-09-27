import CrmLayout from '@/components/crm/CrmLayout';
import AssembleShipmentView from '@/components/crm/shipments/AssembleShipmentView';
import ToWorkshopContent from '@/components/crm/shipments/ToWorkshopContent';
import { useToWorkshopState } from '@/components/crm/shipments/useToWorkshopState';
import { useToWorkshopActions } from '@/components/crm/shipments/useToWorkshopActions';

const ToWorkshop = () => {
  const state = useToWorkshopState();
  const actions = useToWorkshopActions(state);

  if (state.activeShipment) {
    return (
      <CrmLayout>
        <AssembleShipmentView
          activeShipment={state.activeShipment}
          scanCode={state.scanCode}
          setScanCode={state.setScanCode}
          scanning={state.scanning}
          scanInputRef={state.scanInputRef}
          onBack={() => state.setActiveShipment(null)}
          onScan={actions.handleScan}
          onShip={actions.handleShip}
          onRemoveRoll={actions.handleRemoveRoll}
        />
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <ToWorkshopContent state={state} actions={actions} />
    </CrmLayout>
  );
};

export default ToWorkshop;
