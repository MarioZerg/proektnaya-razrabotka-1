
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";

// Страницы загружаются по мере открытия, а не все сразу при входе.
// Раньше в первый файл попадали все 45 страниц — он весил 2.4 МБ, и на телефоне
// вход открывался очень долго. Экран входа и терминал цеха грузим сразу: это
// первые экраны, их ждать нельзя.
const Crm = lazy(() => import("./pages/Crm"));
const Chat = lazy(() => import("./pages/Chat"));
const WarehouseMaterials = lazy(() => import("./pages/inventory/WarehouseMaterials"));
const WorkshopMaterials = lazy(() => import("./pages/inventory/WorkshopMaterials"));
const Rolls = lazy(() => import("./pages/inventory/Rolls"));
const RollShow = lazy(() => import("./pages/inventory/RollShow"));
const FromSupplier = lazy(() => import("./pages/shipments/FromSupplier"));
const SupplyShow = lazy(() => import("./pages/shipments/SupplyShow"));
const ToWorkshop = lazy(() => import("./pages/shipments/ToWorkshop"));
const ReturnToSupplier = lazy(() => import("./pages/shipments/ReturnToSupplier"));
const DefectWriteoff = lazy(() => import("./pages/shipments/DefectWriteoff"));
const ToMarketplace = lazy(() => import("./pages/shipments/ToMarketplace"));
const ReceiveReturns = lazy(() => import("./pages/shipments/ReceiveReturns"));
const ReturnPickupCodes = lazy(() => import("./pages/shipments/ReturnPickupCodes"));
const MarketplaceSupplyShow = lazy(() => import("./pages/shipments/MarketplaceSupplyShow"));
const MarketplaceSupplyAssemble = lazy(() => import("./pages/shipments/MarketplaceSupplyAssemble"));
const GoodsWarehouse = lazy(() => import("./pages/inventory/GoodsWarehouse"));
const Stocktakes = lazy(() => import("./pages/inventory/Stocktakes"));
const VarikiShop = lazy(() => import("./pages/variki/VarikiShop"));
const VarikiShopManage = lazy(() => import("./pages/variki/VarikiShopManage"));
const GoodsPicking = lazy(() => import("./pages/inventory/GoodsPicking"));
const PackerRepack = lazy(() => import("./pages/inventory/PackerRepack"));
const GoodsCard = lazy(() => import("./pages/inventory/GoodsCard"));
const ReturnsInspection = lazy(() => import("./pages/inventory/ReturnsInspection"));
const PackagingGuide = lazy(() => import("./pages/inventory/PackagingGuide"));
const WarehouseGuide = lazy(() => import("./pages/inventory/WarehouseGuide"));
const RollsGuide = lazy(() => import("./pages/inventory/RollsGuide"));
const PackerGuide = lazy(() => import("./pages/inventory/PackerGuide"));
const DefectGuide = lazy(() => import("./pages/inventory/DefectGuide"));
const DefectReceive = lazy(() => import("./pages/inventory/DefectReceive"));
const ContractsGuide = lazy(() => import("./pages/inventory/ContractsGuide"));
const FboFbsGuide = lazy(() => import("./pages/inventory/FboFbsGuide"));
const PickingGuide = lazy(() => import("./pages/inventory/PickingGuide"));
const StatusesGuide = lazy(() => import("./pages/inventory/StatusesGuide"));
const PenaltiesGuide = lazy(() => import("./pages/inventory/PenaltiesGuide"));
const TerminationGuide = lazy(() => import("./pages/inventory/TerminationGuide"));
const CuttingGuide = lazy(() => import("./pages/inventory/CuttingGuide"));
const ShelvesSettings = lazy(() => import("./pages/settings/ShelvesSettings"));
const MaterialsSettings = lazy(() => import("./pages/settings/MaterialsSettings"));
const HangersSettings = lazy(() => import("./pages/settings/HangersSettings"));
const UsersSettings = lazy(() => import("./pages/settings/UsersSettings"));
const CompanySettings = lazy(() => import("./pages/settings/CompanySettings"));
const SchedulerSettings = lazy(() => import("./pages/settings/SchedulerSettings"));
const Logs = lazy(() => import("./pages/settings/Logs"));
const PendingEmployees = lazy(() => import("./pages/settings/PendingEmployees"));
const MarketplaceOrders = lazy(() => import("./pages/marketplace/MarketplaceOrders"));
const LoginCode = lazy(() => import("./pages/LoginCode"));
const SewingItems = lazy(() => import("./pages/marketplace/SewingItems"));
const FboStickers = lazy(() => import("./pages/marketplace/FboStickers"));
const Reviews = lazy(() => import("./pages/marketplace/Reviews"));
const CancellationAnalytics = lazy(() => import("./pages/marketplace/CancellationAnalytics"));
const Finance = lazy(() => import("./pages/Finance"));
const Buyouts = lazy(() => import("./pages/finance/Buyouts"));
const Workshops = lazy(() => import("./pages/shifts/Workshops"));
const WorkshopEdit = lazy(() => import("./pages/shifts/WorkshopEdit"));
const ShiftsList = lazy(() => import("./pages/shifts/ShiftsList"));
const GuestShifts = lazy(() => import("./pages/shifts/GuestShifts"));
const ShiftDetail = lazy(() => import("./pages/shifts/ShiftDetail"));
const ShiftsCalendar = lazy(() => import("./pages/shifts/ShiftsCalendar"));
const SuppliersSettings = lazy(() => import("./pages/settings/SuppliersSettings"));
const MarketplaceItemsSettings = lazy(() => import("./pages/settings/MarketplaceItemsSettings"));
const MarketplaceIntegrationsSettings = lazy(() => import("./pages/settings/MarketplaceIntegrationsSettings"));
const Kiosk = lazy(() => import("./pages/Kiosk"));
const AiAssistant = lazy(() => import("./pages/AiAssistant"));
const Contracts = lazy(() => import("./pages/Contracts"));
const PrivacyPolicy = lazy(() => import("./pages/legal/PrivacyPolicy"));
const PersonalDataConsent = lazy(() => import("./pages/legal/PersonalDataConsent"));
const RollShortageAnalysis = lazy(() => import("./pages/analytics/RollShortageAnalysis"));
const ReturnsAnalysis = lazy(() => import("./pages/analytics/ReturnsAnalysis"));
const DefectAnalysis = lazy(() => import("./pages/analytics/DefectAnalysis"));
const ProductCost = lazy(() => import("./pages/analytics/ProductCost"));
const UnitEconomics = lazy(() => import("./pages/analytics/UnitEconomics"));
const Promotion = lazy(() => import("./pages/analytics/Promotion"));
import Index from "./pages/Index";

import NotFoundRedirect from "./pages/NotFoundRedirect";

import KioskTerminal from "./pages/KioskTerminal";
import { AuthProvider } from "@/context/AuthContext";
import ImpersonationBar from "@/components/crm/users/ImpersonationBar";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          {/* Пока администратор смотрит панель сотрудника — заметная полоса с
              кнопкой возврата в свой аккаунт. */}
          <ImpersonationBar />
          {/* Пока подгружается страница, показываем спокойную заглушку —
              иначе на секунду мелькал бы пустой белый экран. */}
          <Suspense
            fallback={
              <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              </div>
            }
          >
          <Routes>
            <Route path="/" element={<Index />} />
            {/* Ввод кода из MAX — отдельная страница со своим адресом: человек уходит
                за кодом в мессенджер, и вернуться нужно ровно на форму ввода. */}
            <Route path="/login/code" element={<LoginCode />} />
            {/* Терминал цеха: вход по личному QR-коду сотрудника, без пароля. */}
            <Route path="/kiosk/:workshopId" element={<KioskTerminal />} />
            <Route path="/crm" element={<Crm />} />
            <Route path="/crm/chat" element={<Chat />} />
            <Route path="/crm/inventory/warehouse-materials" element={<WarehouseMaterials />} />
            <Route path="/crm/analytics/roll-shortage" element={<RollShortageAnalysis />} />
            <Route path="/crm/analytics/returns" element={<ReturnsAnalysis />} />
            <Route path="/crm/analytics/defects" element={<DefectAnalysis />} />
            <Route path="/crm/analytics/product-cost" element={<ProductCost />} />
            <Route path="/crm/analytics/unit-economics" element={<UnitEconomics />} />
            <Route path="/crm/analytics/promotion" element={<Promotion />} />
            <Route path="/crm/inventory/workshop-materials" element={<WorkshopMaterials />} />
            <Route path="/crm/inventory/rolls" element={<Rolls />} />
            <Route path="/crm/inventory/rolls/:id" element={<RollShow />} />
            <Route path="/crm/shipments/from-supplier" element={<FromSupplier />} />
            <Route path="/crm/shipments/from-supplier/:id" element={<SupplyShow />} />
            <Route path="/crm/shipments/to-workshop" element={<ToWorkshop />} />
            <Route path="/crm/shipments/return-to-supplier" element={<ReturnToSupplier />} />
            <Route path="/crm/shipments/defect-writeoff" element={<DefectWriteoff />} />
            <Route path="/crm/shipments/receive-returns" element={<ReceiveReturns />} />
            <Route path="/crm/shipments/return-codes" element={<ReturnPickupCodes />} />
            <Route path="/crm/shipments/to-marketplace" element={<ToMarketplace />} />
            <Route path="/crm/shipments/to-marketplace/:id" element={<MarketplaceSupplyShow />} />
            <Route path="/crm/shipments/to-marketplace/:id/assemble" element={<MarketplaceSupplyAssemble />} />
            <Route path="/crm/inventory/goods-warehouse" element={<GoodsWarehouse />} />
            <Route path="/crm/inventory/stocktakes" element={<Stocktakes />} />
            <Route path="/crm/variki/shop" element={<VarikiShop />} />
            <Route path="/crm/variki/manage" element={<VarikiShopManage />} />
            <Route path="/crm/inventory/goods-picking" element={<GoodsPicking />} />
            <Route path="/crm/inventory/packer-repack" element={<PackerRepack />} />
            <Route path="/crm/inventory/goods/:id" element={<GoodsCard />} />
            <Route path="/crm/inventory/returns-inspection" element={<ReturnsInspection />} />
            <Route path="/crm/inventory/packaging-guide" element={<PackagingGuide />} />
            <Route path="/crm/inventory/warehouse-guide" element={<WarehouseGuide />} />
            <Route path="/crm/inventory/rolls-guide" element={<RollsGuide />} />
            <Route path="/crm/inventory/packer-guide" element={<PackerGuide />} />
            <Route path="/crm/inventory/defect-guide" element={<DefectGuide />} />
            <Route path="/crm/inventory/defect-receive" element={<DefectReceive />} />
            <Route path="/crm/inventory/contracts-guide" element={<ContractsGuide />} />
            <Route path="/crm/inventory/fbo-fbs-guide" element={<FboFbsGuide />} />
            <Route path="/crm/inventory/picking-guide" element={<PickingGuide />} />
            <Route path="/crm/inventory/statuses-guide" element={<StatusesGuide />} />
            <Route path="/crm/inventory/penalties-guide" element={<PenaltiesGuide />} />
            <Route path="/crm/inventory/termination-guide" element={<TerminationGuide />} />
            <Route path="/crm/inventory/cutting-guide" element={<CuttingGuide />} />
            <Route path="/crm/settings/shelves" element={<ShelvesSettings />} />
            <Route path="/crm/settings/materials" element={<MaterialsSettings />} />
            <Route path="/crm/settings/hangers" element={<HangersSettings />} />
            <Route path="/crm/settings/users" element={<UsersSettings />} />
            <Route path="/crm/settings/company" element={<CompanySettings />} />
            <Route path="/crm/settings/scheduler" element={<SchedulerSettings />} />
            <Route path="/crm/settings/logs" element={<Logs />} />
            <Route path="/crm/settings/pending-employees" element={<PendingEmployees />} />
            <Route path="/crm/marketplace/orders" element={<MarketplaceOrders />} />
            <Route path="/crm/marketplace/sewing-items" element={<SewingItems />} />
            {/* Печать стикеров FBO временно скрыта из меню — позже её интегрируем прямо
                со склада. Маршрут оставлен рабочим по прямой ссылке. */}
            <Route path="/crm/marketplace/fbo-stickers" element={<FboStickers />} />
            <Route path="/crm/marketplace/reviews" element={<Reviews />} />
            <Route path="/crm/marketplace/cancellations" element={<CancellationAnalytics />} />
            <Route path="/crm/finance" element={<Finance />} />
            <Route path="/crm/finance/buyouts" element={<Buyouts />} />
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
            <Route path="/crm/assistant" element={<AiAssistant />} />
            <Route path="/crm/contracts" element={<Contracts />} />
            {/* Юридические документы — открыты без входа: их читают до регистрации. */}
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/consent" element={<PersonalDataConsent />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFoundRedirect />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;