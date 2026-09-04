import type { Coordinate, StreetImageCandidate } from "@officeadmin-geo/site-twin-core";
import { rankStreetImages, selectDistinctStreetImages } from "@officeadmin-geo/site-twin-core";

const API = "https://api.openstreetcam.org/2.0/photo/";

interface KartaPhotoRow {
  id: string | number;
  lat?: string | number;
  lng?: string | number;
  ca?: string | number | null;
  dateAdded?: string;
  sequenceId?: string | number;
  sequence?: { id?: string | number };
  fileurlProc?: string;
  fileurlTh?: string;
  name?: string;
}

interface KartaResponse {
  result?: { data?: KartaPhotoRow[] | KartaPhotoRow };
}

export interface KartaViewSearchOptions {
  radiusM?: number;
  zoomLevel?: number;
  candidateLimit?: number;
  selectedLimit?: number;
}

function asRows(payload: KartaResponse) {
  const data = payload.result?.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

export async function findKartaViewImages(
  target: Coordinate,
  options: KartaViewSearchOptions = {},
): Promise<StreetImageCandidate[]> {
  const radiusM = options.radiusM ?? 500;
  const candidateLimit = options.candidateLimit ?? 100;
  const selectedLimit = options.selectedLimit ?? 4;
  const url = new URL(API);
  url.searchParams.set("lat", String(target.latitude));
  url.searchParams.set("lng", String(target.longitude));
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("zoomLevel", String(options.zoomLevel ?? 18));
  url.searchParams.set("join", "sequence");
  url.searchParams.set("orderBy", "id");
  url.searchParams.set("orderDirection", "desc");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`KartaView nearby photo query failed with ${response.status}`);
  const payload = (await response.json()) as KartaResponse;

  const candidates = asRows(payload)
    .slice(0, candidateLimit)
    .map((row): StreetImageCandidate | undefined => {
      const latitude = Number(row.lat);
      const longitude = Number(row.lng);
      const imageUrl = row.fileurlProc ?? row.fileurlTh;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !imageUrl) return undefined;
      const heading = row.ca == null ? undefined : Number(row.ca);
      return {
        id: String(row.id),
        provider: "kartaview",
        sequenceId: row.sequenceId != null ? String(row.sequenceId) : row.sequence?.id != null ? String(row.sequence.id) : undefined,
        latitude,
        longitude,
        headingDeg: Number.isFinite(heading) ? heading : undefined,
        capturedAt: row.dateAdded,
        imageUrl,
        thumbnailUrl: row.fileurlTh,
        provenance: {
          provider: "kartaview",
          featureId: String(row.id),
          sourceUrl: imageUrl,
          capturedAt: row.dateAdded,
        },
      };
    })
    .filter((row): row is StreetImageCandidate => Boolean(row));

  const ranked = rankStreetImages(candidates, target, radiusM);
  return selectDistinctStreetImages(ranked, selectedLimit);
}
