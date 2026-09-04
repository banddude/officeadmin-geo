import { useEffect, useMemo, useState } from "react";
import type { SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { SiteTwinScene } from "@officeadmin-geo/site-twin-renderer";

function feet(meters?: number) {
  return meters == null ? "unknown" : `${(meters * 3.28084).toFixed(1)} ft`;
}

export function App() {
  const [model, setModel] = useState<SemanticSiteModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(true);

  useEffect(() => {
    fetch("./site-twin.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`site-twin.json returned ${response.status}`);
        return response.json() as Promise<SemanticSiteModel>;
      })
      .then(setModel)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const primaryBuilding = useMemo(() => {
    if (!model) return undefined;
    return model.geometry.buildings.find((building) => building.id === model.geometry.primaryBuildingId) ?? model.geometry.buildings[0];
  }, [model]);

  if (error) {
    return (
      <main className="empty-state">
        <p className="eyebrow">SITE TWIN LAB</p>
        <h1>No reconstruction artifact yet.</h1>
        <p>{error}</p>
        <code>pnpm site-twin:corralitas</code>
      </main>
    );
  }

  if (!model) {
    return <main className="empty-state"><p>Loading site twin...</p></main>;
  }

  return (
    <main className="shell">
      <section className="scene-panel">
        <header className="floating-header">
          <div>
            <p className="eyebrow">SITE TWIN LAB</p>
            <h1>Corralitas prototype</h1>
          </div>
          <button className={debug ? "toggle active" : "toggle"} onClick={() => setDebug((value) => !value)}>
            {debug ? "Debug on" : "Debug off"}
          </button>
        </header>
        <SiteTwinScene model={model} debug={debug} className="scene" />
        <div className="hint">Drag to orbit. Scroll to zoom.</div>
      </section>

      <aside className="inspector">
        <div className="inspector-top">
          <p className="eyebrow">RECONSTRUCTION</p>
          <h2>{model.address}</h2>
          <p className="muted">Generated {new Date(model.generatedAt).toLocaleString()}</p>
        </div>

        <div className="metric-grid">
          <div><span>Building</span><strong>{primaryBuilding?.id ?? "none"}</strong></div>
          <div><span>Measured height</span><strong>{feet(primaryBuilding?.heightM)}</strong></div>
          <div><span>Roof</span><strong>{model.roof.value.type}</strong></div>
          <div><span>Roof confidence</span><strong>{Math.round(model.roof.confidence * 100)}%</strong></div>
          <div><span>Street frames</span><strong>{model.imagery.length}</strong></div>
          <div><span>Useful AI views</span><strong>{model.observations.filter((item) => item.visible).length}</strong></div>
          <div><span>Terrain samples</span><strong>{model.geometry.terrain.length}</strong></div>
          <div><span>Terrain relief</span><strong>{model.geometry.terrain.length ? `${(Math.max(...model.geometry.terrain.map((sample) => sample.elevationM)) - Math.min(...model.geometry.terrain.map((sample) => sample.elevationM))).toFixed(1)} m` : "flat"}</strong></div>
          <div><span>Measured buildings</span><strong>{model.geometry.buildings.length}</strong></div>
          <div><span>Ground-cover cells</span><strong>{model.geometry.groundCover.length}</strong></div>
          <div><span>Front wall edge</span><strong>{model.facadeAlignment ? `#${model.facadeAlignment.frontEdgeIndex}` : "unresolved"}</strong></div>
          <div><span>Facade alignment</span><strong>{model.facadeAlignment ? `${Math.round(model.facadeAlignment.confidence * 100)}%` : "none"}</strong></div>
        </div>

        <section className="block">
          <h3>Measured sources</h3>
          {model.geometry.provenance.map((source, index) => (
            <div className="source" key={`${source.provider}-${source.featureId ?? index}`}>
              <strong>{source.provider}</strong>
              <span>{source.featureId ?? "source"}</span>
            </div>
          ))}
        </section>

        <section className="block">
          <h3>Detected site facts</h3>
          <div className="chips">
            {Object.entries(model.site)
              .filter(([, value]) => value?.value === true)
              .map(([key]) => <span key={key}>{key}</span>)}
          </div>
        </section>

        <section className="block">
          <h3>Facade extraction</h3>
          {model.facades.map((facade) => (
            <div className="facade-row" key={facade.wall}>
              <span>{facade.wall}</span>
              <span>{facade.windows.length} windows</span>
              <span>{facade.doors.length} doors</span>
            </div>
          ))}
        </section>

        {model.warnings.length ? (
          <section className="block warnings">
            <h3>Research warnings</h3>
            {model.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </section>
        ) : null}
      </aside>
    </main>
  );
}
