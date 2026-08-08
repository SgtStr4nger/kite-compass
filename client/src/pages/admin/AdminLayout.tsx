import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutGrid, FileText, ExternalLink, School, Hotel, Users, Search, Trash2, ArrowRightLeft, AlertCircle, CloudSun, Rocket, RefreshCw, Settings } from "lucide-react";
import { applyRobotsMetadata } from "@/lib/metadata";
import { api } from "@/lib/api";
import { ExcelImportStatus, ScoringStatus, WeatherRefreshStatus } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Sparkles } from "lucide-react";

type DeployResponse =
  | { ok: true; stdout: string; stderr?: string }
  | { ok: false; error: string; stdout?: string; stderr?: string };

export function AdminLayout({ children }: { children: ReactNode }) {
  const { email, logout, mustChangePassword, token, role } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const [excelStatus, setExcelStatus] = useState<ExcelImportStatus | null>(null);
  const [scoringStatus, setScoringStatus] = useState<ScoringStatus | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherRefreshStatus | null>(null);
  const [openErrorCount, setOpenErrorCount] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (mustChangePassword && location !== "/admin/change-password") navigate("/admin/change-password");
  }, [mustChangePassword, location, navigate]);

  useEffect(() => {
    applyRobotsMetadata("noindex,nofollow");
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timerId: number | null = null;

    const scheduleNext = (intervalMs: number) => {
      if (!alive) return;
      timerId = window.setTimeout(() => { void poll(); }, intervalMs);
    };

    const poll = async () => {
      try {
        const status = await api<ExcelImportStatus>("GET", "/api/admin/excel/status");
        if (!alive) return;
        setExcelStatus(status);
        // Active import → fast poll; terminal+dismissed → slow background check; otherwise medium
        if (status.active) scheduleNext(2000);
        else if (!status.visible) scheduleNext(30_000);
        else scheduleNext(5000);
      } catch {
        if (alive) { setExcelStatus(null); scheduleNext(15_000); }
      }
    };

    void poll();
    return () => { alive = false; if (timerId !== null) window.clearTimeout(timerId); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timerId: number | null = null;

    const scheduleNext = (intervalMs: number) => {
      if (!alive) return;
      timerId = window.setTimeout(() => { void poll(); }, intervalMs);
    };

    const poll = async () => {
      try {
        const status = await api<WeatherRefreshStatus>("GET", "/api/admin/weather-refresh/status");
        if (!alive) return;
        setWeatherStatus(status);
        if (status.active) scheduleNext(2000);
        else if (!status.visible) scheduleNext(30_000);
        else scheduleNext(5000);
      } catch {
        if (alive) scheduleNext(15_000);
      }
    };

    void poll();
    return () => { alive = false; if (timerId !== null) window.clearTimeout(timerId); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timerId: number | null = null;

    const scheduleNext = (intervalMs: number) => {
      if (!alive) return;
      timerId = window.setTimeout(() => { void poll(); }, intervalMs);
    };

    const poll = async () => {
      try {
        const status = await api<ScoringStatus>("GET", "/api/admin/scoring/status");
        if (!alive) return;
        setScoringStatus(status);
        if (status.active) scheduleNext(2000);
        else if (!status.visible) scheduleNext(30_000);
        else scheduleNext(5000);
      } catch {
        if (alive) scheduleNext(15_000);
      }
    };

    void poll();
    return () => { alive = false; if (timerId !== null) window.clearTimeout(timerId); };
  }, [token]);

  // Poll open error count for nav badge
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timerId: number | null = null;

    const scheduleNext = (ms: number) => {
      if (!alive) return;
      timerId = window.setTimeout(() => { void pollErrors(); }, ms);
    };

    const pollErrors = async () => {
      try {
        const res = await api<{ open: number }>("GET", "/api/admin/errors/count");
        if (!alive) return;
        setOpenErrorCount(res.open);
        scheduleNext(res.open > 0 ? 5000 : 30_000);
      } catch {
        if (alive) scheduleNext(30_000);
      }
    };

    void pollErrors();
    return () => { alive = false; if (timerId !== null) window.clearTimeout(timerId); };
  }, [token]);

  const dismissBanner = async () => {
    try {
      await api("POST", "/api/admin/excel/dismiss");
      setExcelStatus(prev => prev ? { ...prev, dismissed: true, visible: false } : prev);
    } catch {}
  };
  const dismissScoringBanner = async () => {
    try {
      await api("POST", "/api/admin/scoring/dismiss");
      setScoringStatus(prev => prev ? { ...prev, dismissed: true, visible: false, active: false } : prev);
    } catch {}
  };
  const dismissWeatherBanner = async () => {
    try {
      await api("POST", "/api/admin/weather-refresh/dismiss");
      setWeatherStatus(prev => prev ? { ...prev, dismissed: true, visible: false, active: false } : prev);
    } catch {}
  };
  const openImportCategory = () => {
    if (!excelStatus?.category) return;
    if (excelStatus.category === "spots") navigate("/admin/spots");
    else if (excelStatus.category === "schools") navigate("/admin/listings/schools");
    else if (excelStatus.category === "stays") navigate("/admin/listings/stays");
  };
  const handleDeploy = async () => {
    if (role !== "main" || !token) return;
    if (!window.confirm("Trigger deployment of the latest main branch on the server?")) return;

    setDeploying(true);
    try {
      const res = await fetch("/api/admin/deploy", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await res.json() as DeployResponse;

      if (res.ok && payload.ok) {
        const lastLine = payload.stdout.split(/\r?\n/).filter(Boolean).at(-1) ?? "Deployment complete.";
        toast({ title: "Deployment triggered", description: lastLine });
        return;
      }

      const description = [
        payload.ok ? res.statusText : payload.error,
        payload.stderr,
      ].filter(Boolean).join(" \u2014 ");
      toast({
        title: "Deployment failed",
        description: description || "The deploy endpoint returned an error.",
        variant: "destructive",
      });
    } catch (e: any) {
      toast({
        title: "Deployment failed",
        description: String(e.message || e),
        variant: "destructive",
      });
    } finally {
      setDeploying(false);
    }
  };

  const navLink = (href: string, icon: React.ReactNode, label: string, testId: string) => {
    const active = location === href || location.startsWith(href + "/");
    return (
      <Link href={href}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors ${active ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/90 hover:bg-sidebar-accent"}`}
        data-testid={testId}>
        {icon} {label}
      </Link>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <CompassMark className="h-7 w-7 text-sidebar-primary" />
          <span className="font-serif text-lg font-semibold">Kite Compass</span>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          <div>
            <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">Content</div>
            {navLink("/admin/spots", <LayoutGrid className="h-4 w-4" />, "Spots", "link-admin-spots")}
            {navLink("/admin/listings/schools", <School className="h-4 w-4" />, "Kite Schools", "link-admin-listings-schools")}
            {navLink("/admin/listings/stays", <Hotel className="h-4 w-4" />, "Stays", "link-admin-listings-stays")}
            {navLink("/admin/trash", <Trash2 className="h-4 w-4" />, "Trash", "link-admin-trash")}
          </div>

          <div className="pt-2">
            <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">Settings</div>
            {navLink("/admin/scoring", <Sparkles className="h-4 w-4" />, "Scoring", "link-admin-scoring")}
            {navLink("/admin/settings", <Settings className="h-4 w-4" />, "Settings", "link-admin-settings")}
            {navLink("/admin/seo", <Search className="h-4 w-4" />, "SEO", "link-admin-seo")}
            {navLink("/admin/redirects", <ArrowRightLeft className="h-4 w-4" />, "Redirects", "link-admin-redirects")}
            {navLink("/admin/legal", <FileText className="h-4 w-4" />, "Legal", "link-admin-legal")}
            {navLink("/admin/users", <Users className="h-4 w-4" />, "Users", "link-admin-users")}
            <Link href="/admin/errors"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors ${location === "/admin/errors" ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/90 hover:bg-sidebar-accent"}`}
              data-testid="link-admin-errors">
              <AlertCircle className="h-4 w-4" />
              Errors
              {openErrorCount > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                  {openErrorCount > 99 ? "99+" : openErrorCount}
                </span>
              )}
            </Link>
          </div>

          <div className="pt-2">
            <a href="#/" target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/90 no-underline hover:bg-sidebar-accent" data-testid="link-admin-viewsite">
              <ExternalLink className="h-4 w-4" /> View public site
            </a>
          </div>

          {role === "main" ? (
            <div className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent"
                onClick={() => { void handleDeploy(); }}
                disabled={deploying}
                data-testid="button-deploy-latest-main"
              >
                {deploying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Deploy latest main
              </Button>
            </div>
          ) : null}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 truncate px-2 text-xs text-sidebar-foreground/60">{email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => { logout(); navigate("/admin"); }} data-testid="button-logout">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {excelStatus?.visible && (
          <div className={`border-b px-5 py-3 text-sm md:px-8 ${excelStatus.active ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <button
                type="button"
                onClick={openImportCategory}
                disabled={!excelStatus.category}
                className="text-left disabled:cursor-default"
              >
                <strong>Excel import: {excelStatus.status}</strong>
                {excelStatus.category ? <span> · {excelStatus.category}</span> : null}
                {excelStatus.message ? <span> · {excelStatus.message}</span> : null}
              </button>
              <div className="flex items-center gap-2">
                {excelStatus.category && (
                  <Button size="sm" variant="outline" onClick={openImportCategory}>Open</Button>
                )}
                {!excelStatus.active && excelStatus.dismissible && (
                  <Button size="sm" variant="outline" onClick={dismissBanner}>Dismiss</Button>
                )}
              </div>
            </div>
          </div>
        )}
        {scoringStatus?.visible && (
          <div className={`border-b px-5 py-3 text-sm md:px-8 ${scoringStatus.active ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${scoringStatus.active ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                  {scoringStatus.active ? <Sparkles className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {scoringStatus.status}
                </span>
                <span className="font-medium">{scoringStatus.message || " "}</span>
              </div>
              {!scoringStatus.active && scoringStatus.dismissible && (
                <Button size="sm" variant="outline" onClick={dismissScoringBanner}>Dismiss</Button>
              )}
            </div>
          </div>
        )}
        {weatherStatus?.visible && (
          <div className={`border-b px-5 py-3 text-sm md:px-8 ${weatherStatus.active ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${weatherStatus.active ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                  <CloudSun className="h-3.5 w-3.5" />
                  {weatherStatus.status}
                </span>
                <span className="font-medium">{weatherStatus.message || " "}</span>
              </div>
              {!weatherStatus.active && weatherStatus.dismissible && (
                <Button size="sm" variant="outline" onClick={dismissWeatherBanner}>Dismiss</Button>
              )}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">{children}</div>
      </div>
    </div>
  );
}
