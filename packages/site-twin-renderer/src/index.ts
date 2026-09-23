export { SiteTwinScene } from "./SiteTwinScene";
export type { SiteTwinSceneProps } from "./SiteTwinScene";

// Interior: the canonical BuildingModel drawn inside the Site Twin.
export { SiteTwinWithInterior } from "./interior/SiteTwinWithInterior";
export type { SiteTwinWithInteriorProps } from "./interior/SiteTwinWithInterior";
export type { InteriorInput } from "./interior/controller";
export type { BuildingModel } from "./interior/canonical";
export { parseBuildingModel } from "./interior/parseModel";
export { parseRegistration } from "./interior/registration";
export type { InteriorRegistration } from "./interior/registration";
export { normaliseBuildInfo } from "./interior/renderStamp";
export type { BuildInfo } from "./interior/renderStamp";
export { createFilterState, isolateCategory, setLevel, toggleCategory } from "./interior/interaction";
export type { InteriorUiState, InteriorMode, PreciseView } from "./interior/store";
export { DEFAULT_MIN_DRAWN_THICKNESS_M, normaliseMinDrawnThickness } from "./interior/displayThickness";
export type { LayerId } from "./interior/interiorScene";
