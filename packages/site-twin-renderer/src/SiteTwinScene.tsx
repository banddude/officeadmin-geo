import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingFeature, GroundCoverClass, Position, SemanticFacade, SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { haversineMeters, localMeters, polygonCentroid, renderedBuildingHeightM } from "@officeadmin-geo/site-twin-core";

export interface SiteTwinSceneProps {
  model: SemanticSiteModel;
  debug?: boolean;
  className?: string;
  view?: "facade" | "overview";
}

const COLORS = {
  warmWhite: "#f4efe3",
  warmWhiteShadow: "#d8d2c5",
  coolGray: "#bfc3bf",
  charcoal: "#29363b",
  roof: "#4d585a",
  wood: "#a76235",
  glass: "#376f87",
  glassHighlight: "#b9d7e2",
  grass: "#769b61",
  grassLight: "#9fba78",
  soil: "#a67f5f",
  road: "#4e5759",
  roadEdge: "#7b8584",
  sidewalk: "#cec9ba",
  concrete: "#aaa69b",
  tree: "#527b49",
  treeLight: "#709657",
  treeDark: "#355f3d",
  parcel: "#8ca76d",
  debug: "#e36542",
} as const;

const GROUND_COVER_COLORS: Partial<Record<GroundCoverClass, string>> = {
  tree_canopy: "#628954",
  grass_shrubs: "#86a76a",
  tall_shrubs: "#6f925b",
  bare_soil: "#aa8464",
  water: "#6e9eae",
  road_railroad: "#697272",
  other_paved: "#bdb8aa",
  building: "#8ea26f",
};

function mapColor(values: string[], fallback: string = COLORS.warmWhite) {
  const value = values.join(" ").toLowerCase();
  if (value.includes("wood") || value.includes("brown") || value.includes("cedar")) return COLORS.wood;
  if (value.includes("black") || value.includes("charcoal") || value.includes("dark gray") || value.includes("dark grey")) return COLORS.charcoal;
  if (value.includes("white") || value.includes("cream") || value.includes("stucco")) return COLORS.warmWhite;
  if (value.includes("gray") || value.includes("grey") || value.includes("concrete")) return COLORS.coolGray;
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
  const local = samples.map((sample) => {
    const [sx, sz] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    return { x: sx, z: sz, elevationM: sample.elevationM };
  });
  const xs = [...new Set(local.map((sample) => sample.x))].sort((a, b) => a - b);
  const zs = [...new Set(local.map((sample) => sample.z))].sort((a, b) => a - b);
  if (xs.length < 2 || zs.length < 2) {
    const nearest = [...local].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return nearest ? nearest.elevationM - base : 0;
  }

  const bracket = (values: number[], value: number) => {
    if (value <= values[0]!) return [values[0]!, values[0]!] as const;
    if (value >= values.at(-1)!) return [values.at(-1)!, values.at(-1)!] as const;
    for (let index = 0; index < values.length - 1; index += 1) {
      const low = values[index]!;
      const high = values[index + 1]!;
      if (value >= low && value <= high) return [low, high] as const;
    }
    return [values[0]!, values[0]!] as const;
  };
  const [x0, x1] = bracket(xs, x);
  const [z0, z1] = bracket(zs, z);
  const corner = (cx: number, cz: number) => local.reduce((best, sample) => {
    const distance = Math.abs(sample.x - cx) + Math.abs(sample.z - cz);
    return !best || distance < best.distance ? { sample, distance } : best;
  }, undefined as { sample: (typeof local)[number]; distance: number } | undefined)?.sample.elevationM ?? base;
  const e00 = corner(x0, z0);
  const e10 = corner(x1, z0);
  const e01 = corner(x0, z1);
  const e11 = corner(x1, z1);
  const tx = x1 === x0 ? 0 : Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
  const tz = z1 === z0 ? 0 : Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
  const low = e00 + (e10 - e00) * tx;
  const high = e01 + (e11 - e01) * tx;
  return low + (high - low) * tz - base;
}

function terrainHeightAtPosition(model: SemanticSiteModel, position: Position) {
  const [x, z] = localMeters(position, model.center);
  return terrainHeightAtLocal(model, x, z);
}

function TerrainGround({ model }: { model: SemanticSiteModel }) {
  const samples = model.geometry.terrain;
  if (samples.length < 4) return null;
  const terrainLocal = samples.map((sample) => {
    const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    return { x, z };
  });
  const minX = Math.min(...terrainLocal.map((sample) => sample.x));
  const maxX = Math.max(...terrainLocal.map((sample) => sample.x));
  const minZ = Math.min(...terrainLocal.map((sample) => sample.z));
  const maxZ = Math.max(...terrainLocal.map((sample) => sample.z));
  const cover = model.geometry.groundCover.map((sample) => {
    const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    return { x, z, className: sample.className };
  });

  // The elevation source is intentionally sparse. Upsample the measured surface
  // for rendering, while using the denser land-cover samples for visual breakup.
  const rows = 30;
  const columns = 30;
  const vertices: number[] = [];
  const colors: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const z = minZ + (maxZ - minZ) * (row / (rows - 1));
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (maxX - minX) * (column / (columns - 1));
      vertices.push(x, terrainHeightAtLocal(model, x, z), z);
      let nearest = cover[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of cover) {
        const distance = (candidate.x - x) ** 2 + (candidate.z - z) ** 2;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = candidate;
        }
      }
      const color = new THREE.Color(nearest ? (GROUND_COVER_COLORS[nearest.className] ?? COLORS.grass) : COLORS.grass);
      const variation = 0.93 + ((Math.sin(x * 0.31 + z * 0.17) + Math.sin(x * 0.11 - z * 0.27)) * 0.035 + 0.035);
      color.multiplyScalar(variation);
      colors.push(color.r, color.g, color.b);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
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
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.98} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

function buildingBaseY(building: BuildingFeature, model: SemanticSiteModel) {
  if (typeof building.groundElevationM === "number" && Number.isFinite(building.groundElevationM)) {
    return building.groundElevationM - terrainBaseElevation(model);
  }
  const centroid = polygonCentroid(building.polygon);
  return terrainHeightAtPosition(model, [centroid.longitude, centroid.latitude]);
}

function primaryBuilding(model: SemanticSiteModel) {
  return model.geometry.buildings.find((building) => building.id === model.geometry.primaryBuildingId) ?? model.geometry.buildings[0];
}

function defaultCameraTarget(model: SemanticSiteModel): [number, number, number] {
  const building = primaryBuilding(model);
  if (!building) return [0, 3.2, 0];
  const centroid = polygonCentroid(building.polygon);
  const [x, z] = localMeters([centroid.longitude, centroid.latitude], model.center);
  const baseY = buildingBaseY(building, model);
  const height = renderedBuildingHeightM(building, (model.storiesApprox?.value ?? 2) * 3.1);
  const alignment = model.facadeAlignment;
  const source = alignment
    ? model.imagery.find((image) => image.id === alignment.sourceImageId)
    : model.imagery[0];
  if (model.massing?.storiesVisible && source) {
    const [sourceX, sourceZ] = localMeters([source.longitude, source.latitude], model.center);
    const streetY = terrainHeightAtLocal(model, sourceX, sourceZ);
    const topY = buildingTopY(building, model);
    // Street-derived framing keeps asphalt and the hillside base visible while
    // still fitting the roof in a wide architectural composition.
    return [x, Math.min(topY - 2.4, streetY + 5.2), z];
  }
  return [x, baseY + Math.min(4.8, height * 0.48), z];
}

function defaultCameraPosition(model: SemanticSiteModel, view: "facade" | "overview"): [number, number, number] {
  const target = defaultCameraTarget(model);
  if (view === "overview") {
    const terrain = model.geometry.terrain;
    if (terrain.length >= 2) {
      const low = [...terrain].sort((a, b) => a.elevationM - b.elevationM)[0]!;
      const high = [...terrain].sort((a, b) => b.elevationM - a.elevationM)[0]!;
      const [lowX, lowZ] = localMeters([low.coordinate.longitude, low.coordinate.latitude], model.center);
      const [highX, highZ] = localMeters([high.coordinate.longitude, high.coordinate.latitude], model.center);
      const dx = lowX - highX;
      const dz = lowZ - highZ;
      const length = Math.max(1, Math.hypot(dx, dz));
      return [
        target[0] + (dx / length) * 52,
        target[1] + 22,
        target[2] + (dz / length) * 52,
      ];
    }
    return [target[0] + 38, target[1] + 28, target[2] + 42];
  }
  const alignment = model.facadeAlignment;
  const source = alignment
    ? model.imagery.find((image) => image.id === alignment.sourceImageId)
    : model.imagery[0];
  if (!source) return [target[0] + 22, target[1] + 6, target[2] + 22];
  const [sourceX, sourceZ] = localMeters([source.longitude, source.latitude], model.center);
  const dx = sourceX - target[0];
  const dz = sourceZ - target[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 1) return [target[0] + 22, target[1] + 6, target[2] + 22];
  const horizontalDistance = Math.max(27, Math.min(31, distance * 1.45));
  const streetY = terrainHeightAtLocal(model, sourceX, sourceZ);
  // Stay close to the measured Street View position. The extra setback gives the
  // renderer breathing room while keeping the street, retaining wall, and facade
  // in one grounded composition instead of a floating aerial view.
  const cameraY = streetY + 2.05;
  return [
    target[0] + (dx / distance) * horizontalDistance,
    cameraY,
    target[2] + (dz / distance) * horizontalDistance,
  ];
}

function buildingTopY(building: BuildingFeature, model: SemanticSiteModel) {
  if (typeof building.roofElevationM === "number" && Number.isFinite(building.roofElevationM) && building.roofElevationM > 0) {
    return building.roofElevationM - terrainBaseElevation(model);
  }
  return buildingBaseY(building, model) + renderedBuildingHeightM(building, 6.2);
}

function terrainConformingWallGeometry(building: BuildingFeature, model: SemanticSiteModel, topOverrideY?: number) {
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const topY = topOverrideY ?? buildingTopY(building, model);
  const vertices: number[] = [];
  const indices: number[] = [];
  ring.forEach((aPosition, index) => {
    const bPosition = ring[(index + 1) % ring.length];
    if (!bPosition) return;
    const [ax, az] = localMeters(aPosition, model.center);
    const [bx, bz] = localMeters(bPosition, model.center);
    const aGround = Math.min(topY - 0.8, terrainHeightAtPosition(model, aPosition));
    const bGround = Math.min(topY - 0.8, terrainHeightAtPosition(model, bPosition));
    const offset = vertices.length / 3;
    vertices.push(
      ax, aGround, az,
      bx, bGround, bz,
      bx, topY, bz,
      ax, topY, az,
    );
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function cappedTerrainWallGeometry(
  building: BuildingFeature,
  model: SemanticSiteModel,
  topY: number,
  maxExposedHeight = 2.2,
) {
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const vertices: number[] = [];
  const indices: number[] = [];
  ring.forEach((aPosition, index) => {
    const bPosition = ring[(index + 1) % ring.length];
    if (!bPosition) return;
    const [ax, az] = localMeters(aPosition, model.center);
    const [bx, bz] = localMeters(bPosition, model.center);
    const aTerrain = terrainHeightAtPosition(model, aPosition);
    const bTerrain = terrainHeightAtPosition(model, bPosition);
    const aGround = Math.min(topY - 0.25, Math.max(aTerrain, topY - maxExposedHeight));
    const bGround = Math.min(topY - 0.25, Math.max(bTerrain, topY - maxExposedHeight));
    const offset = vertices.length / 3;
    vertices.push(ax, aGround, az, bx, bGround, bz, bx, topY, bz, ax, topY, az);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildingPalette(id: string) {
  const palettes = [
    { wall: "#e3e1d8", roof: "#b7b8b3" },
    { wall: "#d8ddd9", roof: "#abb0ad" },
    { wall: "#e6ded2", roof: "#b9b1a6" },
    { wall: "#d6d7d2", roof: "#a8aaa7" },
  ];
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[hash % palettes.length]!;
}

function ContextBuilding({ building, model, subdued = false }: { building: BuildingFeature; model: SemanticSiteModel; subdued?: boolean }) {
  if ((building.roofElevationM ?? 0) <= 0 && (building.heightM ?? 0) <= 0) return null;
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const topY = buildingTopY(building, model);
  const measuredHeight = renderedBuildingHeightM(building, 5.6);
  const visibleHeight = Math.max(3.8, Math.min(subdued ? 4.6 : 6.2, building.levels ? building.levels * 2.65 : Math.min(measuredHeight, subdued ? 4.4 : 5.8)));
  const visibleBaseY = topY - visibleHeight;
  const plinthGeometry = cappedTerrainWallGeometry(building, model, visibleBaseY, subdued ? 0.9 : 1.25);
  const palette = buildingPalette(building.id);
  const wallColor = subdued ? "#dddcd5" : palette.wall;
  const roofColor = subdued ? "#b7b9b3" : palette.roof;
  return (
    <group>
      <mesh geometry={plinthGeometry} receiveShadow>
        <meshStandardMaterial color={subdued ? "#c2c0b8" : "#aaa99f"} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, visibleBaseY, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: visibleHeight, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }]} />
        <meshStandardMaterial color={wallColor} roughness={0.98} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY + 0.03, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={roofColor} roughness={0.96} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function targetMassingAxes(building: BuildingFeature, model: SemanticSiteModel) {
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const centroid = polygonCentroid(building.polygon);
  const [cx, cz] = localMeters([centroid.longitude, centroid.latitude], model.center);
  const edgeIndex = model.facadeAlignment?.frontEdgeIndex ?? 0;
  const a = ring[edgeIndex] ?? ring[0]!;
  const b = ring[(edgeIndex + 1) % ring.length] ?? ring[1]!;
  const [ax, az] = localMeters(a, model.center);
  const [bx, bz] = localMeters(b, model.center);
  const edgeLength = Math.max(0.001, Math.hypot(bx - ax, bz - az));
  let tx = (bx - ax) / edgeLength;
  let tz = (bz - az) / edgeLength;

  const source = model.facadeAlignment
    ? model.imagery.find((image) => image.id === model.facadeAlignment?.sourceImageId)
    : model.imagery[0];
  if (source) {
    const [cameraX, cameraZ] = localMeters([source.longitude, source.latitude], model.center);
    const forwardX = cx - cameraX;
    const forwardZ = cz - cameraZ;
    const imageRightX = -forwardZ;
    const imageRightZ = forwardX;
    if (tx * imageRightX + tz * imageRightZ < 0) { tx *= -1; tz *= -1; }
  }

  let nx = -tz;
  let nz = tx;
  if (source) {
    const [cameraX, cameraZ] = localMeters([source.longitude, source.latitude], model.center);
    if ((cameraX - cx) * nx + (cameraZ - cz) * nz < 0) { nx *= -1; nz *= -1; }
  }

  const projected = ring.map((position) => {
    const [x, z] = localMeters(position, model.center);
    const dx = x - cx;
    const dz = z - cz;
    return { t: dx * tx + dz * tz, n: dx * nx + dz * nz };
  });
  const minT = Math.min(...projected.map((point) => point.t));
  const maxT = Math.max(...projected.map((point) => point.t));
  const minN = Math.min(...projected.map((point) => point.n));
  const maxN = Math.max(...projected.map((point) => point.n));
  return { cx, cz, tx, tz, nx, nz, minT, maxT, minN, maxN, width: maxT - minT, depth: maxN - minN, rotationY: -Math.atan2(tz, tx) };
}

function setbackMeters(value: string | undefined, level: number) {
  if (value === "deep") return 1.65 + level * 0.18;
  if (value === "moderate") return 1.0 + level * 0.12;
  if (value === "slight") return 0.5 + level * 0.08;
  return level === 0 ? 0 : level * 0.18;
}

function HillsidePodium({
  model,
  axes,
  layout,
  topY,
}: {
  model: SemanticSiteModel;
  axes: ReturnType<typeof targetMassingAxes>;
  layout: { width: number; depth: number; centerT: number; centerN: number; frontN: number };
  topY: number;
}) {
  const faceN = layout.frontN + 0.08;
  const faceX = axes.cx + axes.tx * layout.centerT + axes.nx * faceN;
  const faceZ = axes.cz + axes.tz * layout.centerT + axes.nz * faceN;
  const groundY = terrainHeightAtLocal(model, faceX, faceZ);
  const exposedHeight = Math.max(0.4, topY - groundY);
  const tierCount = exposedHeight > 3.2 ? 3 : 2;
  const tierDrop = exposedHeight / tierCount;
  const terraceRun = Math.max(1.8, Math.min(2.55, layout.depth * 0.32));
  const baseWidth = Math.max(5.4, layout.width * 1.02);

  return (
    <group>
      {Array.from({ length: tierCount }).map((_, index) => {
        const upperY = topY - tierDrop * index;
        const lowerY = topY - tierDrop * (index + 1);
        const n = faceN + terraceRun * index;
        const width = baseWidth + index * 0.62;
        const x = axes.cx + axes.tx * layout.centerT + axes.nx * n;
        const z = axes.cz + axes.tz * layout.centerT + axes.nz * n;
        const sideY = (upperY + lowerY) / 2;
        const shelfN = n + terraceRun * 0.54;
        const shelfX = axes.cx + axes.tx * layout.centerT + axes.nx * shelfN;
        const shelfZ = axes.cz + axes.tz * layout.centerT + axes.nz * shelfN;
        return (
          <group key={`podium-tier-${index}`}>
            <mesh position={[x, sideY, z]} rotation={[0, axes.rotationY, 0]} receiveShadow castShadow>
              <boxGeometry args={[width, tierDrop, 0.2]} />
              <meshStandardMaterial color={index === 0 ? "#aca89f" : index === 1 ? "#b8b3a9" : "#c0bbb0"} roughness={1} />
            </mesh>
            <mesh
              position={[shelfX, lowerY + 0.055, shelfZ]}
              rotation={[0, axes.rotationY, 0]}
              receiveShadow
            >
              <boxGeometry args={[Math.max(5.0, width - 0.24), 0.11, terraceRun * 0.9]} />
              <meshStandardMaterial color={index % 2 === 0 ? "#76945d" : "#86a46a"} roughness={1} />
            </mesh>
            {index === 0 ? [-1, 1].map((side) => {
              const t = layout.centerT + side * width / 2;
              const returnN = n + Math.min(2.1, terraceRun * 0.92) / 2;
              const sideX = axes.cx + axes.tx * t + axes.nx * returnN;
              const sideZ = axes.cz + axes.tz * t + axes.nz * returnN;
              return (
                <mesh
                  key={`podium-upper-return-${side}`}
                  position={[sideX, sideY, sideZ]}
                  rotation={[0, axes.rotationY + Math.PI / 2, 0]}
                  receiveShadow
                  castShadow
                >
                  <boxGeometry args={[Math.min(2.1, terraceRun * 0.92), tierDrop, 0.18]} />
                  <meshStandardMaterial color="#aaa69d" roughness={1} />
                </mesh>
              );
            }) : null}
            {[-0.3, 0.28].map((offset, shrubIndex) => {
              const shrubT = layout.centerT + width * offset;
              const shrubN = shelfN + (shrubIndex ? 0.18 : -0.14);
              const shrubX = axes.cx + axes.tx * shrubT + axes.nx * shrubN;
              const shrubZ = axes.cz + axes.tz * shrubT + axes.nz * shrubN;
              return (
                <LowPolyShrub
                  key={`podium-shrub-${index}-${shrubIndex}`}
                  x={shrubX}
                  y={lowerY + 0.12}
                  z={shrubZ}
                  scale={0.52 + index * 0.06 + shrubIndex * 0.05}
                  tone={index * 3 + shrubIndex}
                />
              );
            })}
          </group>
        );
      })}
      <mesh
        position={[faceX, topY + 0.035, faceZ]}
        rotation={[0, axes.rotationY, 0]}
        receiveShadow
      >
        <boxGeometry args={[baseWidth + 0.2, 0.08, 0.5]} />
        <meshStandardMaterial color="#c3bdb1" roughness={0.95} />
      </mesh>
    </group>
  );
}

function componentSetbackMeters(value: string | undefined) {
  if (value === "deep") return 1.7;
  if (value === "moderate") return 1.05;
  if (value === "slight") return 0.5;
  return 0;
}

function facadeComponentColor(color?: string, material?: string) {
  return mapColor([color ?? "", material ?? ""].filter(Boolean), COLORS.warmWhite);
}

function BalconyRail({ width, depth }: { width: number; depth: number }) {
  const railHeight = 0.92;
  const posts = Math.max(3, Math.round(width / 1.2));
  return (
    <group>
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.12, depth]} />
        <meshStandardMaterial color="#8d735b" roughness={0.86} />
      </mesh>
      <mesh position={[0, railHeight, depth / 2 - 0.035]} castShadow>
        <boxGeometry args={[width, 0.055, 0.055]} />
        <meshStandardMaterial color="#242b2d" roughness={0.62} metalness={0.18} />
      </mesh>
      {Array.from({ length: posts + 1 }).map((_, index) => {
        const x = -width / 2 + width * (index / posts);
        return (
          <mesh key={`rail-post-${index}`} position={[x, railHeight / 2, depth / 2 - 0.035]} castShadow>
            <boxGeometry args={[0.045, railHeight, 0.045]} />
            <meshStandardMaterial color="#242b2d" roughness={0.62} metalness={0.18} />
          </mesh>
        );
      })}
    </group>
  );
}

function EvidenceSiteFront({
  building,
  model,
  axes,
  houseBaseY,
}: {
  building: BuildingFeature;
  model: SemanticSiteModel;
  axes: ReturnType<typeof targetMassingAxes>;
  houseBaseY: number;
}) {
  if (!model.site.retainingWalls.value && !model.site.stairs.value) return null;
  const parcel = model.geometry.parcel?.polygon ?? building.polygon;
  const projectedParcel = parcel.map((position) => {
    const [x, z] = localMeters(position, model.center);
    const dx = x - axes.cx;
    const dz = z - axes.cz;
    return { t: dx * axes.tx + dz * axes.tz, n: dx * axes.nx + dz * axes.nz };
  });
  const parcelMinT = Math.min(...projectedParcel.map((point) => point.t));
  const parcelMaxT = Math.max(...projectedParcel.map((point) => point.t));
  const parcelMaxN = Math.max(...projectedParcel.map((point) => point.n));
  const wallMinT = Math.max(parcelMinT, axes.minT - 1.4);
  const wallMaxT = Math.min(parcelMaxT, axes.maxT + 2.2);
  const wallWidth = Math.max(6, wallMaxT - wallMinT);
  const wallT = (wallMinT + wallMaxT) / 2;
  const wallN = Math.max(axes.maxN + 0.8, parcelMaxN - 0.2);
  const wallX = axes.cx + axes.tx * wallT + axes.nx * wallN;
  const wallZ = axes.cz + axes.tz * wallT + axes.nz * wallN;
  const wallGroundY = terrainHeightAtLocal(model, wallX, wallZ);
  const wallTopY = Math.min(houseBaseY - 0.35, wallGroundY + 2.15);
  const wallHeight = Math.max(0.75, wallTopY - wallGroundY);
  const frontFacade = model.facades.find((facade) => facade.wall === "front");
  const door = [...(frontFacade?.doors ?? [])].sort((a, b) => b.confidence - a.confidence)[0];
  const stairT = axes.minT + (door?.x ?? 0.62) * axes.width;
  const stairStartN = wallN - 0.25;
  const stairEndN = axes.maxN + 0.35;
  const stairLength = Math.max(1.4, stairStartN - stairEndN);
  const stepCount = 9;
  const stepWidth = 1.15;

  return (
    <group>
      {model.site.retainingWalls.value ? (
        <group>
          <mesh position={[wallX, wallGroundY + wallHeight / 2, wallZ]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
            <boxGeometry args={[wallWidth, wallHeight, 0.28]} />
            <meshStandardMaterial color="#aaa59b" roughness={0.98} />
          </mesh>
          <mesh position={[wallX, wallTopY + 0.055, wallZ]} rotation={[0, axes.rotationY, 0]} receiveShadow>
            <boxGeometry args={[wallWidth + 0.08, 0.11, 0.38]} />
            <meshStandardMaterial color="#c1bbb0" roughness={0.96} />
          </mesh>
        </group>
      ) : null}
      {model.site.stairs.value ? Array.from({ length: stepCount }).map((_, index) => {
        const fraction = index / Math.max(1, stepCount - 1);
        const n = stairStartN + (stairEndN - stairStartN) * fraction;
        const x = axes.cx + axes.tx * stairT + axes.nx * n;
        const z = axes.cz + axes.tz * stairT + axes.nz * n;
        const y = terrainHeightAtLocal(model, x, z) + 0.09 + index * 0.035;
        return (
          <group key={`site-step-${index}`}>
            <mesh position={[x, y, z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
              <boxGeometry args={[stepWidth, 0.16, stairLength / stepCount + 0.08]} />
              <meshStandardMaterial color="#b8b3a8" roughness={0.98} />
            </mesh>
            <mesh position={[x + axes.tx * stepWidth * 0.52, y + 0.58, z]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 1.16, 8]} />
              <meshStandardMaterial color="#252c2e" roughness={0.65} metalness={0.16} />
            </mesh>
          </group>
        );
      }) : null}
    </group>
  );
}

function EvidenceWindow({ width, height }: { width: number; height: number }) {
  return (
    <group>
      <mesh castShadow><boxGeometry args={[width + 0.1, height + 0.1, 0.07]} /><meshStandardMaterial color="#222b2e" roughness={0.46} /></mesh>
      <mesh position={[0, 0, 0.043]}><planeGeometry args={[width, height]} /><meshPhysicalMaterial color={COLORS.glass} roughness={0.08} metalness={0.04} clearcoat={0.75} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

function ComponentFacadeEvidence({ component, axes }: { component: {
  width: number;
  height: number;
  bottomY: number;
  topY: number;
  frontN: number;
  centerT: number;
  kind: string;
  windowCount?: number;
  windowOrientation?: "vertical" | "horizontal" | "mixed" | "unknown";
  glazing?: "low" | "medium" | "high" | "unknown";
  hasDoor?: boolean;
  deckLocation?: "mid" | "roof" | "unknown";
  railColor?: string;
  accentColor?: string;
  accentMaterial?: string;
}; axes: ReturnType<typeof targetMassingAxes> }) {
  const frontX = axes.cx + axes.tx * component.centerT + axes.nx * (component.frontN + 0.075);
  const frontZ = axes.cz + axes.tz * component.centerT + axes.nz * (component.frontN + 0.075);
  const count = Math.max(0, Math.min(8, component.windowCount ?? (component.glazing === "high" ? 3 : 0)));
  const windows: Array<{ x: number; y: number; width: number; height: number }> = [];
  if (count > 0) {
    if (component.kind === "tower" && component.windowOrientation === "vertical") {
      const windowWidth = Math.max(0.42, component.width * 0.24);
      const windowHeight = Math.max(0.72, component.height * Math.min(0.23, 0.72 / count));
      const usable = component.height * 0.72;
      for (let index = 0; index < count; index += 1) {
        windows.push({
          x: 0,
          y: component.height * 0.16 + usable * ((index + 0.5) / count),
          width: windowWidth,
          height: windowHeight,
        });
      }
    } else if (component.glazing === "high") {
      const panelCount = Math.max(2, Math.min(4, count));
      const gap = 0.12;
      const totalWidth = component.width * 0.78;
      const panelWidth = Math.max(0.5, (totalWidth - gap * (panelCount - 1)) / panelCount);
      for (let index = 0; index < panelCount; index += 1) {
        windows.push({
          x: -totalWidth / 2 + panelWidth / 2 + index * (panelWidth + gap),
          y: component.height * 0.61,
          width: panelWidth,
          height: Math.max(1.1, component.height * 0.32),
        });
      }
    } else {
      const shapeHorizontal = component.windowOrientation === "horizontal";
      const windowWidth = Math.max(0.55, component.width * (shapeHorizontal ? 0.3 : 0.18));
      const windowHeight = Math.max(0.55, component.height * (shapeHorizontal ? 0.1 : 0.2));
      const spacing = component.width / Math.max(2, count + 1);
      for (let index = 0; index < count; index += 1) {
        windows.push({
          x: (index - (count - 1) / 2) * spacing,
          y: component.height * 0.68,
          width: windowWidth,
          height: windowHeight,
        });
      }
    }
  }
  const accent = mapColor([component.accentColor ?? "", component.accentMaterial ?? ""], COLORS.wood);
  const rail = mapColor([component.railColor ?? "dark metal"], COLORS.charcoal);
  return (
    <group position={[frontX, component.bottomY, frontZ]} rotation={[0, axes.rotationY, 0]}>
      {windows.map((window, index) => (
        <group key={`evidence-window-${index}`} position={[window.x, window.y, 0]}>
          <EvidenceWindow width={window.width} height={window.height} />
        </group>
      ))}
      {component.hasDoor ? (
        <group position={[-component.width * 0.23, Math.min(1.15, component.height * 0.2), 0.01]}>
          <mesh castShadow><boxGeometry args={[1.12, 2.3, 0.08]} /><meshStandardMaterial color="#263033" roughness={0.52} /></mesh>
          <mesh position={[0, 0, 0.05]}><planeGeometry args={[1.0, 2.18]} /><meshStandardMaterial color={COLORS.wood} roughness={0.76} side={THREE.DoubleSide} /></mesh>
        </group>
      ) : null}
      {component.accentMaterial?.toLowerCase().includes("wood") ? (
        <mesh position={[0, component.height * 0.88, 0.035]} castShadow>
          <boxGeometry args={[component.width * 0.92, Math.max(0.16, component.height * 0.055), 0.12]} />
          <meshStandardMaterial color={accent} roughness={0.78} />
        </mesh>
      ) : null}
      {component.deckLocation === "mid" ? (
        <group position={[0, component.height * 0.55, 0.7]}>
          <BalconyRail width={component.width * 0.94} depth={1.35} />
        </group>
      ) : null}
      {component.deckLocation === "roof" ? (
        <group position={[0, component.height + 0.02, 0.5]}>
          <mesh position={[0, 0.78, 0]} castShadow><boxGeometry args={[component.width * 0.94, 0.045, 0.045]} /><meshStandardMaterial color={rail} roughness={0.55} metalness={0.2} /></mesh>
          {Array.from({ length: Math.max(3, Math.round(component.width / 1.4)) + 1 }).map((_, index, list) => {
            const x = -component.width * 0.47 + component.width * 0.94 * (index / Math.max(1, list.length - 1));
            return <mesh key={`roof-rail-${index}`} position={[x, 0.39, 0]} castShadow><boxGeometry args={[0.04, 0.78, 0.04]} /><meshStandardMaterial color={rail} roughness={0.55} metalness={0.2} /></mesh>;
          })}
        </group>
      ) : null}
    </group>
  );
}

function ComposedFacadeBuilding({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  const composition = model.facadeComposition;
  if (!composition?.components.length) return null;
  const axes = targetMassingAxes(building, model);
  const totalHeight = renderedBuildingHeightM(building, 8.8);
  const topY = buildingTopY(building, model);
  const baseY = topY - totalHeight;
  const front = model.facades.find((facade) => facade.wall === "front");

  const components = composition.components
    .filter((component) => component.confidence >= 0.35 && component.top > component.bottom)
    .map((component) => {
      const width = Math.max(0.75, axes.width * Math.min(1, component.width));
      const depth = Math.max(1.1, axes.depth * Math.max(0.22, Math.min(1, component.depthFraction ?? 0.62)));
      const centerT = Math.max(axes.minT + width / 2, Math.min(axes.maxT - width / 2, axes.minT + component.x * axes.width));
      const frontN = axes.maxN - componentSetbackMeters(component.setback);
      const centerN = frontN - depth / 2;
      const bottomY = baseY + component.bottom * totalHeight;
      const componentTopY = baseY + component.top * totalHeight;
      const height = Math.max(0.35, componentTopY - bottomY);
      return {
        ...component,
        width,
        depth,
        centerT,
        centerN,
        frontN,
        height,
        bottomY,
        topY: componentTopY,
        x: axes.cx + axes.tx * centerT + axes.nx * centerN,
        z: axes.cz + axes.tz * centerT + axes.nz * centerN,
      };
    });

  const hasComponentOpenings = components.some((component) => component.windowCount != null || component.hasDoor != null || component.glazing && component.glazing !== "unknown");

  const facadePoint = (openingX: number, openingY: number) => {
    const t = axes.minT + openingX * axes.width;
    const y = baseY + openingY * totalHeight;
    const matching = components
      .filter((component) => component.kind !== "balcony" && t >= component.centerT - component.width / 2 - 0.15 && t <= component.centerT + component.width / 2 + 0.15 && y >= component.bottomY - 0.4 && y <= component.topY + 0.4)
      .sort((a, b) => b.confidence - a.confidence)[0];
    const frontN = matching?.frontN ?? axes.maxN;
    return {
      x: axes.cx + axes.tx * t + axes.nx * (frontN + 0.065),
      z: axes.cz + axes.tz * t + axes.nz * (frontN + 0.065),
    };
  };

  return (
    <group>
      <EvidenceSiteFront building={building} model={model} axes={axes} houseBaseY={baseY} />
      {components.map((component, index) => {
        if (component.kind === "balcony") {
          return (
            <group
              key={`facade-component-${index}`}
              position={[component.x + axes.nx * (component.depth * 0.35), component.bottomY, component.z + axes.nz * (component.depth * 0.35)]}
              rotation={[0, axes.rotationY, 0]}
            >
              <BalconyRail width={component.width} depth={Math.max(0.85, Math.min(2.4, component.depth * 0.42))} />
            </group>
          );
        }
        const wallColor = facadeComponentColor(component.color, component.material);
        return (
          <group key={`facade-component-${index}`}>
            <mesh position={[component.x, component.bottomY + component.height / 2, component.z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
              <boxGeometry args={[component.width, component.height, component.depth]} />
              <meshPhysicalMaterial color={wallColor} roughness={component.material?.toLowerCase().includes("glass") ? 0.2 : 0.78} metalness={0} clearcoat={0.03} />
            </mesh>
            <mesh position={[component.x, component.topY + 0.045, component.z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
              <boxGeometry args={[component.width + 0.08, 0.09, component.depth + 0.08]} />
              <meshStandardMaterial color={component.kind === "tower" ? "#7d8585" : COLORS.roof} roughness={0.88} />
            </mesh>
            <ComponentFacadeEvidence component={component} axes={axes} />
          </group>
        );
      })}
      {!hasComponentOpenings ? (front?.windows ?? []).filter((window) => window.confidence >= 0.25).map((window, index) => {
        const point = facadePoint(window.x, window.y);
        const width = Math.max(0.48, axes.width * Math.min(0.34, window.width));
        const height = Math.max(0.58, totalHeight * Math.min(0.38, window.height));
        const y = baseY + Math.max(height / 2 + 0.3, window.y * totalHeight);
        return (
          <group key={`composed-window-${index}`} position={[point.x, y, point.z]} rotation={[0, axes.rotationY, 0]}>
            <mesh castShadow><boxGeometry args={[width + 0.12, height + 0.12, 0.07]} /><meshStandardMaterial color="#242b2d" roughness={0.48} /></mesh>
            <mesh position={[0, 0, 0.043]}><planeGeometry args={[width, height]} /><meshPhysicalMaterial color="#315f73" roughness={0.08} metalness={0.04} clearcoat={0.7} side={THREE.DoubleSide} /></mesh>
          </group>
        );
      }) : null}
      {!hasComponentOpenings ? (front?.doors ?? []).filter((door) => door.confidence >= 0.2).map((door, index) => {
        const point = facadePoint(door.x, Math.max(0.05, door.y));
        const width = Math.max(0.9, axes.width * Math.min(0.22, door.width));
        const height = Math.max(2.05, Math.min(2.8, totalHeight * door.height));
        return (
          <group key={`composed-door-${index}`} position={[point.x, baseY + height / 2 + 0.06, point.z]} rotation={[0, axes.rotationY, 0]}>
            <mesh><boxGeometry args={[width + 0.12, height + 0.12, 0.07]} /><meshStandardMaterial color="#252d2f" roughness={0.5} /></mesh>
            <mesh position={[0, 0, 0.043]}><planeGeometry args={[width, height]} /><meshStandardMaterial color={mapColor([door.material ?? door.color ?? "wood"], COLORS.wood)} roughness={0.72} side={THREE.DoubleSide} /></mesh>
          </group>
        );
      }) : null}
    </group>
  );
}

function StylizedMassingBuilding({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  const massing = model.massing;
  if (!massing?.volumes.length) return null;
  const axes = targetMassingAxes(building, model);
  const totalHeight = renderedBuildingHeightM(building, (model.storiesApprox?.value ?? 2) * 3.1);
  const levels = Math.max(massing.storiesVisible ?? 0, ...massing.volumes.map((volume) => volume.level + 1), 1);
  const storyHeight = Math.max(2.7, Math.min(3.1, totalHeight / levels));
  const visibleHeight = Math.min(totalHeight, storyHeight * levels);
  const topY = buildingTopY(building, model);
  const visibleBaseY = topY - visibleHeight;
  const front = model.facades.find((facade) => facade.wall === "front");
  const fusedWallColor = mapColor(front?.colors.value ?? ["white"], COLORS.warmWhite);
  const volumes = massing.volumes;

  const volumeLayout = volumes.map((volume) => {
    const width = Math.max(4.2, axes.width * Math.max(0.42, Math.min(1, volume.widthFraction)));
    const depth = Math.max(4.0, axes.depth * Math.max(0.45, Math.min(1, volume.depthFraction ?? (0.9 - volume.level * 0.05))));
    const desiredCenterT = axes.minT + Math.max(0, Math.min(1, volume.horizontalCenter)) * axes.width;
    const centerT = Math.max(axes.minT + width / 2, Math.min(axes.maxT - width / 2, desiredCenterT));
    const frontN = axes.maxN - setbackMeters(volume.setback, volume.level);
    const centerN = frontN - depth / 2;
    return {
      ...volume, width, depth, frontN, centerN, centerT,
      x: axes.cx + axes.tx * centerT + axes.nx * centerN,
      z: axes.cz + axes.tz * centerT + axes.nz * centerN,
      y: visibleBaseY + storyHeight * (volume.level + 0.5),
    };
  }).sort((a, b) => a.level - b.level);

  const layoutForY = (normalizedY: number) => {
    const level = Math.max(0, Math.min(levels - 1, Math.floor(Math.max(0, Math.min(0.999, normalizedY)) * levels)));
    return volumeLayout.find((volume) => volume.level === level) ?? volumeLayout[Math.min(level, volumeLayout.length - 1)]!;
  };
  const pointOnFront = (normalizedX: number, layout: (typeof volumeLayout)[number]) => {
    const t = layout.centerT + (normalizedX - 0.5) * layout.width;
    return {
      x: axes.cx + axes.tx * t + axes.nx * (layout.frontN + 0.055),
      z: axes.cz + axes.tz * t + axes.nz * (layout.frontN + 0.055),
    };
  };

  const doors = front?.doors ?? [];
  const windows = (front?.windows ?? []).filter((window) => !doors.some((door) => Math.abs(window.x - door.x) < 0.14 && Math.abs(window.y - door.y) < 0.18));

  const lowestLayout = volumeLayout[0]!;

  return (
    <group>
      <HillsidePodium model={model} axes={axes} layout={lowestLayout} topY={visibleBaseY} />
      {volumeLayout.map((volume, index) => {
        const wallColor = fusedWallColor;
        return (
          <group key={`massing-${volume.level}`}>
            <mesh position={[volume.x, volume.y, volume.z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
              <boxGeometry args={[volume.width, storyHeight - 0.08, volume.depth]} />
              <meshPhysicalMaterial color={wallColor} roughness={0.76} metalness={0} clearcoat={0.04} clearcoatRoughness={0.9} />
            </mesh>
            {index > 0 ? (
              <group>
              <mesh position={[volume.x + axes.nx * 0.12, visibleBaseY + storyHeight * volume.level + 0.035, volume.z + axes.nz * 0.12]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
                <boxGeometry args={[volume.width + 0.35, 0.07, volume.depth + 0.25]} />
                <meshStandardMaterial color={COLORS.concrete} roughness={0.88} />
              </mesh>
              <mesh position={[volume.x + axes.nx * 0.18, visibleBaseY + storyHeight * volume.level - 0.035, volume.z + axes.nz * 0.18]} rotation={[0, axes.rotationY, 0]}>
                <boxGeometry args={[volume.width - 0.22, 0.055, Math.max(0.12, volume.depth - 0.2)]} />
                <meshStandardMaterial color="#8d8b84" roughness={0.92} />
              </mesh>
              </group>
            ) : null}
          </group>
        );
      })}

      {windows.map((window, index) => {
        const layout = layoutForY(window.y);
        const point = pointOnFront(window.x, layout);
        const width = Math.max(0.85, axes.width * Math.min(0.32, window.width));
        const height = Math.max(0.85, visibleHeight * Math.min(0.28, window.height));
        const y = visibleBaseY + Math.max(height / 2 + 0.32, window.y * visibleHeight);
        return (
          <group key={`massing-window-${index}`} position={[point.x, y, point.z]} rotation={[0, axes.rotationY, 0]}>
            <mesh castShadow><boxGeometry args={[width + 0.18, height + 0.18, 0.09]} /><meshStandardMaterial color="#243137" roughness={0.5} /></mesh>
            <mesh position={[0, 0, 0.052]}><planeGeometry args={[width, height]} /><meshPhysicalMaterial color={COLORS.glass} roughness={0.08} metalness={0.08} clearcoat={1} clearcoatRoughness={0.08} side={THREE.DoubleSide} /></mesh>
            <mesh position={[0, 0, 0.058]}><planeGeometry args={[Math.max(0.035, width * 0.022), height]} /><meshStandardMaterial color={COLORS.glassHighlight} roughness={0.16} transparent opacity={0.5} /></mesh>
            <mesh position={[0, 0, 0.059]}><planeGeometry args={[width, Math.max(0.025, height * 0.018)]} /><meshStandardMaterial color="#25343a" roughness={0.35} transparent opacity={0.72} /></mesh>
          </group>
        );
      })}

      {doors.map((door, index) => {
        const layout = layoutForY(Math.max(0.02, door.y));
        const point = pointOnFront(door.x, layout);
        const width = Math.max(0.95, axes.width * Math.min(0.18, door.width));
        const height = Math.max(2.05, Math.min(2.65, totalHeight * door.height));
        return (
          <group key={`massing-door-${index}`}>
            <group position={[point.x, visibleBaseY + height / 2 + 0.08, point.z]} rotation={[0, axes.rotationY, 0]}>
              <mesh castShadow><boxGeometry args={[width + 0.16, height + 0.16, 0.08]} /><meshStandardMaterial color="#313b3e" roughness={0.52} /></mesh>
              <mesh position={[0, 0, 0.052]}><planeGeometry args={[width, height]} /><meshStandardMaterial color={COLORS.wood} roughness={0.74} side={THREE.DoubleSide} /></mesh>
              <mesh position={[width * 0.31, -0.04, 0.066]}>
                <circleGeometry args={[0.055, 14]} />
                <meshStandardMaterial color="#263337" roughness={0.35} metalness={0.32} side={THREE.DoubleSide} />
              </mesh>
            </group>
            <mesh
              position={[point.x + axes.nx * 0.58, visibleBaseY + 0.08, point.z + axes.nz * 0.58]}
              rotation={[0, axes.rotationY, 0]}
              receiveShadow
              castShadow
            >
              <boxGeometry args={[width + 0.85, 0.14, 1.05]} />
              <meshStandardMaterial color="#b6b1a6" roughness={0.98} />
            </mesh>
          </group>
        );
      })}

      {(() => {
        const top = volumeLayout.at(-1)!;
        return (
          <mesh position={[top.x, topY + 0.16, top.z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
            <boxGeometry args={[top.width + 0.12, 0.32, top.depth + 0.12]} />
            <meshStandardMaterial color={COLORS.roof} roughness={0.84} />
          </mesh>
        );
      })()}
    </group>
  );
}

function BuildingMass({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  if (model.facadeComposition?.components.length) return <ComposedFacadeBuilding building={building} model={model} />;
  if (model.massing?.volumes.length) return <StylizedMassingBuilding building={building} model={model} />;
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const height = renderedBuildingHeightM(building, (model.storiesApprox?.value ?? 2) * 3.1);
  const front = model.facades.find((facade) => facade.wall === "front");
  const side = model.facades.find((facade) => facade.wall === "left");
  const wallColor = mapColor(front?.colors.value ?? ["white"], COLORS.warmWhite);

  const baseY = buildingBaseY(building, model);

  return (
    <group position={[0, baseY, 0]}>
      <mesh castShadow receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: height, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 2 }]} />
        <meshPhysicalMaterial color={wallColor} roughness={0.76} metalness={0} clearcoat={0.04} clearcoatRoughness={0.9} />
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

function AlignedFrontOpenings({
  building,
  model,
  facade,
  height,
}: {
  building: BuildingFeature;
  model: SemanticSiteModel;
  facade: SemanticFacade;
  height: number;
}) {
  const alignment = model.facadeAlignment;
  if (!alignment) return null;
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const aPosition = ring[alignment.frontEdgeIndex];
  const bPosition = ring[(alignment.frontEdgeIndex + 1) % ring.length];
  if (!aPosition || !bPosition) return null;

  const [ax, az] = localMeters(aPosition, model.center);
  const [bx, bz] = localMeters(bPosition, model.center);
  const dx = bx - ax;
  const dz = bz - az;
  const edgeLength = Math.hypot(dx, dz);
  if (edgeLength < 0.5) return null;
  const midpointX = (ax + bx) / 2;
  const midpointZ = (az + bz) / 2;
  const sourceImage = model.imagery.find((image) => image.id === alignment.sourceImageId) ?? model.imagery[0];
  const [cameraX, cameraZ] = sourceImage
    ? localMeters([sourceImage.longitude, sourceImage.latitude], model.center)
    : [midpointX, midpointZ + 10];
  const forwardX = midpointX - cameraX;
  const forwardZ = midpointZ - cameraZ;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const imageXIncreasesAToB = dx * rightX + dz * rightZ >= 0;
  const cameraDistance = Math.max(0.001, Math.hypot(cameraX - midpointX, cameraZ - midpointZ));
  const offsetX = ((cameraX - midpointX) / cameraDistance) * 0.045;
  const offsetZ = ((cameraZ - midpointZ) / cameraDistance) * 0.045;
  const rotationY = -Math.atan2(dz, dx);

  const atOpening = (opening: SemanticFacade["windows"][number]) => {
    const t = imageXIncreasesAToB ? opening.x : 1 - opening.x;
    return {
      x: ax + dx * t + offsetX,
      z: az + dz * t + offsetZ,
      width: Math.max(0.65, edgeLength * opening.width),
      height: Math.max(0.65, height * opening.height),
    };
  };

  return (
    <group>
      {facade.windows.map((window, index) => {
        const position = atOpening(window);
        const y = Math.max(position.height / 2 + 0.35, window.y * height);
        return (
          <group key={`aligned-window-${index}`} position={[position.x, y, position.z]} rotation={[0, rotationY, 0]}>
            <mesh>
              <planeGeometry args={[position.width + 0.12, position.height + 0.12]} />
              <meshStandardMaterial color="#29343a" roughness={0.48} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, 0.012]}>
              <planeGeometry args={[position.width, position.height]} />
              <meshPhysicalMaterial color={COLORS.glass} roughness={0.12} metalness={0.05} clearcoat={0.45} clearcoatRoughness={0.16} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
      {facade.doors.map((door, index) => {
        const position = atOpening(door);
        const doorHeight = Math.max(1.9, height * door.height);
        return (
          <group key={`aligned-door-${index}`} position={[position.x, doorHeight / 2, position.z]} rotation={[0, rotationY, 0]}>
            <mesh>
              <planeGeometry args={[Math.max(0.9, position.width) + 0.12, doorHeight + 0.12]} />
              <meshStandardMaterial color={COLORS.charcoal} roughness={0.62} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, 0.012]}>
              <planeGeometry args={[Math.max(0.9, position.width), doorHeight]} />
              <meshStandardMaterial color={mapColor([door.material ?? door.color ?? "wood"], COLORS.wood)} roughness={0.75} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
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
  if (side === "front" && model.facadeAlignment) {
    return <AlignedFrontOpenings building={building} model={model} facade={facade} height={height} />;
  }
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
          <meshStandardMaterial color={mapColor([door.material ?? door.color ?? "wood"], COLORS.wood)} roughness={0.75} side={THREE.DoubleSide} />
        </mesh>,
      );
    }
  });

  return <group>{elements}</group>;
}

function ribbonGeometry(points: Position[], model: SemanticSiteModel, widthM: number, yOffset: number) {
  if (points.length < 2) return undefined;
  const local = points.map((point) => {
    const [x, z] = localMeters(point, model.center);
    return { x, z, y: terrainHeightAtPosition(model, point) + yOffset };
  });
  const vertices: number[] = [];
  for (let index = 0; index < local.length; index += 1) {
    const current = local[index]!;
    const previous = local[Math.max(0, index - 1)]!;
    const next = local[Math.min(local.length - 1, index + 1)]!;
    let dx = next.x - previous.x;
    let dz = next.z - previous.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    dx /= length;
    dz /= length;
    const nx = -dz * widthM * 0.5;
    const nz = dx * widthM * 0.5;
    vertices.push(current.x + nx, current.y, current.z + nz, current.x - nx, current.y, current.z - nz);
  }
  const indices: number[] = [];
  for (let index = 0; index < local.length - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function localTerrainStripGeometry(
  model: SemanticSiteModel,
  centerX: number,
  centerZ: number,
  tangentX: number,
  tangentZ: number,
  widthM: number,
  lengthM: number,
  yOffset: number,
  normalOffsetM = 0,
) {
  const normalX = -tangentZ;
  const normalZ = tangentX;
  const segments = 18;
  const vertices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const along = -lengthM / 2 + lengthM * (index / segments);
    for (const side of [-1, 1]) {
      const across = normalOffsetM + side * widthM / 2;
      const x = centerX + tangentX * along + normalX * across;
      const z = centerZ + tangentZ * along + normalZ * across;
      vertices.push(x, terrainHeightAtLocal(model, x, z) + yOffset, z);
    }
  }
  const indices: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function LocalStreetApron({ model }: { model: SemanticSiteModel }) {
  const building = primaryBuilding(model);
  const alignment = model.facadeAlignment;
  const source = alignment ? model.imagery.find((image) => image.id === alignment.sourceImageId) : model.imagery[0];
  if (!building || !source || !alignment) return null;
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const a = ring[alignment.frontEdgeIndex];
  const b = ring[(alignment.frontEdgeIndex + 1) % ring.length];
  if (!a || !b) return null;
  const [ax, az] = localMeters(a, model.center);
  const [bx, bz] = localMeters(b, model.center);
  const edgeLength = Math.max(0.001, Math.hypot(bx - ax, bz - az));
  const tx = (bx - ax) / edgeLength;
  const tz = (bz - az) / edgeLength;
  const [sx, sz] = localMeters([source.longitude, source.latitude], model.center);
  const centroid = polygonCentroid(building.polygon);
  const [cx, cz] = localMeters([centroid.longitude, centroid.latitude], model.center);
  const toHouseX = cx - sx;
  const toHouseZ = cz - sz;
  const normalSign = (-tz * toHouseX + tx * toHouseZ) >= 0 ? 1 : -1;

  const roadWidth = 6.0;
  const sidewalkWidth = 1.5;
  const length = 34;
  const towardHouseOffset = normalSign * (roadWidth / 2 + sidewalkWidth / 2 + 0.22);
  const curbOffset = normalSign * (roadWidth / 2 + 0.06);
  const roadGeometry = localTerrainStripGeometry(model, sx, sz, tx, tz, roadWidth, length, 0.16);
  const sidewalkGeometry = localTerrainStripGeometry(model, sx, sz, tx, tz, sidewalkWidth, length * 0.9, 0.21, towardHouseOffset);
  const curbGeometry = localTerrainStripGeometry(model, sx, sz, tx, tz, 0.18, length * 0.92, 0.23, curbOffset);
  const farEdgeGeometry = localTerrainStripGeometry(model, sx, sz, tx, tz, 0.12, length * 0.88, 0.2, -normalSign * (roadWidth / 2 - 0.12));
  return (
    <group>
      <mesh geometry={roadGeometry} receiveShadow>
        <meshStandardMaterial color="#414b4e" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={farEdgeGeometry} receiveShadow>
        <meshStandardMaterial color="#768080" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={curbGeometry} receiveShadow>
        <meshStandardMaterial color="#aaa79c" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={sidewalkGeometry} receiveShadow>
        <meshStandardMaterial color={COLORS.sidewalk} roughness={0.98} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function StreetContext({ model }: { model: SemanticSiteModel }) {
  return (
    <group>
      {model.geometry.roads.map((road) => {
        const geometry = ribbonGeometry(road.points, model, Math.max(4.8, road.widthM ?? 6.2), 0.09);
        if (!geometry) return null;
        return (
          <mesh key={road.id} geometry={geometry} receiveShadow>
            <meshStandardMaterial color={COLORS.road} roughness={0.98} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
      {model.geometry.sidewalks.map((sidewalk) => {
        const geometry = ribbonGeometry(sidewalk.points, model, 1.55, 0.12);
        if (!geometry) return null;
        return (
          <mesh key={sidewalk.id} geometry={geometry} receiveShadow>
            <meshStandardMaterial color={COLORS.sidewalk} roughness={0.94} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

function LowPolyTree({ x, y, z, scale, tone }: { x: number; y: number; z: number; scale: number; tone: number }) {
  const canopy = tone % 3 === 0 ? COLORS.treeLight : tone % 3 === 1 ? COLORS.tree : COLORS.treeDark;
  const second = tone % 2 ? COLORS.treeDark : COLORS.treeLight;
  const twist = ((tone * 47) % 360) * Math.PI / 180;
  const tall = tone % 5 === 0;
  return (
    <group position={[x, y, z]} scale={scale} rotation={[0, twist, 0]}>
      <mesh position={[0, tall ? 1.7 : 1.35, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.22, tall ? 3.4 : 2.7, 8]} />
        <meshStandardMaterial color="#70523b" roughness={1} />
      </mesh>
      <mesh position={[0.32, tall ? 2.5 : 2.05, 0]} rotation={[0, 0, -0.55]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 1.7, 7]} />
        <meshStandardMaterial color="#70523b" roughness={1} />
      </mesh>
      <mesh position={[-0.3, tall ? 2.55 : 2.1, 0.12]} rotation={[0.35, 0, 0.5]} castShadow>
        <cylinderGeometry args={[0.06, 0.1, 1.45, 7]} />
        <meshStandardMaterial color="#70523b" roughness={1} />
      </mesh>
      <mesh position={[0, tall ? 4.25 : 3.35, 0]} scale={[1.2, tall ? 1.35 : 0.95, 1]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1.25, 0]} />
        <meshStandardMaterial color={canopy} roughness={0.98} flatShading />
      </mesh>
      <mesh position={[0.92, tall ? 4.1 : 3.45, -0.18]} scale={[0.95, 0.86, 0.92]} castShadow>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color={second} roughness={0.98} flatShading />
      </mesh>
      <mesh position={[-0.78, tall ? 4.0 : 3.15, 0.32]} scale={[0.88, 0.78, 0.95]} castShadow>
        <dodecahedronGeometry args={[0.88, 0]} />
        <meshStandardMaterial color={tone % 3 === 1 ? COLORS.treeLight : COLORS.tree} roughness={0.98} flatShading />
      </mesh>
      <mesh position={[0.2, tall ? 5.0 : 4.05, 0.18]} scale={[0.72, 0.75, 0.7]} castShadow>
        <dodecahedronGeometry args={[0.72, 0]} />
        <meshStandardMaterial color={COLORS.treeLight} roughness={0.98} flatShading />
      </mesh>
    </group>
  );
}

function LowPolyShrub({ x, y, z, scale, tone }: { x: number; y: number; z: number; scale: number; tone: number }) {
  const colors = ["#557c46", "#6f9254", "#86a667", "#496e43"];
  const color = colors[tone % colors.length]!;
  return (
    <group position={[x, y + 0.22, z]} scale={scale} rotation={[0, ((tone * 31) % 360) * Math.PI / 180, 0]}>
      <mesh castShadow receiveShadow scale={[1.25, 0.72, 1]}>
        <dodecahedronGeometry args={[0.62, 0]} />
        <meshStandardMaterial color={color} roughness={1} flatShading />
      </mesh>
      {tone % 3 === 0 ? (
        <mesh position={[0.52, 0.08, -0.16]} castShadow scale={[0.72, 0.55, 0.68]}>
          <dodecahedronGeometry args={[0.48, 0]} />
          <meshStandardMaterial color={COLORS.treeLight} roughness={1} flatShading />
        </mesh>
      ) : null}
    </group>
  );
}

function VegetationLayer({ model }: { model: SemanticSiteModel }) {
  const treeClusters = new Map<string, { x: number; z: number; count: number }>();
  const shrubClusters = new Map<string, { x: number; z: number; count: number; tall: boolean }>();
  for (const sample of model.geometry.groundCover) {
    const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    if (sample.className === "tree_canopy") {
      const cellSize = 7.5;
      const key = `${Math.round(x / cellSize)}|${Math.round(z / cellSize)}`;
      const existing = treeClusters.get(key);
      if (existing) { existing.x += x; existing.z += z; existing.count += 1; }
      else treeClusters.set(key, { x, z, count: 1 });
    } else if (sample.className === "grass_shrubs" || sample.className === "tall_shrubs") {
      const cellSize = sample.className === "tall_shrubs" ? 4.8 : 5.8;
      const key = `${Math.round(x / cellSize)}|${Math.round(z / cellSize)}|${sample.className}`;
      const existing = shrubClusters.get(key);
      if (existing) { existing.x += x; existing.z += z; existing.count += 1; }
      else shrubClusters.set(key, { x, z, count: 1, tall: sample.className === "tall_shrubs" });
    }
  }
  const target = primaryBuilding(model);
  const targetCenter = target ? polygonCentroid(target.polygon) : model.center;
  const [targetX, targetZ] = localMeters([targetCenter.longitude, targetCenter.latitude], model.center);
  const nearbyTrees = [...treeClusters.values()]
    .map((cluster) => ({ ...cluster, x: cluster.x / cluster.count, z: cluster.z / cluster.count }))
    .sort((a, b) => Math.hypot(a.x - targetX, a.z - targetZ) - Math.hypot(b.x - targetX, b.z - targetZ))
    .slice(0, 38);
  const nearbyShrubs = [...shrubClusters.values()]
    .map((cluster) => ({ ...cluster, x: cluster.x / cluster.count, z: cluster.z / cluster.count }))
    .filter((cluster) => Math.hypot(cluster.x - targetX, cluster.z - targetZ) < 48)
    .sort((a, b) => Math.hypot(a.x - targetX, a.z - targetZ) - Math.hypot(b.x - targetX, b.z - targetZ))
    .slice(0, 34);
  return (
    <group>
      {nearbyTrees.map((cluster, index) => {
        const y = terrainHeightAtLocal(model, cluster.x, cluster.z);
        const scale = 0.74 + ((index * 37) % 23) / 52;
        return <LowPolyTree key={`tree-${cluster.x.toFixed(1)}-${cluster.z.toFixed(1)}`} x={cluster.x} y={y} z={cluster.z} scale={scale} tone={index} />;
      })}
      {nearbyShrubs.map((cluster, index) => {
        const y = terrainHeightAtLocal(model, cluster.x, cluster.z);
        const scale = (cluster.tall ? 1.15 : 0.78) + ((index * 19) % 11) / 35;
        return <LowPolyShrub key={`shrub-${cluster.x.toFixed(1)}-${cluster.z.toFixed(1)}`} x={cluster.x} y={y} z={cluster.z} scale={scale} tone={index} />;
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


function SceneContents({ model, debug, view }: { model: SemanticSiteModel; debug: boolean; view: "facade" | "overview" }) {
  const orbitTarget = defaultCameraTarget(model);
  const primary = primaryBuilding(model);
  const primaryCenter = primary ? polygonCentroid(primary.polygon) : model.center;
  const contextBuildings = view === "facade" ? [] : model.geometry.buildings
    .filter((building) => building.id !== model.geometry.primaryBuildingId)
    .map((building) => ({ building, distance: haversineMeters(polygonCentroid(building.polygon), primaryCenter) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  return (
    <>
      <color attach="background" args={["#b9d8ea"]} />
      <fog attach="fog" args={["#c7ddea", 125, 245]} />
      <Sky sunPosition={[18, 16, -9]} turbidity={2.3} rayleigh={0.72} mieCoefficient={0.003} mieDirectionalG={0.76} />
      <hemisphereLight args={["#d9efff", "#967f66", 0.98]} />
      <ambientLight intensity={0.24} />
      <directionalLight color="#fff0d2" position={[28, 38, -18]} intensity={2.85} castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.00018}
        shadow-radius={3}
      />
      <directionalLight color="#b9d9f2" position={[-24, 18, 28]} intensity={0.56} />
      <ParcelGround model={model} debug={debug} />
      <StreetContext model={model} />
      <LocalStreetApron model={model} />
      {primary ? <BuildingMass building={primary} model={model} /> : null}
      {contextBuildings.map(({ building, distance }) => (
        <ContextBuilding key={building.id} building={building} model={model} subdued={view === "facade" || distance > 35} />
      ))}
      <VegetationLayer model={model} />
      {debug && model.geometry.terrain.length < 4 ? <gridHelper args={[90, 45, "#9fa8a4", "#cbd0cb"]} position={[0, -0.03, 0]} /> : null}
      <OrbitControls makeDefault target={orbitTarget} minDistance={9} maxDistance={115} maxPolarAngle={Math.PI * 0.48} enableDamping dampingFactor={0.06} />
    </>
  );
}

export function SiteTwinScene({ model, debug = false, className, view = "facade" }: SiteTwinSceneProps) {
  const cameraPosition = defaultCameraPosition(model, view);
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        key={view}
        shadows
        camera={{ position: cameraPosition, fov: view === "facade" ? 54 : 46, near: 0.1, far: 500 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; }}
      >
        <SceneContents model={model} debug={debug} view={view} />
      </Canvas>
    </div>
  );
}
