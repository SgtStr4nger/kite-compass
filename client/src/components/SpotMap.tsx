import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
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

// Build a teardrop pin as a divIcon so we control color + highlight state.
function pinIcon(active: boolean, score: number | null) {
  const bg = active ? "#d69e2e" : "#174a4f"; // gold when active, teal otherwise
  const label = score != null ? Number(score).toFixed(1) : "";
  const size = active ? 42 : 34;
  return L.divIcon({
    className: "kc-pin",
    html: `<div style="
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
      ">
        <div style="
          position:relative;width:${size}px;height:${size}px;
          background:${bg};border:2px solid #fff;border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.35);
        ">
          <span style="
            position:absolute;inset:0;transform:rotate(45deg);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:${active ? 12 : 10}px;font-weight:700;font-family:Inter,sans-serif;
          ">${label}</span>
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

export function SpotMap({
  points,
  selectedId = null,
  onSelect,
  className = "",
  interactive = true,
}: {
  points: MapPoint[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  className?: string;
  interactive?: boolean;
}) {
  const valid = useMemo(() => points.filter(p => p.lat != null && p.lng != null), [points]);
  const center = useMemo<[number, number]>(() => {
    if (!valid.length) return [20, 0];
    return [valid[0].lat, valid[0].lng];
  }, [valid]);
  const ref = useRef<L.Map | null>(null);

  return (
    <div className={className} data-testid="spot-map">
      <MapContainer
        center={center}
        zoom={3}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        zoomControl={interactive}
        style={{ height: "100%", width: "100%", background: "#dfeaec" }}
        ref={(m) => { ref.current = m as any; }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <FitBounds points={valid} />
        <PanToSelected points={valid} selectedId={selectedId} />
        {valid.map(p => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinIcon(p.id === selectedId, p.score)}
            zIndexOffset={p.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect?.(p.id) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
