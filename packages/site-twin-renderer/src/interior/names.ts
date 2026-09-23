/*
 * names.ts -- scene-graph names shared with SiteTwinScene.tsx.
 *
 * SiteTwinScene wraps the primary building's stylised shell in a group with
 * this name (the only structural change the interior needs from the exterior
 * renderer). The cutaway and precise modes find the shell by it.
 */
export const PRIMARY_BUILDING_GROUP_NAME = "site-twin-primary-building";

/** The interior's own root; the shell cut never touches anything under it. */
export const INTERIOR_ROOT_NAME = "oabm-interior-root";
