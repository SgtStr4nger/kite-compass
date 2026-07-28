import { SEASON_META } from "@/lib/types";

export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "sm" | "md" | "lg" }) {
  const has = score != null && !Number.isNaN(score);
  const dims = size === "lg" ? "h-16 w-16 text-2xl" : size === "sm" ? "h-10 w-10 text-sm" : "h-12 w-12 text-lg";
  return (
    <div
      className={`flex ${dims} shrink-0 flex-col items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground`}
      data-testid="badge-score"
      title="Kite Compass score"
    >
      {has ? <span className="font-serif leading-none">{Number(score).toFixed(1)}</span>
           : <span className="text-xs opacity-70">—</span>}
    </div>
  );
}

export function SeasonBadge({ label }: { label: string }) {
  const meta = SEASON_META[label] || SEASON_META.good;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}
      data-testid={`badge-season-${label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}
