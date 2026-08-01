import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutGrid, Database, FileText, ExternalLink, School, Hotel, Users, Search, Trash2 } from "lucide-react";
import { applyRobotsMetadata } from "@/lib/metadata";
import { api } from "@/lib/api";
import { ExcelImportStatus } from "@/lib/types";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { email, logout, mustChangePassword, token } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const [excelStatus, setExcelStatus] = useState<ExcelImportStatus | null>(null);

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

  const dismissBanner = async () => {
    try {
      await api("POST", "/api/admin/excel/dismiss");
      setExcelStatus(prev => prev ? { ...prev, dismissed: true, visible: false } : prev);
    } catch {}
  };
  const openImportCategory = () => {
    if (!excelStatus?.category) return;
    if (excelStatus.category === "spots") navigate("/admin/spots");
    else if (excelStatus.category === "schools") navigate("/admin/listings/schools");
    else if (excelStatus.category === "stays") navigate("/admin/listings/stays");
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
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <CompassMark className="h-7 w-7 text-sidebar-primary" />
          <span className="font-serif text-lg font-semibold">Kite Compass</span>
        </div>
        <div className="px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">Admin</div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {navLink("/admin/spots", <LayoutGrid className="h-4 w-4" />, "Spots", "link-admin-spots")}

          <div className="pt-2">
            <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/40">Listings</div>
            {navLink("/admin/listings/schools", <School className="h-4 w-4" />, "Kite Schools", "link-admin-listings-schools")}
            {navLink("/admin/listings/stays", <Hotel className="h-4 w-4" />, "Stays", "link-admin-listings-stays")}
          </div>

          <div className="pt-2">
            <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/40">Settings</div>
            {navLink("/admin/data", <Database className="h-4 w-4" />, "Data", "link-admin-data")}
            {navLink("/admin/seo", <Search className="h-4 w-4" />, "SEO", "link-admin-seo")}
            {navLink("/admin/legal", <FileText className="h-4 w-4" />, "Legal", "link-admin-legal")}
            {navLink("/admin/users", <Users className="h-4 w-4" />, "Users", "link-admin-users")}
            {navLink("/admin/trash", <Trash2 className="h-4 w-4" />, "Trash", "link-admin-trash")}
          </div>

          <div className="pt-2">
            <a href="#/" target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/90 no-underline hover:bg-sidebar-accent" data-testid="link-admin-viewsite">
              <ExternalLink className="h-4 w-4" /> View public site
            </a>
          </div>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 truncate px-2 text-xs text-sidebar-foreground/60">{email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => { logout(); navigate("/admin"); }} data-testid="button-logout">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <div className="flex-1 overflow-x-hidden">
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
        <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">{children}</div>
      </div>
    </div>
  );
}
