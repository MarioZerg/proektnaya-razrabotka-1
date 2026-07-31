
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Crm from "./pages/Crm";
import NotFound from "./pages/NotFound";
import WarehouseMaterials from "./pages/inventory/WarehouseMaterials";
import MaterialsSettings from "./pages/settings/MaterialsSettings";
import UsersSettings from "./pages/settings/UsersSettings";
import MarketplaceOrders from "./pages/marketplace/MarketplaceOrders";
import Workshops from "./pages/shifts/Workshops";
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
            <Route path="/crm/settings/materials" element={<MaterialsSettings />} />
            <Route path="/crm/settings/users" element={<UsersSettings />} />
            <Route path="/crm/marketplace/orders" element={<MarketplaceOrders />} />
            <Route path="/crm/shifts/workshops" element={<Workshops />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;