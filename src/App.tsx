import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Screener from "./pages/Screener";
import Tactical from "./pages/Tactical";
import TradingMasters from "./pages/TradingMasters";
import MasterMatrix from "./pages/MasterMatrix";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import ApiSettings from "./pages/ApiSettings";
import Admin from "./pages/Admin";
import { purgeExpired } from "@/lib/localDb";
import { startScheduler } from "@/lib/localCron";
import { getClient, pullAll } from "@/lib/supabaseDb";
import { LanguageProvider } from "@/lib/i18n";

// Purge expired SQLite entries on startup
purgeExpired().then(n => { if (n > 0) console.log(`[LocalDB] Purged ${n} expired entries`); });

// Start local cron scheduler
startScheduler();

// Cloud-first hydration: Supabase is the primary store — refresh the local
// mirror (localStorage + SQLite) from the cloud shortly after boot.
setTimeout(() => {
  if (!getClient()) return;
  pullAll()
    .then(n => {
      if (n > 0) {
        console.log(`[SupabaseSync] Hydrated ${n} keys from cloud on boot`);
        window.dispatchEvent(new Event('stockpulse-sync'));
        window.dispatchEvent(new Event('stockpulse-politician-sync'));
      } else {
        console.log('[SupabaseSync] Boot hydration: cloud empty or unchanged');
      }
    })
    .catch(e => console.warn('[SupabaseSync] Boot hydration failed:', e));
}, 4000);

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
            <Route path="/masters" element={<TradingMasters />} />
            <Route path="/masters-matrix" element={<MasterMatrix />} />
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
