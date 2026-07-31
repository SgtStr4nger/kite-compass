import { ReactNode } from "react";
import { Link } from "wouter";
import { Logo, CompassMark } from "./Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/results" className="rounded-md px-3 py-2 font-medium text-foreground/80 hover-elevate no-underline" data-testid="link-nav-explore">
            Explore
          </Link>
          <Link href="/methodology" className="rounded-md px-3 py-2 font-medium text-foreground/80 hover-elevate no-underline" data-testid="link-nav-methodology">
            Methodology
          </Link>
          <Link href="/impressum" className="rounded-md px-3 py-2 font-medium text-foreground/80 hover-elevate no-underline" data-testid="link-nav-impressum">
            Impressum
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border/70 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <CompassMark className="h-7 w-7 text-accent" />
              <span className="font-serif text-lg font-semibold">Kite Compass</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-primary-foreground/70">
              Find your perfect kitesurf month. We rank the world's kiteboarding
              destinations by wind, conditions and travel vibe — so you book the
              right spot at the right time.
            </p>
          </div>
          <div className="flex gap-14 text-sm">
            <div>
              <div className="mb-3 font-medium text-primary-foreground/50">Discover</div>
              <ul className="space-y-2">
                <li><Link href="/results" className="text-primary-foreground/85 no-underline hover:text-accent" data-testid="link-footer-explore">Explore spots</Link></li>
                <li><Link href="/methodology" className="text-primary-foreground/85 no-underline hover:text-accent" data-testid="link-footer-methodology">Methodology</Link></li>
                <li><Link href="/impressum" className="text-primary-foreground/85 no-underline hover:text-accent" data-testid="link-footer-impressum">Impressum</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-primary-foreground/15 pt-6 text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} Kite Compass. Wind and season data is indicative — always check live forecasts before you travel.
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
