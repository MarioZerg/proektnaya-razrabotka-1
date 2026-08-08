
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Crm from "./pages/Crm";
import NotFoundRedirect from "./pages/NotFoundRedirect";
import WarehouseMaterials from "./pages/inventory/WarehouseMaterials";
import WorkshopMaterials from "./pages/inventory/WorkshopMaterials";
import Rolls from "./pages/inventory/Rolls";
import RollShow from "./pages/inventory/RollShow";
import FromSupplier from "./pages/shipments/FromSupplier";
import ToWorkshop from "./pages/shipments/ToWorkshop";
import ReturnToSupplier from "./pages/shipments/ReturnToSupplier";
import DefectWriteoff from "./pages/shipments/DefectWriteoff";
import ToMarketplace from "./pages/shipments/ToMarketplace";
import ReceiveReturns from "./pages/shipments/ReceiveReturns";
import MarketplaceSupplyShow from "./pages/shipments/MarketplaceSupplyShow";
import MarketplaceSupplyAssemble from "./pages/shipments/MarketplaceSupplyAssemble";
import GoodsWarehouse from "./pages/inventory/GoodsWarehouse";
import GoodsPicking from "./pages/inventory/GoodsPicking";
import PackagingGuide from "./pages/inventory/PackagingGuide";
import ShelvesSettings from "./pages/settings/ShelvesSettings";
import MaterialsSettings from "./pages/settings/MaterialsSettings";
import HangersSettings from "./pages/settings/HangersSettings";
import UsersSettings from "./pages/settings/UsersSettings";
import PendingEmployees from "./pages/settings/PendingEmployees";
import MarketplaceOrders from "./pages/marketplace/MarketplaceOrders";
import SewingItems from "./pages/marketplace/SewingItems";
import FboStickers from "./pages/marketplace/FboStickers";
import Reviews from "./pages/marketplace/Reviews";
import Finance from "./pages/Finance";
import Workshops from "./pages/shifts/Workshops";
import WorkshopEdit from "./pages/shifts/WorkshopEdit";
import ShiftsList from "./pages/shifts/ShiftsList";
import GuestShifts from "./pages/shifts/GuestShifts";
import ShiftDetail from "./pages/shifts/ShiftDetail";
import ShiftsCalendar from "./pages/shifts/ShiftsCalendar";
import SuppliersSettings from "./pages/settings/SuppliersSettings";
import MarketplaceItemsSettings from "./pages/settings/MarketplaceItemsSettings";
import MarketplaceIntegrationsSettings from "./pages/settings/MarketplaceIntegrationsSettings";
import Kiosk from "./pages/Kiosk";
import Contracts from "./pages/Contracts";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import PersonalDataConsent from "./pages/legal/PersonalDataConsent";
import RollShortageAnalysis from "./pages/analytics/RollShortageAnalysis";
import ReturnsAnalysis from "./pages/analytics/ReturnsAnalysis";
import DefectAnalysis from "./pages/analytics/DefectAnalysis";
import KioskTerminal from "./pages/KioskTerminal";
import { AuthProvider } from "@/context/AuthContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* Терминал цеха: вход по личному QR-коду сотрудника, без пароля. */}
            <Route path="/kiosk/:workshopId" element={<KioskTerminal />} />
            <Route path="/crm" element={<Crm />} />
            <Route path="/crm/inventory/warehouse-materials" element={<WarehouseMaterials />} />
            <Route path="/crm/analytics/roll-shortage" element={<RollShortageAnalysis />} />
            <Route path="/crm/analytics/returns" element={<ReturnsAnalysis />} />
            <Route path="/crm/analytics/defects" element={<DefectAnalysis />} />
            <Route path="/crm/inventory/workshop-materials" element={<WorkshopMaterials />} />
            <Route path="/crm/inventory/rolls" element={<Rolls />} />
            <Route path="/crm/inventory/rolls/:id" element={<RollShow />} />
            <Route path="/crm/shipments/from-supplier" element={<FromSupplier />} />
            <Route path="/crm/shipments/to-workshop" element={<ToWorkshop />} />
            <Route path="/crm/shipments/return-to-supplier" element={<ReturnToSupplier />} />
            <Route path="/crm/shipments/defect-writeoff" element={<DefectWriteoff />} />
            <Route path="/crm/shipments/receive-returns" element={<ReceiveReturns />} />
            <Route path="/crm/shipments/to-marketplace" element={<ToMarketplace />} />
            <Route path="/crm/shipments/to-marketplace/:id" element={<MarketplaceSupplyShow />} />
            <Route path="/crm/shipments/to-marketplace/:id/assemble" element={<MarketplaceSupplyAssemble />} />
            <Route path="/crm/inventory/goods-warehouse" element={<GoodsWarehouse />} />
            <Route path="/crm/inventory/goods-picking" element={<GoodsPicking />} />
            <Route path="/crm/inventory/packaging-guide" element={<PackagingGuide />} />
            <Route path="/crm/settings/shelves" element={<ShelvesSettings />} />
            <Route path="/crm/settings/materials" element={<MaterialsSettings />} />
            <Route path="/crm/settings/hangers" element={<HangersSettings />} />
            <Route path="/crm/settings/users" element={<UsersSettings />} />
            <Route path="/crm/settings/pending-employees" element={<PendingEmployees />} />
            <Route path="/crm/marketplace/orders" element={<MarketplaceOrders />} />
            <Route path="/crm/marketplace/sewing-items" element={<SewingItems />} />
            {/* Печать стикеров FBO временно скрыта из меню — позже её интегрируем прямо
                со склада. Маршрут оставлен рабочим по прямой ссылке. */}
            <Route path="/crm/marketplace/fbo-stickers" element={<FboStickers />} />
            <Route path="/crm/marketplace/reviews" element={<Reviews />} />
            <Route path="/crm/finance" element={<Finance />} />
            <Route path="/crm/shifts/workshops" element={<Workshops />} />
            <Route path="/crm/shifts/workshops/:id/edit" element={<WorkshopEdit />} />
            <Route path="/crm/shifts/list" element={<ShiftsList />} />
            <Route path="/crm/shifts/:id" element={<ShiftDetail />} />
            <Route path="/crm/shifts/calendar" element={<ShiftsCalendar />} />
            <Route path="/crm/shifts/guests" element={<GuestShifts />} />
            <Route path="/crm/settings/suppliers" element={<SuppliersSettings />} />
            <Route path="/crm/settings/marketplace-items" element={<MarketplaceItemsSettings />} />
            <Route path="/crm/settings/marketplace-integrations" element={<MarketplaceIntegrationsSettings />} />
            <Route path="/crm/kiosk" element={<Kiosk />} />
            <Route path="/crm/contracts" element={<Contracts />} />
            {/* Юридические документы — открыты без входа: их читают до регистрации. */}
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/consent" element={<PersonalDataConsent />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFoundRedirect />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;