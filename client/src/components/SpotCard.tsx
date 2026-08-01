import { Link } from "wouter";
import { SpotListItem, MONTHS, SEASON_META } from "@/lib/types";
import { ScoreBadge } from "./Badges";
import { Wind, Gauge, CalendarDays, MapPin } from "lucide-react";
import placeholderSpot from "@/assets/placeholder-spot.jpg";

const PLACEHOLDER = placeholderSpot;
// Fixed single-letter month initials in Jan→Dec order.
const MONTH_INITIALS = ["J","F","M","A","M","J","J","A","S","O","N","D"];

export function SpotCard({
  spot,
  months,
  highlighted = false,
  onHover,
  onLeave,
  onClick,
}: {
  spot: SpotListItem;
  months: string[];
  highlighted?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
  onClick?: () => void;
}) {
  const rec = spot.monthRecord;
  const params = new URLSearchParams();
  months.forEach(m => params.append("month", m));
  const href = params.toString() ? `/spots/${spot.slug}?${params.toString()}` : `/spots/${spot.slug}`;

  // Metrics — always three positions, null renders as "–" (spec §7.3).
  const avgWind = rec ? (rec.avgKiteableWind10mKnots ?? rec.averageBaseWind) : null;
  const kiteableDays = rec?.kiteableDaysCount ?? null;
  const kiteHours = rec?.avgKiteableHoursPerDay ?? null;

  // Wind type: primary always shown (or "–"); secondary only when present (spec §7.3).
  const primaryWT = rec?.primaryWindType ?? null;
  const secondaryWT = rec?.secondaryWindType ?? null;

  // Season strip: 12 entries in MONTHS order.
  const selectedSet = new Set(months);

  return (
    <Link
      href={href}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={`group block overflow-hidden rounded-2xl border bg-card no-underline transition-all ${
        highlighted ? "border-accent ring-2 ring-accent/40 shadow-lg" : "border-card-border hover:shadow-md"
      }`}
      data-testid={`card-spot-${spot.slug}`}
    >
      <div className="flex">
        {/* Image — 96×72px, visible at card widths ≥420px (spec §7.2) */}
        <div className="relative hidden w-24 shrink-0 [@media(min-width:420px)]:block">
          <img
            src={spot.heroImageUrl || PLACEHOLDER}
            alt={spot.name}
            loading="lazy"
            className="h-[72px] w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          {/* Name + location + score */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold leading-tight text-foreground">
                {spot.name}
              </h3>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {[spot.region, spot.country].filter(Boolean).join(", ") || "—"}
                </span>
              </div>
            </div>
            <ScoreBadge score={spot.score} />
          </div>

          {/* Three fixed metric positions (spec §7.1, §7.3) */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/80">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              {kiteableDays != null ? `${kiteableDays} kiteable days` : "– days"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Wind className="h-3.5 w-3.5 text-primary" />
              {avgWind != null ? `${avgWind} kn avg wind` : "– kn"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5 text-primary" />
              {kiteHours != null ? `${kiteHours} h/day` : "– h/day"}
            </span>
          </div>

          {/* Wind type (spec §7.1, §7.3) */}
          <div className="text-xs text-muted-foreground">
            {primaryWT
              ? <>Wind type: <span className="font-medium text-foreground">{primaryWT}{secondaryWT ? ` / ${secondaryWT}` : ""}</span></>
              : "Wind type –"
            }
          </div>

          {/* 12-month season strip (spec §7.4) */}
          <div className="grid grid-cols-12 gap-px" data-testid="season-strip-card" aria-hidden="true">
            {MONTHS.map((m, i) => {
              const label = spot.seasonByMonth[i];
              const meta = label ? SEASON_META[label] : undefined;
              const selected = selectedSet.has(m);
              return (
                <div
                  key={m}
                  title={`${m}${label ? `: ${SEASON_META[label]?.label ?? label}` : ""}`}
                  className={`flex flex-col items-center gap-0.5 rounded-sm p-0.5 ${selected ? "ring-2 ring-inset ring-foreground/70" : ""}`}
                >
                  <div className={`h-2 w-full rounded-sm ${meta ? meta.dot : "bg-stone-200"}`} />
                  <span className="text-[8px] font-medium uppercase leading-none text-muted-foreground/70">
                    {MONTH_INITIALS[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Link>
  );
}
