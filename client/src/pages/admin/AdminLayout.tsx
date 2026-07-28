import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutGrid, ExternalLink } from "lucide-react";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { email, logout } = useAuth();
  const [, navigate] = useLocation();
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <CompassMark className="h-7 w-7 text-sidebar-primary" />
          <span className="font-serif text-lg font-semibold">Kite Compass</span>
        </div>
        <div className="px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">Admin</div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          <Link href="/admin/spots" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/90 no-underline hover:bg-sidebar-accent" data-testid="link-admin-spots">
            <LayoutGrid className="h-4 w-4" /> Spots
          </Link>
          <a href="#/" target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/90 no-underline hover:bg-sidebar-accent" data-testid="link-admin-viewsite">
            <ExternalLink className="h-4 w-4" /> View public site
          </a>
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
