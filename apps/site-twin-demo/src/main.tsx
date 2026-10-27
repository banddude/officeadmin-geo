import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./styles.css";

type Position = [number, number];
type LineStringGeometry = { type: "LineString"; coordinates: Position[] };
type MultiLineStringGeometry = { type: "MultiLineString"; coordinates: Position[][] };
type PointGeometry = { type: "Point"; coordinates: Position };
type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Position[][][] };
type Geometry = LineStringGeometry | MultiLineStringGeometry | PointGeometry | PolygonGeometry | MultiPolygonGeometry;

type GeoFeature = {
  id?: number | string;
  geometry: Geometry;
  properties: Record<string, unknown>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

type TerrainPoint = {
  ix: number;
  iz: number;
  lon: number;
  lat: number;
  elevation: number | string;
};

type TerrainData = {
  center: { lon: number; lat: number };
  width: number;
  height: number;
  points: TerrainPoint[];
};

type OpeningObservation = {
  wallSegment: number;
  offset: number;
  widthMeters: number;
  heightMeters: number;
  bottomMeters: number;
  kind: "window" | "door" | "garage";
  color?: string;
};

type SiteObservations = {
  wallColor: string;
  roofColor: string;
  roofType: "flat" | "gable" | "hip" | "unknown";
  roofConfidence: number;
  facadeConfidence: number;
  openings: OpeningObservation[];
  notes: string[];
};

const CENTER = { lon: -118.25280655, lat: 34.09964469 };
const HOME_OBJECT_ID = 883214;
const DEG = Math.PI / 180;
const LAT_METERS = 111_320;
const LON_METERS = LAT_METERS * Math.cos(CENTER.lat * DEG);

const palette = {
  sky: 0xcfe0ed,
  terrain: 0xb9d1ad,
  parcel: 0x9fca98,
  sidewalk: 0xe4dfd4,
  curb: 0xcac6bc,
  street: 0x7e8b91,
  neighbor: 0xd6d5cf,
  roof: 0xc7c5bf,
  tree: 0x6f9f70,
  treeDark: 0x4f7654,
  trunk: 0x806a54,
  parcelLine: 0x47684e,
};

function localPoint([lon, lat]: Position): THREE.Vector2 {
  return new THREE.Vector2((lon - CENTER.lon) * LON_METERS, -(lat - CENTER.lat) * LAT_METERS);
}

function jsonUrl(name: string) {
  return `${import.meta.env.BASE_URL}data/${name}`;
}

async function loadJson<T>(name: string): Promise<T> {
  const response = await fetch(jsonUrl(name));
  if (!response.ok) throw new Error(`Failed to load ${name}: ${response.status}`);
  return response.json() as Promise<T>;
}

function polygonParts(geometry: Geometry): Position[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function lineParts(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function stripClosingPoint(points: Position[]) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points.slice(0, -1);
  return points;
}

function makeTerrainSampler(data: TerrainData) {
  const points = [...data.points].sort((a, b) => a.iz - b.iz || a.ix - b.ix);
  const elevations = points.map((point) => Number(point.elevation));
  const base = elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
  const lon0 = Math.min(...points.map((point) => point.lon));
  const lon1 = Math.max(...points.map((point) => point.lon));
  const lat0 = Math.min(...points.map((point) => point.lat));
  const lat1 = Math.max(...points.map((point) => point.lat));

  function heightAt(lon: number, lat: number) {
    const gx = THREE.MathUtils.clamp(((lon - lon0) / (lon1 - lon0)) * (data.width - 1), 0, data.width - 1);
    const gz = THREE.MathUtils.clamp(((lat - lat0) / (lat1 - lat0)) * (data.height - 1), 0, data.height - 1);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, data.width - 1);
    const z1 = Math.min(z0 + 1, data.height - 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const e00 = elevations[z0 * data.width + x0];
    const e10 = elevations[z0 * data.width + x1];
    const e01 = elevations[z1 * data.width + x0];
    const e11 = elevations[z1 * data.width + x1];
    const a = THREE.MathUtils.lerp(e00, e10, tx);
    const b = THREE.MathUtils.lerp(e01, e11, tx);
    return THREE.MathUtils.lerp(a, b, tz) - base;
  }

  return { points, elevations, base, heightAt };
}

function createTerrain(data: TerrainData, sample: ReturnType<typeof makeTerrainSampler>) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const point of sample.points) {
    const local = localPoint([point.lon, point.lat]);
    positions.push(local.x, Number(point.elevation) - sample.base, local.y);
  }
  for (let z = 0; z < data.height - 1; z += 1) {
    for (let x = 0; x < data.width - 1; x += 1) {
      const a = z * data.width + x;
      const b = a + 1;
      const c = a + data.width;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: palette.terrain, roughness: 0.94, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createDrapedPolygon(
  ringInput: Position[],
  heightAt: (lon: number, lat: number) => number,
  material: THREE.Material,
  offset = 0.08,
) {
  const ring = stripClosingPoint(ringInput);
  if (ring.length < 3) return null;
  const shapePoints = ring.map(localPoint);
  const faces = THREE.ShapeUtils.triangulateShape(shapePoints, []);
  const positions: number[] = [];
  for (const face of faces) {
    for (const index of face) {
      const [lon, lat] = ring[index];
      const local = shapePoints[index];
      positions.push(local.x, heightAt(lon, lat) + offset, local.y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function addPolygonCollection(
  group: THREE.Group,
  collection: FeatureCollection,
  heightAt: (lon: number, lat: number) => number,
  material: THREE.Material,
  offset: number,
) {
  for (const feature of collection.features) {
    for (const polygon of polygonParts(feature.geometry)) {
      const mesh = createDrapedPolygon(polygon[0], heightAt, material, offset);
      if (mesh) group.add(mesh);
    }
  }
}

function createParcelOutline(ringInput: Position[], heightAt: (lon: number, lat: number) => number) {
  const ring = stripClosingPoint(ringInput);
  const positions = ring.map(([lon, lat]) => {
    const p = localPoint([lon, lat]);
    return new THREE.Vector3(p.x, heightAt(lon, lat) + 0.3, p.y);
  });
  const geometry = new THREE.BufferGeometry().setFromPoints([...positions, positions[0]]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: palette.parcelLine, transparent: true, opacity: 0.85 }));
}

function createBuilding(
  feature: GeoFeature,
  heightAt: (lon: number, lat: number) => number,
  observations: SiteObservations,
) {
  const polygon = polygonParts(feature.geometry)[0];
  if (!polygon) return null;
  const ring = stripClosingPoint(polygon[0]);
  if (ring.length < 3) return null;
  const local = ring.map(localPoint);
  const terrainHeights = ring.map(([lon, lat]) => heightAt(lon, lat));
  const bottomReference = terrainHeights.reduce((sum, h) => sum + h, 0) / terrainHeights.length;
  const objectId = Number(feature.properties.OBJECTID ?? feature.id);
  const isHome = objectId === HOME_OBJECT_ID;
  const rawFeet = Number(feature.properties.HEIGHT ?? 24);
  const heightMeters = isHome ? 30.57 * 0.3048 : THREE.MathUtils.clamp(rawFeet * 0.3048, 4.2, 11.5);
  const topY = bottomReference + heightMeters;
  const faces = THREE.ShapeUtils.triangulateShape(local, []);
  const positions: number[] = [];

  for (const face of faces) {
    for (const index of face) {
      const p = local[index];
      positions.push(p.x, topY, p.y);
    }
  }

  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    const a = local[index];
    const b = local[next];
    const ay = terrainHeights[index] + 0.15;
    const by = terrainHeights[next] + 0.15;
    positions.push(
      a.x, ay, a.y,
      b.x, by, b.y,
      b.x, topY, b.y,
      a.x, ay, a.y,
      b.x, topY, b.y,
      a.x, topY, a.y,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const wallColor = isHome ? observations.wallColor : `#${palette.neighbor.toString(16).padStart(6, "0")}`;
  const material = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.88, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { isHome, ring, topY, bottomReference };

  const group = new THREE.Group();
  group.add(mesh);

  const roofMesh = createFlatRoof(ring, topY + 0.03, observations.roofColor, isHome ? 0.9 : 0.35);
  if (roofMesh) group.add(roofMesh);

  if (isHome) {
    addParapet(group, ring, topY, observations.roofColor);
    addObservedOpenings(group, ring, bottomReference, observations);
  }

  return group;
}

function createFlatRoof(ringInput: Position[], y: number, color: string, roughness: number) {
  const ring = stripClosingPoint(ringInput);
  const local = ring.map(localPoint);
  const faces = THREE.ShapeUtils.triangulateShape(local, []);
  const positions: number[] = [];
  for (const face of faces) {
    for (const index of face) positions.push(local[index].x, y, local[index].y);
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness }));
  mesh.receiveShadow = true;
  return mesh;
}

function addParapet(group: THREE.Group, ringInput: Position[], roofY: number, color: string) {
  const ring = stripClosingPoint(ringInput).map(localPoint);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const length = a.distanceTo(b);
    if (length < 0.25) continue;
    const geometry = new THREE.BoxGeometry(length, 0.65, 0.18);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((a.x + b.x) / 2, roofY + 0.32, (a.y + b.y) / 2);
    mesh.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    mesh.castShadow = true;
    group.add(mesh);
  }
}

function addObservedOpenings(group: THREE.Group, ringInput: Position[], baseY: number, observations: SiteObservations) {
  const ring = stripClosingPoint(ringInput).map(localPoint);
  for (const opening of observations.openings) {
    if (opening.wallSegment < 0 || opening.wallSegment >= ring.length) continue;
    const a = ring[opening.wallSegment];
    const b = ring[(opening.wallSegment + 1) % ring.length];
    const t = THREE.MathUtils.clamp(opening.offset, 0.05, 0.95);
    const center = new THREE.Vector2().lerpVectors(a, b, t);
    const wall = new THREE.Vector2().subVectors(b, a).normalize();
    const normal = new THREE.Vector2(wall.y, -wall.x);
    const material = new THREE.MeshStandardMaterial({
      color: opening.color ?? (opening.kind === "window" ? "#8ba5b4" : "#4c5354"),
      roughness: opening.kind === "window" ? 0.25 : 0.7,
      metalness: opening.kind === "window" ? 0.08 : 0,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(opening.widthMeters, opening.heightMeters);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      center.x + normal.x * 0.04,
      baseY + opening.bottomMeters + opening.heightMeters / 2,
      center.y + normal.y * 0.04,
    );
    mesh.rotation.y = Math.atan2(normal.x, normal.y);
    group.add(mesh);
  }
}

function createRoadStrip(coords: Position[], heightAt: (lon: number, lat: number) => number, widthMeters = 7.5) {
  if (coords.length < 2) return null;
  const locals = coords.map(localPoint);
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let index = 0; index < locals.length; index += 1) {
    const prev = locals[Math.max(0, index - 1)];
    const next = locals[Math.min(locals.length - 1, index + 1)];
    const direction = new THREE.Vector2().subVectors(next, prev).normalize();
    const normal = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(widthMeters / 2);
    left.push(locals[index].clone().add(normal));
    right.push(locals[index].clone().sub(normal));
  }
  const positions: number[] = [];
  for (let index = 0; index < locals.length - 1; index += 1) {
    const yA = heightAt(coords[index][0], coords[index][1]) + 0.025;
    const yB = heightAt(coords[index + 1][0], coords[index + 1][1]) + 0.025;
    positions.push(
      left[index].x, yA, left[index].y,
      right[index].x, yA, right[index].y,
      right[index + 1].x, yB, right[index + 1].y,
      left[index].x, yA, left[index].y,
      right[index + 1].x, yB, right[index + 1].y,
      left[index + 1].x, yB, left[index + 1].y,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: palette.street, roughness: 0.98 }));
  mesh.receiveShadow = true;
  return mesh;
}

function createTree(position: Position, heightAt: (lon: number, lat: number) => number, seed: number) {
  const group = new THREE.Group();
  const local = localPoint(position);
  const baseY = heightAt(position[0], position[1]);
  const trunkHeight = 2.6 + (seed % 5) * 0.35;
  const crownRadius = 1.8 + (seed % 7) * 0.22;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, trunkHeight, 7),
    new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 1 }),
  );
  trunk.position.set(local.x, baseY + trunkHeight / 2, local.y);
  trunk.castShadow = true;
  group.add(trunk);
  const crown = new THREE.Mesh(
    new THREE.IcosahedronGeometry(crownRadius, 1),
    new THREE.MeshStandardMaterial({ color: seed % 2 ? palette.tree : palette.treeDark, roughness: 1, flatShading: true }),
  );
  crown.scale.set(1, 1.25, 1);
  crown.position.set(local.x, baseY + trunkHeight + crownRadius * 0.7, local.y);
  crown.castShadow = true;
  group.add(crown);
  return group;
}

function Scene({ onReady }: { onReady: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;

    void Promise.all([
      loadJson<TerrainData>("terrain.json"),
      loadJson<FeatureCollection>("parcel.geojson"),
      loadJson<FeatureCollection>("buildings.geojson"),
      loadJson<FeatureCollection>("curbs.geojson"),
      loadJson<FeatureCollection>("sidewalks.geojson"),
      loadJson<FeatureCollection>("street-trees.geojson"),
      loadJson<FeatureCollection>("streets.geojson"),
      loadJson<SiteObservations>("site-observations.json"),
    ]).then(([terrainData, parcel, buildings, curbs, sidewalks, trees, streets, observations]) => {
      if (disposed) return;
      const sampler = makeTerrainSampler(terrainData);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(palette.sky);
      scene.fog = new THREE.Fog(palette.sky, 115, 250);

      const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 600);
      camera.position.set(72, 58, 74);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      host.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.065;
      controls.minDistance = 18;
      controls.maxDistance = 180;
      controls.maxPolarAngle = Math.PI * 0.485;
      controls.target.set(0, 4, 0);

      scene.add(new THREE.HemisphereLight(0xf4f8fb, 0x8aa27f, 2.1));
      const sun = new THREE.DirectionalLight(0xfff5df, 3.2);
      sun.position.set(-45, 85, 35);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -90;
      sun.shadow.camera.right = 90;
      sun.shadow.camera.top = 90;
      sun.shadow.camera.bottom = -90;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 220;
      scene.add(sun);

      scene.add(createTerrain(terrainData, sampler));

      const siteGroup = new THREE.Group();
      scene.add(siteGroup);
      const parcelMaterial = new THREE.MeshStandardMaterial({ color: palette.parcel, roughness: 1, transparent: true, opacity: 0.58, depthWrite: false });
      const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: palette.sidewalk, roughness: 1 });
      const curbMaterial = new THREE.MeshStandardMaterial({ color: palette.curb, roughness: 1 });

      addPolygonCollection(siteGroup, parcel, sampler.heightAt, parcelMaterial, 0.06);
      addPolygonCollection(siteGroup, sidewalks, sampler.heightAt, sidewalkMaterial, 0.12);
      addPolygonCollection(siteGroup, curbs, sampler.heightAt, curbMaterial, 0.15);

      const parcelRing = polygonParts(parcel.features[0]?.geometry)[0]?.[0];
      if (parcelRing) siteGroup.add(createParcelOutline(parcelRing, sampler.heightAt));

      for (const feature of streets.features) {
        for (const line of lineParts(feature.geometry)) {
          const road = createRoadStrip(line, sampler.heightAt);
          if (road) siteGroup.add(road);
        }
      }

      for (const feature of buildings.features) {
        const building = createBuilding(feature, sampler.heightAt, observations);
        if (building) siteGroup.add(building);
      }

      trees.features.forEach((feature, index) => {
        if (feature.geometry.type === "Point") siteGroup.add(createTree(feature.geometry.coordinates, sampler.heightAt, index + 11));
      });

      const resize = () => {
        if (!renderer) return;
        const width = host.clientWidth;
        const height = host.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      window.addEventListener("resize", resize);

      const animate = () => {
        controls?.update();
        renderer?.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      animate();
      onReady();

      host.dataset.cleanup = "ready";
      (host as HTMLDivElement & { __cleanup?: () => void }).__cleanup = () => {
        window.removeEventListener("resize", resize);
        cancelAnimationFrame(frame);
        controls?.dispose();
        renderer?.dispose();
        renderer?.domElement.remove();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
      };
    }).catch((error) => {
      console.error(error);
      if (!disposed) onReady();
    });

    return () => {
      disposed = true;
      const cleanup = (host as HTMLDivElement & { __cleanup?: () => void }).__cleanup;
      cleanup?.();
    };
  }, [onReady]);

  return <div className="scene" ref={hostRef} />;
}

function App() {
  const [ready, setReady] = useState(false);
  return (
    <main className="app">
      <Scene onReady={() => setReady(true)} />
      {!ready && <div className="loading">Building Corralitas site twin...</div>}
      <div className="topbar">
        <section className="title-card">
          <p className="kicker">Site Twin Research 001</p>
          <h1>2629 Corralitas Dr</h1>
          <p className="subtitle">Measured terrain and GIS geometry first. AI facade observations are a separate structured layer so visual inference never changes the surveyed geometry.</p>
        </section>
        <section className="data-card" aria-label="Prototype data sources">
          <div className="data-row"><span>Parcel</span><strong>LA County</strong></div>
          <div className="data-row"><span>Building outlines</span><strong>LARIAC 2023</strong></div>
          <div className="data-row"><span>Terrain</span><strong>USGS elevation</strong></div>
          <div className="data-row"><span>Street / sidewalk</span><strong>LA City GIS</strong></div>
          <div className="data-row"><span>Facade layer</span><strong>AI observations</strong></div>
        </section>
      </div>
      <section className="legend">
        <p className="legend-title">Prototype layers</p>
        <div className="legend-grid">
          <div className="legend-item"><span className="swatch house" />Target house</div>
          <div className="legend-item"><span className="swatch parcel" />Parcel / landscape</div>
          <div className="legend-item"><span className="swatch sidewalk" />Sidewalk / curb</div>
          <div className="legend-item"><span className="swatch street" />Street</div>
          <div className="legend-item"><span className="swatch tree" />Street trees</div>
          <div className="legend-item"><span className="swatch neighbor" />Neighbor massing</div>
        </div>
        <p className="research-note">Drag to orbit. Scroll to zoom. V0 intentionally keeps inferred facade details separate from measured geometry so we can inspect and correct AI output one property at a time.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
