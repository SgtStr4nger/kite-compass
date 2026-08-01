import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutGrid, Database, FileText, ExternalLink, School, Hotel, Users } from "lucide-react";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { email, logout, mustChangePassword } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();

  useEffect(() => {
    if (mustChangePassword && location !== "/admin/change-password") navigate("/admin/change-password");
  }, [mustChangePassword, location, navigate]);

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
            {navLink("/admin/legal", <FileText className="h-4 w-4" />, "Legal", "link-admin-legal")}
            {navLink("/admin/users", <Users className="h-4 w-4" />, "Users", "link-admin-users")}
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
        <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">{children}</div>
      </div>
    </div>
  );
}
