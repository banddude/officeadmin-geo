import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  GeoOperationsMap,
  type MapRoute,
  type MapSite,
  type MapTechnician,
} from "@officeadmin-geo/geo-map";
import "./styles.css";

const sites: MapSite[] = [
  { id: "site-silver-lake", name: "Silver Lake TI", latitude: 34.0861, longitude: -118.2702, status: "active" },
  { id: "site-dtla", name: "DTLA Service", latitude: 34.0478, longitude: -118.2519, status: "scheduled" },
  { id: "site-hollywood", name: "Hollywood EV", latitude: 34.0983, longitude: -118.3267, status: "bid" },
  { id: "site-west-la", name: "West LA Retrofit", latitude: 34.0472, longitude: -118.4426, status: "active" },
  { id: "site-santa-monica", name: "Santa Monica Chargers", latitude: 34.0195, longitude: -118.4912, status: "complete" },
  { id: "site-pasadena", name: "Pasadena Service", latitude: 34.1478, longitude: -118.1445, status: "scheduled" },
  { id: "site-glendale", name: "Glendale Panel", latitude: 34.1425, longitude: -118.2551, status: "bid" },
  { id: "site-burbank", name: "Burbank Lighting", latitude: 34.1808, longitude: -118.309, status: "active" },
];

const now = Date.now();
const technicians: MapTechnician[] = [
  {
    id: "tech-1",
    name: "Tech 1",
    latitude: 34.0754,
    longitude: -118.2606,
    heading: 118,
    status: "working",
    lastUpdatedAt: new Date(now - 2 * 60 * 1000).toISOString(),
  },
  {
    id: "tech-2",
    name: "Tech 2",
    latitude: 34.0618,
    longitude: -118.377,
    heading: 274,
    status: "driving",
    lastUpdatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
  },
  {
    id: "tech-3",
    name: "Tech 3",
    latitude: 34.1397,
    longitude: -118.2444,
    heading: 28,
    status: "stale-demo",
    lastUpdatedAt: new Date(now - 47 * 60 * 1000).toISOString(),
  },
];

const routes: MapRoute[] = [
  {
    id: "route-1",
    technicianId: "tech-1",
    points: [
      { latitude: 34.0754, longitude: -118.2606 },
      { latitude: 34.072, longitude: -118.267 },
      { latitude: 34.0808, longitude: -118.2703 },
      { latitude: 34.0861, longitude: -118.2702 },
    ],
  },
  {
    id: "route-2",
    technicianId: "tech-2",
    points: [
      { latitude: 34.0618, longitude: -118.377 },
      { latitude: 34.056, longitude: -118.397 },
      { latitude: 34.0505, longitude: -118.42 },
      { latitude: 34.0472, longitude: -118.4426 },
    ],
  },
];

function App() {
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
  const [selectedSiteId, setSelectedSiteId] = useState<string>();
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>();
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId],
  );
  const selectedTechnician = useMemo(
    () => technicians.find((technician) => technician.id === selectedTechnicianId),
    [selectedTechnicianId],
  );

  if (!accessToken) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <p className="eyebrow">OfficeAdmin Geo</p>
          <h1>Mapbox token required</h1>
          <p>
            Copy <code>.env.example</code> to <code>.env.local</code>, add a public Mapbox access token,
            then run <code>pnpm dev</code> again.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OfficeAdmin Geo</p>
          <h1>Los Angeles operations</h1>
        </div>
        <div className="status-summary" aria-label="Demo summary">
          <span><strong>{sites.length}</strong> jobs</span>
          <span><strong>{technicians.length}</strong> techs</span>
        </div>
      </header>

      <section className="map-stage">
        <GeoOperationsMap
          mapboxAccessToken={accessToken}
          className="map-canvas"
          sites={sites}
          technicians={technicians}
          routes={routes}
          selectedSiteId={selectedSiteId}
          selectedTechnicianId={selectedTechnicianId}
          onSiteSelected={(id) => {
            setSelectedTechnicianId(undefined);
            setSelectedSiteId(id);
          }}
          onTechnicianSelected={(id) => {
            setSelectedSiteId(undefined);
            setSelectedTechnicianId(id);
          }}
        />

        <aside className="floating-panel" aria-live="polite">
          {selectedSite ? (
            <>
              <p className="panel-kicker">Selected job</p>
              <h2>{selectedSite.name}</h2>
              <p>Status: {selectedSite.status ?? "unknown"}</p>
              <button type="button" onClick={() => setSelectedSiteId(undefined)}>Clear selection</button>
            </>
          ) : selectedTechnician ? (
            <>
              <p className="panel-kicker">Selected technician</p>
              <h2>{selectedTechnician.name}</h2>
              <p>Last GPS: {selectedTechnician.lastUpdatedAt ? new Date(selectedTechnician.lastUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "unknown"}</p>
              <button type="button" onClick={() => setSelectedTechnicianId(undefined)}>Clear selection</button>
            </>
          ) : (
            <>
              <p className="panel-kicker">Demo scene</p>
              <h2>Click a job or tech</h2>
              <p>The camera flies to the selected entity. Gray technician markers intentionally demonstrate stale GPS.</p>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
