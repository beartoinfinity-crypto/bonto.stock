import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Screener from "./pages/Screener";
import Tactical from "./pages/Tactical";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import ApiSettings from "./pages/ApiSettings";
import Admin from "./pages/Admin";
import { purgeExpired } from "@/lib/localDb";
import { startScheduler } from "@/lib/localCron";
import { LanguageProvider } from "@/lib/i18n";

// Purge expired SQLite entries on startup
purgeExpired().then(n => { if (n > 0) console.log(`[LocalDB] Purged ${n} expired entries`); });

// Start local cron scheduler
startScheduler();

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/tactical" element={<Tactical />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/api-settings" element={<ApiSettings />} />
            <Route path="/admin" element={<Admin />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
