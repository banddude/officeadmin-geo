#!/usr/bin/env python3
import argparse
import io
import math
import sys
import requests
from PIL import Image

TILE = 512
ENDPOINT = "https://streetviewpixels-pa.googleapis.com/v1/tile"
USER_AGENT = "Mozilla/5.0 (OfficeAdmin Geo Site Twin research prototype)"


def normalized_x(view_heading_deg: float, panorama_heading_deg: float) -> float:
    # Google's equirectangular panorama places its reported panorama heading at
    # the horizontal center. Convert a compass heading to normalized pano X.
    return ((view_heading_deg - panorama_heading_deg + 180.0) % 360.0) / 360.0


def fetch_tile(session: requests.Session, pano_id: str, zoom: int, x: int, y: int) -> Image.Image:
    response = session.get(
        ENDPOINT,
        params={
            "cb_client": "maps_sv.tactile",
            "panoid": pano_id,
            "x": x,
            "y": y,
            "zoom": zoom,
        },
        headers={"User-Agent": USER_AGENT},
        timeout=25,
    )
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def render_crop(pano_id: str, pano_heading: float, view_heading: float, zoom: int, fov: float) -> Image.Image:
    tile_columns = 2 ** zoom
    tile_rows = 2 ** (zoom - 1)
    width = tile_columns * TILE
    height = tile_rows * TILE

    center_x = normalized_x(view_heading, pano_heading) * width
    crop_width = max(TILE, int(width * max(35.0, min(125.0, fov)) / 360.0))
    crop_height = int(height * 0.72)
    center_y = int(height * 0.47)
    left = int(round(center_x - crop_width / 2))
    top = max(0, min(height - crop_height, int(round(center_y - crop_height / 2))))
    right = left + crop_width
    bottom = top + crop_height

    canvas = Image.new("RGB", (crop_width, crop_height))
    first_tx = math.floor(left / TILE)
    last_tx = math.floor((right - 1) / TILE)
    first_ty = math.floor(top / TILE)
    last_ty = math.floor((bottom - 1) / TILE)

    session = requests.Session()
    for global_tx in range(first_tx, last_tx + 1):
        request_tx = global_tx % tile_columns
        for ty in range(max(0, first_ty), min(tile_rows - 1, last_ty) + 1):
            tile = fetch_tile(session, pano_id, zoom, request_tx, ty)
            dest_x = global_tx * TILE - left
            dest_y = ty * TILE - top
            canvas.paste(tile, (dest_x, dest_y))

    canvas.thumbnail((1400, 1000), Image.Resampling.LANCZOS)
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pano-id", required=True)
    parser.add_argument("--pano-heading", required=True, type=float)
    parser.add_argument("--view-heading", required=True, type=float)
    parser.add_argument("--zoom", type=int, default=3)
    parser.add_argument("--fov", type=float, default=100.0)
    args = parser.parse_args()

    image = render_crop(args.pano_id, args.pano_heading, args.view_heading, args.zoom, args.fov)
    image.save(sys.stdout.buffer, format="JPEG", quality=88, optimize=True)


if __name__ == "__main__":
    main()
