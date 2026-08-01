import { Switch, Route, Router } from "wouter";
import { useHashRoute } from "@/lib/useHashRoute";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Results from "@/pages/Results";
import SpotDetail from "@/pages/SpotDetail";
import Methodology from "@/pages/Methodology";
import Impressum from "@/pages/Impressum";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminChangePassword from "@/pages/admin/AdminChangePassword";
import AdminImpressum from "@/pages/admin/AdminImpressum";
import AdminData from "@/pages/admin/AdminData";
import AdminSpots from "@/pages/admin/AdminSpots";
import AdminSpotEditor from "@/pages/admin/AdminSpotEditor";
import AdminListingsSchools from "@/pages/admin/AdminListingsSchools";
import AdminListingsStays from "@/pages/admin/AdminListingsStays";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminSEO from "@/pages/admin/AdminSEO";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/results" component={Results} />
      <Route path="/spots/:slug" component={SpotDetail} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/legal-notice" component={Impressum} />
      <Route path="/impressum" component={Impressum} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/change-password" component={AdminChangePassword} />
      <Route path="/admin/legal" component={AdminImpressum} />
      <Route path="/admin/impressum" component={AdminImpressum} />
      <Route path="/admin/data" component={AdminData} />
      <Route path="/admin/seo" component={AdminSEO} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/spots" component={AdminSpots} />
      <Route path="/admin/spots/:id" component={AdminSpotEditor} />
      <Route path="/admin/listings/schools" component={AdminListingsSchools} />
      <Route path="/admin/listings/stays" component={AdminListingsStays} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashRoute}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
