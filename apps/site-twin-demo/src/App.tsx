import { useEffect, useMemo, useState } from "react";
import type { SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { renderedBuildingHeightM } from "@officeadmin-geo/site-twin-core";
import {
  SiteTwinWithInterior,
  createFilterState,
  isolateCategory,
  normaliseBuildInfo,
  normaliseMinDrawnThickness,
  parseBuildingModel,
  parseRegistration,
  setLevel,
  toggleCategory,
  type InteriorInput,
  type InteriorUiState,
  type LayerId,
} from "@officeadmin-geo/site-twin-renderer";

function feet(meters?: number) {
  return meters == null ? "unknown" : `${(meters * 3.28084).toFixed(1)} ft`;
}

/* The public demo interior is a MADE-UP sample (scripts/make-synthetic-interior.ts). */
const INTERIOR_URL = "./interior/synthetic-interior.json";
const REGISTRATION_URL = "./interior/synthetic-interior.registration.json";

type InteriorLoad = { input: InteriorInput | null; error: string | null };

async function fetchText(url: string) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

/** `withRegistration` false shows what happens when no placement is supplied. */
async function loadInterior(withRegistration: boolean): Promise<InteriorLoad> {
  const modelText = await fetchText(INTERIOR_URL);
  const parsed = parseBuildingModel(JSON.parse(modelText));
  if (!parsed.ok) return { input: null, error: `The interior model was refused: ${parsed.errors.slice(0, 6).join("; ")}` };
  const model = parsed.model;
  let registrationText: string | null = null;
  let registrationErrors: string[] = [];
  let registration: InteriorInput["registration"] = null;
  let registrationVerdict: InteriorInput["registrationVerdict"] = null;
  if (!withRegistration) {
    return { input: { model, modelText, registration: null, registrationVerdict: null, registrationText: null, registrationErrors: [] }, error: null };
  }
  try {
    registrationText = await fetchText(REGISTRATION_URL);
    const reg = parseRegistration(JSON.parse(registrationText), { model_id: model.model_id, frame_id: model.coordinate_system.frame_id });
    if (reg.ok) {
      registration = reg.registration;
      registrationVerdict = reg.verdict;
    } else {
      registrationErrors = reg.errors;
    }
  } catch (reason) {
    registrationErrors = [reason instanceof Error ? reason.message : String(reason)];
  }
  return { input: { model, modelText, registration, registrationVerdict, registrationText, registrationErrors }, error: null };
}

/** Deep links make every screenshot reproducible from a URL alone. */
function initialInteriorState(params: URLSearchParams, input: InteriorInput | null): Partial<InteriorUiState> {
  const out: Partial<InteriorUiState> = {};
  const mode = params.get("interior");
  if (mode === "off" || mode === "cutaway" || mode === "precise") out.mode = mode;
  let filter = createFilterState();
  const level = params.get("level");
  if (level && level !== "all") filter = setLevel(filter, level);
  else if (!level && input?.model.levels?.length) {
    // A cutaway is a cut through one floor: start on the lowest level.
    const lowest = [...input.model.levels].sort((a, b) => a.elevation_m - b.elevation_m)[0]!;
    filter = setLevel(filter, lowest.id);
  }
  for (const id of (params.get("off") ?? "").split(",").filter(Boolean)) filter = toggleCategory(filter, id as LayerId);
  const isolate = params.get("isolate");
  if (isolate) filter = isolateCategory(filter, isolate as LayerId);
  out.filter = filter;
  const select = params.get("select");
  if (select) out.selectedKey = select;
  if (select && params.get("focus") === "1") {
    out.cameraIntent = "focus";
    out.focusRequest = 1;
  }
  const search = params.get("search");
  if (search) out.searchText = search;
  const circuit = params.get("circuit");
  if (circuit) out.circuitId = circuit;
  const minDrawn = params.get("minDrawn");
  if (minDrawn !== null) out.minDrawnThicknessM = normaliseMinDrawnThickness(minDrawn);
  const cut = Number(params.get("cut"));
  if (params.get("cut") !== null && Number.isFinite(cut) && cut > 0) out.cutHeightM = cut;
  const pview = params.get("pview");
  if (pview === "plan" || pview === "front" || pview === "side" || pview === "iso") out.preciseView = pview;
  if (params.get("labels") === "0") out.showLabels = false;
  return out;
}

export function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const generic = params.get("generic") === "1" || params.get("anon") === "1";
  const buildInfo = useMemo(() => normaliseBuildInfo(__SITE_TWIN_BUILD__), []);
  const [model, setModel] = useState<SemanticSiteModel | null>(null);
  const [interior, setInterior] = useState<InteriorLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [showData, setShowData] = useState(false);
  const [view, setView] = useState<"facade" | "overview">(params.get("view") === "overview" ? "overview" : "facade");

  useEffect(() => {
    const modelUrl = `./site-twin.json?v=${Date.now()}`;
    fetch(modelUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`site-twin.json returned ${response.status}`);
        return response.json() as Promise<SemanticSiteModel>;
      })
      .then(setModel)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    loadInterior(params.get("registration") !== "none")
      .then(setInterior)
      .catch((reason) => setInterior({ input: null, error: `The interior could not be loaded: ${reason instanceof Error ? reason.message : String(reason)}` }));
  }, [params]);

  const primaryBuilding = useMemo(() => {
    if (!model) return undefined;
    return model.geometry.buildings.find((building) => building.id === model.geometry.primaryBuildingId) ?? model.geometry.buildings[0];
  }, [model]);
  const initialState = useMemo(() => (interior ? initialInteriorState(params, interior.input) : undefined), [interior, params]);

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

  if (!model || !interior) {
    return <main className="empty-state"><p>Loading site twin...</p></main>;
  }

  return (
    <main className="shell">
      <section className="scene-panel">
        <header className="floating-header">
          <div>
            <p className="eyebrow">SITE TWIN LAB</p>
            <h1>{generic ? "Site model" : "Corralitas prototype"}</h1>
          </div>
          <div className="view-controls">
            <button className={view === "facade" ? "toggle active" : "toggle"} onClick={() => setView("facade")}>House</button>
            <button className={view === "overview" ? "toggle active" : "toggle"} onClick={() => setView("overview")}>Hill</button>
            <button className={showData ? "toggle active" : "toggle"} onClick={() => setShowData((value) => !value)}>Data</button>
            <button className={debug ? "toggle active" : "toggle"} onClick={() => setDebug((value) => !value)}>
              {debug ? "Debug on" : "Debug"}
            </button>
          </div>
        </header>
        <SiteTwinWithInterior
          site={model}
          interior={interior.input}
          initialState={initialState}
          buildInfo={buildInfo}
          generic={generic}
          debug={debug}
          view={view}
          className="scene"
        />
        {interior.error ? <div className="interior-error">{interior.error}</div> : null}
        <div className="hint">Drag to orbit. Scroll to zoom.</div>
      </section>

      {showData ? <aside className="inspector">
        <div className="inspector-top">
          <p className="eyebrow">RECONSTRUCTION</p>
          <h2>{generic ? "Address hidden (generic mode)" : model.address}</h2>
          <p className="muted">Generated {new Date(model.generatedAt).toLocaleString()}</p>
        </div>

        <div className="metric-grid">
          <div><span>Building</span><strong>{generic ? "hidden" : primaryBuilding?.id ?? "none"}</strong></div>
          <div><span>Rendered height</span><strong>{primaryBuilding ? feet(renderedBuildingHeightM(primaryBuilding)) : "unknown"}</strong></div>
          <div><span>Roof elevation</span><strong>{feet(primaryBuilding?.roofElevationM)}</strong></div>
          <div><span>Ground elevation</span><strong>{feet(primaryBuilding?.groundElevationM)}</strong></div>
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

        {!generic ? (
          <section className="block">
            <h3>Measured sources</h3>
            {model.geometry.provenance.map((source, index) => (
              <div className="source" key={`${source.provider}-${source.featureId ?? index}`}>
                <strong>{source.provider}</strong>
                <span>{source.featureId ?? "source"}</span>
              </div>
            ))}
          </section>
        ) : null}

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

        {model.warnings.length && !generic ? (
          <section className="block warnings">
            <h3>Research warnings</h3>
            {model.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </section>
        ) : null}
      </aside> : null}
    </main>
  );
}
