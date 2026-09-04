import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingFeature, GroundCoverClass, Position, SemanticFacade, SemanticSiteModel } from "@officeadmin-geo/site-twin-core";
import { localMeters, polygonCentroid, renderedBuildingHeightM } from "@officeadmin-geo/site-twin-core";

export interface SiteTwinSceneProps {
  model: SemanticSiteModel;
  debug?: boolean;
  className?: string;
  view?: "facade" | "overview";
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
  const horizontalDistance = Math.max(17, Math.min(23, distance));
  return [
    target[0] + (dx / distance) * horizontalDistance,
    target[1] + 5.2,
    target[2] + (dz / distance) * horizontalDistance,
  ];
}

function buildingTopY(building: BuildingFeature, model: SemanticSiteModel) {
  if (typeof building.roofElevationM === "number" && Number.isFinite(building.roofElevationM) && building.roofElevationM > 0) {
    return building.roofElevationM - terrainBaseElevation(model);
  }
  return buildingBaseY(building, model) + renderedBuildingHeightM(building, 6.2);
}

function terrainConformingWallGeometry(building: BuildingFeature, model: SemanticSiteModel) {
  const ring = building.polygon.length > 1 && building.polygon[0]?.[0] === building.polygon.at(-1)?.[0] && building.polygon[0]?.[1] === building.polygon.at(-1)?.[1]
    ? building.polygon.slice(0, -1)
    : building.polygon;
  const topY = buildingTopY(building, model);
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

function ContextBuilding({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  if ((building.roofElevationM ?? 0) <= 0 && (building.heightM ?? 0) <= 0) return null;
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const topY = buildingTopY(building, model);
  const wallGeometry = terrainConformingWallGeometry(building, model);
  return (
    <group>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#d1d0c8" roughness={0.94} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY + 0.025, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color="#b8b9b4" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function BuildingMass({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const height = renderedBuildingHeightM(building, (model.storiesApprox?.value ?? 2) * 3.1);
  const front = model.facades.find((facade) => facade.wall === "front");
  const side = model.facades.find((facade) => facade.wall === "left");
  const wallColor = mapColor([...(front?.colors.value ?? []), ...(side?.colors.value ?? [])]);

  const baseY = buildingBaseY(building, model);

  return (
    <group position={[0, baseY, 0]}>
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
              <meshStandardMaterial color={COLORS.charcoal} roughness={0.55} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, 0.012]}>
              <planeGeometry args={[position.width, position.height]} />
              <meshStandardMaterial color={COLORS.glass} roughness={0.18} metalness={0.16} side={THREE.DoubleSide} />
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
  const orbitTarget = defaultCameraTarget(model);
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
        building.id === model.geometry.primaryBuildingId
          ? <BuildingMass key={building.id} building={building} model={model} />
          : <ContextBuilding key={building.id} building={building} model={model} />
      ))}
      <SiteDetails model={model} />
      {debug && model.geometry.terrain.length < 4 ? <gridHelper args={[90, 45, "#9fa8a4", "#cbd0cb"]} position={[0, -0.03, 0]} /> : null}
      <OrbitControls makeDefault target={orbitTarget} minDistance={6} maxDistance={90} maxPolarAngle={Math.PI * 0.48} />
    </>
  );
}

export function SiteTwinScene({ model, debug = false, className, view = "facade" }: SiteTwinSceneProps) {
  const cameraPosition = defaultCameraPosition(model, view);
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas key={view} shadows camera={{ position: cameraPosition, fov: view === "facade" ? 38 : 44, near: 0.1, far: 500 }} dpr={[1, 2]}>
        <SceneContents model={model} debug={debug} />
      </Canvas>
    </div>
  );
}
