import { Link } from "wouter";
import { SpotListItem, tagLabel } from "@/lib/types";
import { ScoreBadge, SeasonBadge, Chip } from "./Badges";
import { Wind, Gauge, CalendarDays, MapPin } from "lucide-react";
import placeholderSpot from "@/assets/placeholder-spot.jpg";

const PLACEHOLDER = placeholderSpot;

export function SpotCard({
  spot,
  months,
  query,
  highlighted = false,
  onHover,
  onLeave,
  onClick,
}: {
  spot: SpotListItem;
  months: string[];
  query?: string;
  highlighted?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
  onClick?: () => void;
}) {
  const rec = spot.monthRecord;
  const params = new URLSearchParams();
  months.forEach(m => params.append("month", m));
  if (query) params.set("q", query);
  const href = params.toString() ? `/spots/${spot.slug}?${params.toString()}` : `/spots/${spot.slug}`;
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
      <div className="flex gap-0 sm:gap-0">
        <div className="relative hidden w-40 shrink-0 sm:block">
          <img
            src={spot.heroImageUrl || PLACEHOLDER}
            alt={spot.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold leading-tight text-foreground">
                {spot.name}
              </h3>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="truncate">
                  {[spot.region, spot.country].filter(Boolean).join(", ") || "—"}
                </span>
              </div>
            </div>
            <ScoreBadge score={spot.score} />
          </div>

          {spot.teaserText && (
            <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
              {spot.teaserText}
            </p>
          )}

          {rec && (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground/80">
              <SeasonBadge label={rec.seasonLabel} />
              {rec.avgKiteableWind10mKnots != null && (
                <span className="inline-flex items-center gap-1"><Wind className="h-3.5 w-3.5 text-primary" />Avg {rec.avgKiteableWind10mKnots} kn kiteable</span>
              )}
              {rec.kiteableDaysCount != null && (
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-primary" />{rec.kiteableDaysCount} kiteable days</span>
              )}
            </div>
          )}

          {spot.spotTypes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {spot.spotTypes.slice(0, 3).map(t => <Chip key={t}>{tagLabel(t)}</Chip>)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
