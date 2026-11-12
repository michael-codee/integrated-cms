import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';

export interface MapBranch { id: string; name: string; code: string; town?: string; latitude: number | null; longitude: number | null; members?: number; status?: string }

/** Branch locations (OpenStreetMap tiles; needs internet for the base map). */
export default function BranchMap({ branches, height = 360 }: { branches: MapBranch[]; height?: number }) {
  const located = branches.filter((b) => b.latitude != null && b.longitude != null);
  const center: [number, number] = located.length
    ? [located.reduce((s, b) => s + Number(b.latitude), 0) / located.length, located.reduce((s, b) => s + Number(b.longitude), 0) / located.length]
    : [8.46, -11.78]; // Sierra Leone
  const max = Math.max(1, ...located.map((b) => b.members || 0));
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700" style={{ height }}>
      <MapContainer center={center} zoom={7} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {located.map((b) => (
          <CircleMarker key={b.id} center={[Number(b.latitude), Number(b.longitude)]} radius={7 + 10 * Math.sqrt((b.members || 0) / max)}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: b.status === 'active' || !b.status ? '#2a5bd7' : '#94a3b8', fillOpacity: 0.85 }}>
            <Popup>
              <p style={{ fontWeight: 600, margin: 0 }}>{b.name}</p>
              <p style={{ margin: '2px 0' }}>{b.code}{b.town ? ` · ${b.town}` : ''}</p>
              {b.members !== undefined && <p style={{ margin: '2px 0' }}>{b.members.toLocaleString()} active members</p>}
              <Link to={`/structure?unit=${b.id}`}>Open profile</Link>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {located.length < branches.length && (
        <p className="sr-only">{branches.length - located.length} branches have no coordinates.</p>
      )}
    </div>
  );
}
