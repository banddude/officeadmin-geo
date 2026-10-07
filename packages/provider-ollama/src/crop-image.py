#!/usr/bin/env python3
import argparse
import io
import sys
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--x", type=float, required=True)
parser.add_argument("--y", type=float, required=True)
parser.add_argument("--width", type=float, required=True)
parser.add_argument("--height", type=float, required=True)
parser.add_argument("--padding", type=float, default=0.0)
args = parser.parse_args()

source = Image.open(sys.stdin.buffer).convert("RGB")
w, h = source.size
padding = max(0.0, args.padding)
pad_x = args.width * padding
pad_y = args.height * padding
left = max(0.0, args.x - pad_x)
top = max(0.0, args.y - pad_y)
right = min(1.0, args.x + args.width + pad_x)
bottom = min(1.0, args.y + args.height + pad_y)
if right - left < 0.02 or bottom - top < 0.02:
    raise SystemExit("crop region is too small")
box = (
    max(0, min(w - 1, round(left * w))),
    max(0, min(h - 1, round(top * h))),
    max(1, min(w, round(right * w))),
    max(1, min(h, round(bottom * h))),
)
cropped = source.crop(box)
out = io.BytesIO()
cropped.save(out, format="JPEG", quality=94, optimize=True)
sys.stdout.buffer.write(out.getvalue())
