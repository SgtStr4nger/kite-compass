// Kite Compass — inline SVG compass-rose mark. Uses currentColor.
export function CompassMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      {/* four-point compass star */}
      <path d="M24 5 L28 24 L24 43 L20 24 Z" fill="currentColor" />
      <path d="M5 24 L24 20 L43 24 L24 28 Z" fill="currentColor" opacity="0.55" />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className = "", onNav }: { className?: string; onNav?: () => void }) {
  return (
    <a
      href="#/"
      onClick={onNav}
      className={`flex items-center gap-2.5 no-underline ${className}`}
      data-testid="link-home-logo"
    >
      <CompassMark className="h-8 w-8 text-primary" />
      <span className="font-serif text-xl font-semibold tracking-tight text-foreground">
        Kite&nbsp;Compass
      </span>
    </a>
  );
}
