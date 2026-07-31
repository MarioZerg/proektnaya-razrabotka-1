
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Crm from "./pages/Crm";
import NotFound from "./pages/NotFound";
import WarehouseMaterials from "./pages/inventory/WarehouseMaterials";
import Rolls from "./pages/inventory/Rolls";
import FromSupplier from "./pages/shipments/FromSupplier";
import ToWorkshop from "./pages/shipments/ToWorkshop";
import ReturnToSupplier from "./pages/shipments/ReturnToSupplier";
import DefectWriteoff from "./pages/shipments/DefectWriteoff";
import ToMarketplace from "./pages/shipments/ToMarketplace";
import GoodsWarehouse from "./pages/inventory/GoodsWarehouse";
import ShelvesSettings from "./pages/settings/ShelvesSettings";
import MaterialsSettings from "./pages/settings/MaterialsSettings";
import UsersSettings from "./pages/settings/UsersSettings";
import MarketplaceOrders from "./pages/marketplace/MarketplaceOrders";
import SewingItems from "./pages/marketplace/SewingItems";
import FboStickers from "./pages/marketplace/FboStickers";
import Finance from "./pages/Finance";
import Workshops from "./pages/shifts/Workshops";
import WorkshopEdit from "./pages/shifts/WorkshopEdit";
import ShiftsList from "./pages/shifts/ShiftsList";
import ShiftsCalendar from "./pages/shifts/ShiftsCalendar";
import SystemSettings from "./pages/settings/SystemSettings";
import SuppliersSettings from "./pages/settings/SuppliersSettings";
import MarketplaceItemsSettings from "./pages/settings/MarketplaceItemsSettings";
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
            <Route path="/crm" element={<Crm />} />
            <Route path="/crm/inventory/warehouse-materials" element={<WarehouseMaterials />} />
            <Route path="/crm/inventory/rolls" element={<Rolls />} />
            <Route path="/crm/shipments/from-supplier" element={<FromSupplier />} />
            <Route path="/crm/shipments/to-workshop" element={<ToWorkshop />} />
            <Route path="/crm/shipments/return-to-supplier" element={<ReturnToSupplier />} />
            <Route path="/crm/shipments/defect-writeoff" element={<DefectWriteoff />} />
            <Route path="/crm/shipments/to-marketplace" element={<ToMarketplace />} />
            <Route path="/crm/inventory/goods-warehouse" element={<GoodsWarehouse />} />
            <Route path="/crm/settings/shelves" element={<ShelvesSettings />} />
            <Route path="/crm/settings/materials" element={<MaterialsSettings />} />
            <Route path="/crm/settings/users" element={<UsersSettings />} />
            <Route path="/crm/marketplace/orders" element={<MarketplaceOrders />} />
            <Route path="/crm/marketplace/sewing-items" element={<SewingItems />} />
            <Route path="/crm/marketplace/fbo-stickers" element={<FboStickers />} />
            <Route path="/crm/finance" element={<Finance />} />
            <Route path="/crm/shifts/workshops" element={<Workshops />} />
            <Route path="/crm/shifts/workshops/:id/edit" element={<WorkshopEdit />} />
            <Route path="/crm/shifts/list" element={<ShiftsList />} />
            <Route path="/crm/shifts/calendar" element={<ShiftsCalendar />} />
            <Route path="/crm/settings/system" element={<SystemSettings />} />
            <Route path="/crm/settings/suppliers" element={<SuppliersSettings />} />
            <Route path="/crm/settings/marketplace-items" element={<MarketplaceItemsSettings />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;