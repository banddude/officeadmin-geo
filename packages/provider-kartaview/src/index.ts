import type { Coordinate, StreetImageCandidate } from "@officeadmin-geo/site-twin-core";
import { rankStreetImages, selectDistinctStreetImages } from "@officeadmin-geo/site-twin-core";

const API = "https://api.openstreetcam.org/2.0/photo/";

interface KartaPhotoRow {
  id: string | number;
  lat?: string | number;
  lng?: string | number;
  ca?: string | number | null;
  heading?: string | number | null;
  dateAdded?: string;
  sequenceId?: string | number;
  sequence?: { id?: string | number };
  fileurlProc?: string;
  fileurlTh?: string;
  imageProcUrl?: string;
  imageLthUrl?: string;
}

interface KartaListResponse {
  result?: { data?: KartaPhotoRow[] | KartaPhotoRow };
}

export interface KartaViewSearchOptions {
  radiusM?: number;
  zoomLevel?: number;
  candidateLimit?: number;
  enrichmentLimit?: number;
  selectedLimit?: number;
  maxHeadingErrorDeg?: number;
}

function asRows(payload: KartaListResponse) {
  const data = payload.result?.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

function normalizeRow(row: KartaPhotoRow): StreetImageCandidate | undefined {
  const latitude = Number(row.lat);
  const longitude = Number(row.lng);
  const imageUrl = row.imageProcUrl ?? row.fileurlProc ?? row.imageLthUrl ?? row.fileurlTh;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !imageUrl) return undefined;
  const rawHeading = row.heading ?? row.ca;
  const heading = rawHeading == null ? undefined : Number(rawHeading);
  return {
    id: String(row.id),
    provider: "kartaview",
    sequenceId: row.sequenceId != null ? String(row.sequenceId) : row.sequence?.id != null ? String(row.sequence.id) : undefined,
    latitude,
    longitude,
    headingDeg: Number.isFinite(heading) ? heading : undefined,
    capturedAt: row.dateAdded,
    imageUrl,
    thumbnailUrl: row.imageLthUrl ?? row.fileurlTh,
    provenance: {
      provider: "kartaview",
      featureId: String(row.id),
      sourceUrl: imageUrl,
      capturedAt: row.dateAdded,
    },
  };
}

async function getPhotoDetail(image: StreetImageCandidate): Promise<StreetImageCandidate> {
  try {
    const response = await fetch(`${API}${encodeURIComponent(image.id)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return image;
    const payload = (await response.json()) as KartaListResponse;
    const detail = asRows(payload)[0];
    if (!detail) return image;
    const normalized = normalizeRow({
      ...detail,
      lat: detail.lat ?? image.latitude,
      lng: detail.lng ?? image.longitude,
      sequenceId: detail.sequenceId ?? image.sequenceId,
    });
    return normalized ? { ...image, ...normalized } : image;
  } catch {
    return image;
  }
}

export async function findKartaViewImages(
  target: Coordinate,
  options: KartaViewSearchOptions = {},
): Promise<StreetImageCandidate[]> {
  const radiusM = options.radiusM ?? 500;
  const candidateLimit = options.candidateLimit ?? 100;
  const enrichmentLimit = options.enrichmentLimit ?? 40;
  const selectedLimit = options.selectedLimit ?? 4;
  const maxHeadingErrorDeg = options.maxHeadingErrorDeg ?? 55;
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
  const payload = (await response.json()) as KartaListResponse;

  const rawCandidates = asRows(payload)
    .slice(0, candidateLimit)
    .map(normalizeRow)
    .filter((row): row is StreetImageCandidate => Boolean(row));

  const preliminary = rankStreetImages(rawCandidates, target, radiusM);
  const toEnrich = preliminary.slice(0, enrichmentLimit);
  const enriched = await Promise.all(toEnrich.map(getPhotoDetail));
  const untouched = preliminary.slice(enrichmentLimit);
  const ranked = rankStreetImages([...enriched, ...untouched], target, radiusM);

  // Once heading is known, never burn a vision slot on an image pointed far
  // away from the parcel. Unknown-heading frames remain eligible as a fallback.
  const facingTarget = ranked.filter((image) =>
    image.headingErrorDeg == null || image.headingErrorDeg <= maxHeadingErrorDeg,
  );
  return selectDistinctStreetImages(facingTarget, selectedLimit);
}
