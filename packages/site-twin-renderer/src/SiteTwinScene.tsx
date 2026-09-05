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
  warmWhite: "#f2f0e8",
  warmWhiteShadow: "#deddd5",
  coolGray: "#c8cbc7",
  charcoal: "#344047",
  roof: "#62696a",
  wood: "#9a6742",
  glass: "#557b88",
  glassHighlight: "#9db6be",
  grass: "#9ab78a",
  grassLight: "#b7cba1",
  soil: "#b49778",
  road: "#62696a",
  roadEdge: "#858c8b",
  sidewalk: "#d6d2c5",
  concrete: "#b9b5aa",
  tree: "#6f9668",
  treeLight: "#89aa77",
  treeDark: "#557752",
  parcel: "#a9be96",
  debug: "#e36542",
} as const;

const GROUND_COVER_COLORS: Partial<Record<GroundCoverClass, string>> = {
  tree_canopy: "#83a475",
  grass_shrubs: "#a5bd90",
  tall_shrubs: "#92aa78",
  bare_soil: "#b79a79",
  water: "#85aab9",
  road_railroad: "#8f9694",
  other_paved: "#c8c4b9",
  building: "#a7b990",
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
  const latitudes = [...new Set(samples.map((sample) => sample.coordinate.latitude))].sort((a, b) => a - b);
  const longitudes = [...new Set(samples.map((sample) => sample.coordinate.longitude))].sort((a, b) => a - b);
  if (latitudes.length < 2 || longitudes.length < 2) return null;

  const lookup = new Map(samples.map((sample) => [`${sample.coordinate.latitude}|${sample.coordinate.longitude}`, sample]));
  const base = terrainBaseElevation(model);
  const cover = model.geometry.groundCover.map((sample) => {
    const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    return { x, z, className: sample.className };
  });
  const vertices: number[] = [];
  const colors: number[] = [];
  for (const latitude of latitudes) {
    for (const longitude of longitudes) {
      const sample = lookup.get(`${latitude}|${longitude}`);
      const [x, z] = localMeters([longitude, latitude], model.center);
      vertices.push(x, (sample?.elevationM ?? base) - base, z);
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
      colors.push(color.r, color.g, color.b);
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
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.96} metalness={0} side={THREE.DoubleSide} />
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
  if (model.massing?.storiesVisible) {
    const levels = Math.max(1, model.massing.storiesVisible);
    const storyHeight = Math.max(2.7, Math.min(3.1, height / levels));
    const visibleHeight = Math.min(height, storyHeight * levels);
    const topY = buildingTopY(building, model);
    return [x, topY - visibleHeight * 0.46, z];
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
  const horizontalDistance = Math.max(37, Math.min(44, distance * 1.55));
  return [
    target[0] + (dx / distance) * horizontalDistance,
    target[1] + 7.8,
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

function ContextBuilding({ building, model }: { building: BuildingFeature; model: SemanticSiteModel }) {
  if ((building.roofElevationM ?? 0) <= 0 && (building.heightM ?? 0) <= 0) return null;
  const { shape } = shapeFromPolygon(building.polygon, model.center);
  const topY = buildingTopY(building, model);
  const wallGeometry = terrainConformingWallGeometry(building, model);
  const palette = buildingPalette(building.id);
  return (
    <group>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color={palette.wall} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY + 0.025, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={palette.roof} roughness={0.88} side={THREE.DoubleSide} />
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
  const tx = (bx - ax) / edgeLength;
  const tz = (bz - az) / edgeLength;

  let nx = -tz;
  let nz = tx;
  const source = model.facadeAlignment
    ? model.imagery.find((image) => image.id === model.facadeAlignment?.sourceImageId)
    : model.imagery[0];
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
  const plinthGeometry = terrainConformingWallGeometry(building, model, visibleBaseY);

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

  return (
    <group>
      <mesh geometry={plinthGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#999b94" roughness={0.94} side={THREE.DoubleSide} />
      </mesh>
      {volumeLayout.map((volume, index) => {
        const wallColor = fusedWallColor;
        return (
          <group key={`massing-${volume.level}`}>
            <mesh position={[volume.x, volume.y, volume.z]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
              <boxGeometry args={[volume.width, storyHeight - 0.08, volume.depth]} />
              <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
            </mesh>
            {index > 0 ? (
              <mesh position={[volume.x + axes.nx * 0.12, visibleBaseY + storyHeight * volume.level + 0.035, volume.z + axes.nz * 0.12]} rotation={[0, axes.rotationY, 0]} castShadow receiveShadow>
                <boxGeometry args={[volume.width + 0.35, 0.07, volume.depth + 0.25]} />
                <meshStandardMaterial color={COLORS.concrete} roughness={0.88} />
              </mesh>
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
            <mesh><planeGeometry args={[width + 0.16, height + 0.16]} /><meshStandardMaterial color="#263239" roughness={0.42} side={THREE.DoubleSide} /></mesh>
            <mesh position={[0, 0, 0.012]}><planeGeometry args={[width, height]} /><meshPhysicalMaterial color={COLORS.glass} roughness={0.1} metalness={0.04} clearcoat={0.55} clearcoatRoughness={0.12} side={THREE.DoubleSide} /></mesh>
            <mesh position={[0, 0, 0.024]}><planeGeometry args={[Math.max(0.035, width * 0.025), height]} /><meshStandardMaterial color={COLORS.glassHighlight} roughness={0.22} transparent opacity={0.45} /></mesh>
          </group>
        );
      })}

      {doors.map((door, index) => {
        const layout = layoutForY(Math.max(0.02, door.y));
        const point = pointOnFront(door.x, layout);
        const width = Math.max(0.95, axes.width * Math.min(0.18, door.width));
        const height = Math.max(2.05, Math.min(2.65, totalHeight * door.height));
        return (
          <group key={`massing-door-${index}`} position={[point.x, visibleBaseY + height / 2 + 0.08, point.z]} rotation={[0, axes.rotationY, 0]}>
            <mesh><planeGeometry args={[width + 0.14, height + 0.14]} /><meshStandardMaterial color="#313b3e" roughness={0.5} side={THREE.DoubleSide} /></mesh>
            <mesh position={[0, 0, 0.012]}><planeGeometry args={[width, height]} /><meshStandardMaterial color={COLORS.wood} roughness={0.68} side={THREE.DoubleSide} /></mesh>
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
        <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
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
  return (
    <group position={[x, y, z]} scale={scale}>
      <mesh position={[0, 1.25, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.19, 2.5, 7]} />
        <meshStandardMaterial color="#806145" roughness={1} />
      </mesh>
      <mesh position={[0, 3.0, 0]} castShadow receiveShadow>
        <icosahedronGeometry args={[1.45, 1]} />
        <meshStandardMaterial color={canopy} roughness={0.96} flatShading />
      </mesh>
      <mesh position={[0.75, 3.35, -0.2]} castShadow>
        <icosahedronGeometry args={[0.9, 1]} />
        <meshStandardMaterial color={tone % 2 ? COLORS.treeLight : COLORS.treeDark} roughness={0.96} flatShading />
      </mesh>
    </group>
  );
}

function VegetationLayer({ model }: { model: SemanticSiteModel }) {
  const clusters = new Map<string, { x: number; z: number; count: number }>();
  for (const sample of model.geometry.groundCover) {
    if (sample.className !== "tree_canopy") continue;
    const [x, z] = localMeters([sample.coordinate.longitude, sample.coordinate.latitude], model.center);
    const cellSize = 7.5;
    const key = `${Math.round(x / cellSize)}|${Math.round(z / cellSize)}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.x += x;
      existing.z += z;
      existing.count += 1;
    } else clusters.set(key, { x, z, count: 1 });
  }
  const target = primaryBuilding(model);
  const targetCenter = target ? polygonCentroid(target.polygon) : model.center;
  const [targetX, targetZ] = localMeters([targetCenter.longitude, targetCenter.latitude], model.center);
  const nearby = [...clusters.values()]
    .map((cluster) => ({ ...cluster, x: cluster.x / cluster.count, z: cluster.z / cluster.count }))
    .sort((a, b) => Math.hypot(a.x - targetX, a.z - targetZ) - Math.hypot(b.x - targetX, b.z - targetZ))
    .slice(0, 42);
  return (
    <group>
      {nearby.map((cluster, index) => {
        const y = terrainHeightAtLocal(model, cluster.x, cluster.z);
        const scale = 0.78 + ((index * 37) % 23) / 50;
        return <LowPolyTree key={`${cluster.x.toFixed(1)}-${cluster.z.toFixed(1)}`} x={cluster.x} y={y} z={cluster.z} scale={scale} tone={index} />;
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

    </group>
  );
}

function SceneContents({ model, debug }: { model: SemanticSiteModel; debug: boolean }) {
  const orbitTarget = defaultCameraTarget(model);
  return (
    <>
      <color attach="background" args={["#dce7e7"]} />
      <fog attach="fog" args={["#dce7e7", 95, 190]} />
      <Sky sunPosition={[7, 12, 5]} turbidity={4.5} rayleigh={1.5} mieCoefficient={0.004} mieDirectionalG={0.78} />
      <hemisphereLight args={["#f4fbff", "#9a997d", 1.05]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[30, 42, 18]}
        intensity={2.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.00018}
      />
      <ParcelGround model={model} debug={debug} />
      <StreetContext model={model} />
      {model.geometry.buildings.map((building) => (
        building.id === model.geometry.primaryBuildingId
          ? <BuildingMass key={building.id} building={building} model={model} />
          : <ContextBuilding key={building.id} building={building} model={model} />
      ))}
      <VegetationLayer model={model} />
      <SiteDetails model={model} />
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
        camera={{ position: cameraPosition, fov: view === "facade" ? 42 : 46, near: 0.1, far: 500 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; }}
      >
        <SceneContents model={model} debug={debug} />
      </Canvas>
    </div>
  );
}
