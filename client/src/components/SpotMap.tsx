import { useEffect, useMemo, useRef, useState, Component, type ReactNode } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: number;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  score: number | null;
}

/** Score tier → background color (spec §6.3) */
function scoreTierColor(score: number | null, active: boolean): string {
  if (active) return "#b7791f"; // gold for selected
  if (score == null) return "#6b7280"; // gray – no score
  if (score >= 8) return "#15803d";   // green – very good
  if (score >= 6) return "#174a4f";   // teal – good
  if (score >= 4) return "#d97706";   // amber – medium
  return "#dc2626";                   // red – low
}

function pinIcon(active: boolean, score: number | null) {
  const bg = scoreTierColor(score, active);
  const label = score != null ? Number(score).toFixed(1) : "–";
  const size = active ? 42 : 34;
  const ring = active ? `box-shadow:0 0 0 3px rgba(255,255,255,.7),0 2px 8px rgba(0,0,0,.4);` : `box-shadow:0 2px 6px rgba(0,0,0,.35);`;
  const scale = active ? `transform:rotate(-45deg) scale(1.15);` : `transform:rotate(-45deg);`;
  return L.divIcon({
    className: "kc-pin",
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        <div style="position:relative;width:${size}px;height:${size}px;background:${bg};border:2px solid #fff;border-radius:50% 50% 50% 0;${scale}${ring}">
          <span style="position:absolute;inset:0;transform:rotate(45deg);display:flex;align-items:center;justify-content:center;color:#fff;font-size:${active ? 12 : 10}px;font-weight:700;font-family:Inter,sans-serif;">${label}</span>
        </div>
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 8);
    } else {
      const b = L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b, { padding: [40, 40], maxZoom: 7 });
    }
  }, [points, map]);
  return null;
}

function PanToSelected({ points, selectedId }: { points: MapPoint[]; selectedId: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (selectedId == null) return;
    const p = points.find(x => x.id === selectedId);
    if (p) map.panTo([p.lat, p.lng], { animate: true });
  }, [selectedId, points, map]);
  return null;
}

// ── Map error boundary ──────────────────────────────────────────────────────
interface MapErrorBoundaryState { hasError: boolean }
class MapErrorBoundary extends Component<{ children: ReactNode }, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  reset() { this.setState({ hasError: false }); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 text-center">
          <p className="text-sm font-medium text-foreground">We couldn't load the map</p>
          <button
            type="button"
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            onClick={() => this.reset()}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
// ────────────────────────────────────────────────────────────────────────────

export function SpotMap({
  points,
  selectedId = null,
  onSelect,
  onNavigate,
  className = "",
  interactive = true,
  isMobile = false,
}: {
  points: MapPoint[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  /** Called instead of onSelect when isMobile=true; navigates directly to spot page */
  onNavigate?: (slug: string) => void;
  className?: string;
  interactive?: boolean;
  isMobile?: boolean;
}) {
  const valid = useMemo(() => points.filter(p => p.lat != null && p.lng != null), [points]);
  const center = useMemo<[number, number]>(() => {
    if (!valid.length) return [20, 0];
    return [valid[0].lat, valid[0].lng];
  }, [valid]);
  const ref = useRef<L.Map | null>(null);
  const [, forceRender] = useState(0);

  return (
    <div className={className} data-testid="spot-map">
      <MapErrorBoundary>
        <MapContainer
          center={center}
          zoom={3}
          scrollWheelZoom={interactive}
          dragging={interactive}
          doubleClickZoom={interactive}
          zoomControl={interactive}
          style={{ height: "100%", width: "100%", background: "#dfeaec" }}
          ref={(m) => { ref.current = m as any; if (m) forceRender(n => n + 1); }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <FitBounds points={valid} />
          <PanToSelected points={valid} selectedId={selectedId} />
          <MarkerClusterGroup chunkedLoading>
            {valid.map(p => (
              <Marker
                key={p.id}
                position={[p.lat, p.lng]}
                icon={pinIcon(p.id === selectedId, p.score)}
                zIndexOffset={p.id === selectedId ? 1000 : 0}
                eventHandlers={{
                  click: () => {
                    if (isMobile && onNavigate) {
                      onNavigate(p.slug);
                    } else {
                      onSelect?.(p.id);
                    }
                  },
                }}
              />
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </MapErrorBoundary>
    </div>
  );
}
