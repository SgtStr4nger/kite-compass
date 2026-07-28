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
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminSpots from "@/pages/admin/AdminSpots";
import AdminSpotEditor from "@/pages/admin/AdminSpotEditor";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/results" component={Results} />
      <Route path="/spots/:slug" component={SpotDetail} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/spots" component={AdminSpots} />
      <Route path="/admin/spots/:id" component={AdminSpotEditor} />
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
