import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingFeature, GroundCoverClass, Position, SemanticFacade, SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { localMeters, polygonCentroid } from "@officeadmin-geo/site-twin-core";

export interface SiteTwinSceneProps {
  model: SemanticSiteModel;
  debug?: boolean;
  className?: string;
}

const COLORS = {
  warmWhite: "#e8e5db",
  coolGray: "#b7bbb7",
  charcoal: "#4e5557",
  wood: "#9b6f48",
  glass: "#6d8a91",
  grass: "#8ba77d",
  soil: "#aa8f71",
  road: "#6f7677",
  sidewalk: "#c9c7bb",
  concrete: "#aaa89e",
  tree: "#6e8c61",
  treeDark: "#4f6548",
  parcel: "#a4b894",
  debug: "#d14f34",
} as const;

const GROUND_COVER_COLORS: Partial<Record<GroundCoverClass, string>> = {
  tree_canopy: "#66875d",
  grass_shrubs: "#91aa79",
  tall_shrubs: "#8d9d67",
  bare_soil: "#a98867",
  water: "#769fb6",
  road_railroad: "#707777",
  other_paved: "#b8b7af",
};

function mapColor(values: string[], fallback: string = COLORS.warmWhite) {
  const value = values.join(" ").toLowerCase();
  if (value.includes("wood") || value.includes("brown") || value.includes("cedar")) return COLORS.wood;
  if (value.includes("black") || value.includes("charcoal") || value.includes("dark gray") || value.includes("dark grey")) return COLORS.charcoal;
  if (value.includes("gray") || value.includes("grey") || value.includes("concrete")) return COLORS.coolGray;
  if (value.includes("white") || value.includes("cream") || value.includes("stucco")) return COLORS.warmWhite;
  return fallback;
}

function shapeFromPolygon(polygon: Position[], center: SemanticSiteModel["center"]) {
  const points = polygon.map((position) => localMeters(position, center));
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return { shape, points };
}

function boundsForBuilding(building: BuildingFeature, center: SemanticSiteModel["center"]) {
  const points = building.polygon.map((position) => localMeters(position, center));
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}


function terrainBaseElevation(model: SemanticSiteModel) {
  if (!model.geometry.terrain.length) return 0;
  return Math.min(...model.geometry.terrain.map((sample) => sample.elevationM));
}

function terrainHeightAtLocal(model: SemanticSiteModel, x: number, z: number) {
  const samples = model.geometry.terrain;
  if (!samples.length) return 0;
  const base = terrainBaseElevation(model);
  let weightedElevation = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    const [sampleX, sampleZ] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    const distanceSquared = (sampleX - x) ** 2 + (sampleZ - z) ** 2;
    if (distanceSquared < 0.01) return sample.elevationM - base;
    const weight = 1 / Math.max(1, distanceSquared);
    weightedElevation += sample.elevationM * weight;
    totalWeight += weight;
  }
  return totalWeight ? weightedElevation / totalWeight - base : 0;
}

function terrainHeightAtPosition(model: SemanticSiteModel, position: Position) {
  const [x, z] = localMeters(position, model.center);
  return terrainHeightAtLocal(model, x, z);
}

function TerrainGround({ model }: { model: SemanticSiteModel }) {
  const samples = model.geometry.terrain;
  if (samples.length < 4) return null;
  const latitudes = [...new Set(samples.map((sample) => sample.coordinate.latitude))].sort((a, b) => a - b);
  const longitudes = [...new Set(samples.map((sample) => sample.coordinate.longitude))].sort((a, b) => a - b);
  if (latitudes.length < 2 || longitudes.length < 2) return null;

  const lookup = new Map(samples.map((sample) => [`${sample.coordinate.latitude}|${sample.coordinate.longitude}`, sample]));
  const base = terrainBaseElevation(model);
  const vertices: number[] = [];
  for (const latitude of latitudes) {
    for (const longitude of longitudes) {
      const sample = lookup.get(`${latitude}|${longitude}`);
      const [x, z] = localMeters([longitude, latitude], model.center);
      vertices.push(x, (sample?.elevationM ?? base) - base, z);
    }
  }

  const indices: number[] = [];
  const columns = longitudes.length;
  for (let row = 0; row < latitudes.length - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={model.site.grass.value ? COLORS.grass : COLORS.soil} roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

function BuildingMass({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const height = building.heightM ?? (model.storiesApprox?.value ?? 2) * 3.1;
  const front = model.facades.find((facade) => facade.wall === "front");
  const side = model.facades.find((facade) => facade.wall === "left");
  const wallColor = mapColor([...(front?.colors.value ?? []), ...(side?.colors.value ?? [])]);

  const buildingBaseY = terrainHeightAtPosition(model, [polygonCentroid(building.polygon).longitude, polygonCentroid(building.polygon).latitude]);

  return (
    <group position={[0, buildingBaseY, 0]}>
      <mesh castShadow receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
        <meshStandardMaterial color={wallColor} roughness={0.88} metalness={0.02} />
      </mesh>
      <Roof building={building} model={model} height={height} />
      <FacadeOpenings building={building} model={model} facade={front} height={height} side="front" />
      <FacadeOpenings building={building} model={model} facade={side} height={height} side="left" />
    </group>
  );
}

function Roof({ building, model, height }: { building: BuildingFeature; model: SemanticSiteModel; height: number }) {
  const roof = model.roof.value;
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const bounds = boundsForBuilding(building, model.center);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const roofColor = mapColor([roof.color ?? roof.material ?? "dark gray"], COLORS.charcoal);

  if (roof.type === "gable") {
    const ridgeAlongX = width >= depth;
    const rise = Math.min(2.8, Math.max(1.1, (ridgeAlongX ? depth : width) * 0.22));
    const vertices = ridgeAlongX
      ? [
          bounds.minX, height, bounds.minZ,
          bounds.maxX, height, bounds.minZ,
          bounds.maxX, height, bounds.maxZ,
          bounds.minX, height, bounds.maxZ,
          bounds.minX, height + rise, centerZ,
          bounds.maxX, height + rise, centerZ,
        ]
      : [
          bounds.minX, height, bounds.minZ,
          bounds.maxX, height, bounds.minZ,
          bounds.maxX, height, bounds.maxZ,
          bounds.minX, height, bounds.maxZ,
          centerX, height + rise, bounds.minZ,
          centerX, height + rise, bounds.maxZ,
        ];
    const indices = ridgeAlongX
      ? [0, 1, 5, 0, 5, 4, 3, 4, 5, 3, 5, 2, 0, 4, 3, 1, 2, 5]
      : [0, 4, 3, 3, 4, 5, 1, 2, 5, 1, 5, 4, 0, 1, 4, 3, 5, 2];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={roofColor} roughness={0.78} /></mesh>;
  }

  if (roof.type === "shed") {
    const geometry = new THREE.BufferGeometry();
    const rise = 1.5;
    const vertices = [
      bounds.minX, height, bounds.minZ,
      bounds.maxX, height + rise, bounds.minZ,
      bounds.maxX, height + rise, bounds.maxZ,
      bounds.minX, height, bounds.maxZ,
    ];
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={roofColor} roughness={0.78} side={THREE.DoubleSide} /></mesh>;
  }

  if (roof.type === "hip") {
    const roofHeight = Math.min(2.4, Math.max(1, Math.min(width, depth) * 0.18));
    return (
      <mesh position={[centerX, height + roofHeight * 0.5, centerZ]} castShadow receiveShadow>
        <coneGeometry args={[Math.max(width, depth) * 0.62, roofHeight, 4]} />
        <meshStandardMaterial color={roofColor} roughness={0.78} />
      </mesh>
    );
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height + 0.03, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={roofColor} roughness={0.82} />
      </mesh>
      {roof.rooftopDeck ? (
        <mesh position={[centerX, height + 0.48, centerZ]} castShadow>
          <boxGeometry args={[Math.max(1, width - 1.2), 0.07, Math.max(1, depth - 1.2)]} />
          <meshStandardMaterial color={COLORS.concrete} roughness={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

function FacadeOpenings({
  building,
  model,
  facade,
  height,
  side,
}: {
  building: BuildingFeature;
  model: SemanticSiteModel;
  facade?: SemanticFacade;
  height: number;
  side: "front" | "left";
}) {
  if (!facade) return null;
  const bounds = boundsForBuilding(building, model.center);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const elements: React.ReactNode[] = [];

  facade.windows.forEach((window, index) => {
    const w = Math.max(0.8, (side === "front" ? width : depth) * window.width);
    const h = Math.max(0.7, height * window.height);
    const y = Math.max(h / 2 + 0.35, window.y * height);
    if (side === "front") {
      const x = bounds.minX + window.x * width;
      elements.push(
        <mesh key={`window-${side}-${index}`} position={[x, y, bounds.maxZ + 0.025]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color={COLORS.glass} roughness={0.2} metalness={0.12} />
        </mesh>,
      );
    } else {
      const z = bounds.minZ + window.x * depth;
      elements.push(
        <mesh key={`window-${side}-${index}`} position={[bounds.minX - 0.025, y, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color={COLORS.glass} roughness={0.2} metalness={0.12} />
        </mesh>,
      );
    }
  });

  facade.doors.forEach((door, index) => {
    const w = Math.max(0.9, (side === "front" ? width : depth) * door.width);
    const h = Math.max(1.9, height * door.height);
    if (side === "front") {
      const x = bounds.minX + door.x * width;
      elements.push(
        <mesh key={`door-${side}-${index}`} position={[x, h / 2, bounds.maxZ + 0.035]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color={mapColor([door.material ?? door.color ?? "wood"], COLORS.wood)} roughness={0.75} />
        </mesh>,
      );
    }
  });

  return <group>{elements}</group>;
}

function StreetContext({ model }: { model: SemanticSiteModel }) {
  return (
    <group>
      {model.geometry.roads.map((road) => (
        <Line
          key={road.id}
          points={road.points.map((point) => {
            const [x, z] = localMeters(point, model.center);
            return [x, terrainHeightAtPosition(model, point) + 0.08, z] as [number, number, number];
          })}
          color={COLORS.road}
          lineWidth={Math.max(6, Math.min(18, (road.widthM ?? 5) * 1.6))}
        />
      ))}
      {model.geometry.sidewalks.map((sidewalk) => (
        <Line
          key={sidewalk.id}
          points={sidewalk.points.map((point) => {
            const [x, z] = localMeters(point, model.center);
            return [x, terrainHeightAtPosition(model, point) + 0.12, z] as [number, number, number];
          })}
          color={COLORS.sidewalk}
          lineWidth={5}
        />
      ))}
    </group>
  );
}

function GroundCoverLayer({ model }: { model: SemanticSiteModel }) {
  const samples = model.geometry.groundCover;
  if (!samples.length) return null;
  const longitudes = [...new Set(samples.map((sample) => sample.coordinate.longitude))].sort((a, b) => a - b);
  const latitudes = [...new Set(samples.map((sample) => sample.coordinate.latitude))].sort((a, b) => a - b);
  const widthM = longitudes.length > 1
    ? Math.abs(localMeters([longitudes[1]!, model.center.latitude], model.center)[0] - localMeters([longitudes[0]!, model.center.latitude], model.center)[0])
    : 2;
  const depthM = latitudes.length > 1
    ? Math.abs(localMeters([model.center.longitude, latitudes[1]!], model.center)[1] - localMeters([model.center.longitude, latitudes[0]!], model.center)[1])
    : 2;

  return (
    <group>
      {Object.entries(GROUND_COVER_COLORS).map(([rawClass, color]) => {
        const className = rawClass as GroundCoverClass;
        const classSamples = samples.filter((sample) => sample.className === className);
        if (!classSamples.length || !color) return null;
        const vertices: number[] = [];
        const indices: number[] = [];
        classSamples.forEach((sample, index) => {
          const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
          const y = terrainHeightAtLocal(model, x, z) + 0.055;
          const halfW = widthM * 0.52;
          const halfD = depthM * 0.52;
          const offset = index * 4;
          vertices.push(
            x - halfW, y, z - halfD,
            x + halfW, y, z - halfD,
            x + halfW, y, z + halfD,
            x - halfW, y, z + halfD,
          );
          indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return (
          <mesh key={className} geometry={geometry} receiveShadow>
            <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

function ParcelGround({ model, debug }: { model: SemanticSiteModel; debug: boolean }) {
  const parcel = model.geometry.parcel;
  if (model.geometry.terrain.length >= 4) {
    return (
      <group>
        <TerrainGround model={model} />
        {parcel && debug ? (
          <Line
            points={parcel.polygon.map((point) => {
              const [x, z] = localMeters(point, model.center);
              return [x, terrainHeightAtPosition(model, point) + 0.12, z] as [number, number, number];
            })}
            color={COLORS.debug}
            lineWidth={2}
          />
        ) : null}
      </group>
    );
  }
  if (!parcel) {
    return (
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial color={model.site.grass.value ? COLORS.grass : COLORS.soil} roughness={1} />
      </mesh>
    );
  }
  const { shape, points } = shapeFromPolygon(parcel.polygon, model.center);
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={model.site.grass.value ? COLORS.grass : COLORS.parcel} roughness={1} />
      </mesh>
      {debug ? (
        <Line points={points.map(([x, z]) => [x, 0.08, z] as [number, number, number])} color={COLORS.debug} lineWidth={2} />
      ) : null}
    </group>
  );
}

function SiteDetails({ model }: { model: SemanticSiteModel }) {
  const primary = model.geometry.buildings.find((building) => building.id === model.geometry.primaryBuildingId) ?? model.geometry.buildings[0];
  if (!primary) return null;
  const bounds = boundsForBuilding(primary, model.center);
  const width = bounds.maxX - bounds.minX;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const frontZ = bounds.maxZ;
  const centroid = polygonCentroid(primary.polygon);
  const siteBaseY = terrainHeightAtPosition(model, [centroid.longitude, centroid.latitude]);

  return (
    <group position={[0, siteBaseY, 0]}>
      {model.site.stairs.value ? Array.from({ length: 6 }).map((_, index) => (
        <mesh key={`step-${index}`} position={[centerX + width * 0.28, 0.12 + index * 0.12, frontZ + 1.5 + index * 0.38]} castShadow receiveShadow>
          <boxGeometry args={[1.9, 0.22, 0.7]} />
          <meshStandardMaterial color={COLORS.concrete} roughness={0.95} />
        </mesh>
      )) : null}
      {model.site.retainingWalls.value ? (
        <mesh position={[centerX - width * 0.25, 0.7, frontZ + 2.7]} castShadow receiveShadow>
          <boxGeometry args={[Math.max(3, width * 0.42), 1.4, 0.35]} />
          <meshStandardMaterial color={COLORS.concrete} roughness={0.95} />
        </mesh>
      ) : null}
      {model.site.trees.value ? (
        <group position={[bounds.minX - 2.4, 0, frontZ + 1.2]}>
          <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.18, 0.24, 2.4, 8]} /><meshStandardMaterial color={COLORS.wood} /></mesh>
          <mesh position={[0, 3.1, 0]} castShadow><dodecahedronGeometry args={[1.6, 0]} /><meshStandardMaterial color={COLORS.tree} roughness={1} /></mesh>
          <mesh position={[0.8, 3.6, -0.3]} castShadow><dodecahedronGeometry args={[1.0, 0]} /><meshStandardMaterial color={COLORS.treeDark} roughness={1} /></mesh>
        </group>
      ) : null}
    </group>
  );
}

function SceneContents({ model, debug }: { model: SemanticSiteModel; debug: boolean }) {
  return (
    <>
      <color attach="background" args={["#dfe8ee"]} />
      <Sky sunPosition={[6, 10, 4]} turbidity={8} rayleigh={2.2} />
      <ambientLight intensity={1.25} />
      <directionalLight position={[18, 28, 14]} intensity={2.6} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <ParcelGround model={model} debug={debug} />
      <GroundCoverLayer model={model} />
      <StreetContext model={model} />
      {model.geometry.buildings.map((building) => (
        <BuildingMass key={building.id} building={building} model={model} />
      ))}
      <SiteDetails model={model} />
      {debug && model.geometry.terrain.length < 4 ? <gridHelper args={[90, 45, "#9fa8a4", "#cbd0cb"]} position={[0, -0.03, 0]} /> : null}
      <OrbitControls makeDefault target={[0, 3.2, 0]} minDistance={8} maxDistance={90} maxPolarAngle={Math.PI * 0.48} />
    </>
  );
}

export function SiteTwinScene({ model, debug = false, className }: SiteTwinSceneProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas shadows camera={{ position: [28, 23, 34], fov: 42, near: 0.1, far: 500 }} dpr={[1, 2]}>
        <SceneContents model={model} debug={debug} />
      </Canvas>
    </div>
  );
}
