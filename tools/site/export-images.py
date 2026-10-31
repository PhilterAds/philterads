#!/usr/bin/env python3
"""Export PhilterAds site images (site/assets/img) from the art sources.

Prefers the anime-v2 set when it exists (<art>/anime-v2; <art> = $PHILTERADS_ART or ../philterads-art),
falls back to the placeholders (anime/ v1 for the scenes, flat hero.png / tracker.png
for support / tracker). Outputs keep the FINAL asset names, so swapping art later is
just: drop the new PNGs in place and rerun this script.

  python tools/site/export-images.py            # variant -a when anime-v2 exists
  python tools/site/export-images.py --variant b

Ratios per spec: hero 16:9 (og.jpg 1200x630 from the hero), every other panel 1:1.
WebP q80 at the widths in the spec.
"""

import argparse
import os
import sys
from pathlib import Path

from PIL import Image

ART = Path(os.environ.get("PHILTERADS_ART") or Path(__file__).resolve().parents[3] / "philterads-art")
OUT = Path(__file__).resolve().parents[2] / "site" / "assets" / "img"

# name -> (ratio w/h, [widths], v2 filename stem, placeholder path)
SCENES = {
    "hero":     ((16, 9), [1280, 960, 640], "anime-hero",     ART / "anime/anime-hero.png"),
    "youtube":  ((1, 1),  [1024, 768, 512], "anime-youtube",  ART / "anime/anime-youtube.png"),
    "tracker":  ((1, 1),  [1024, 768, 512], "anime-tracker",  ART / "tracker.png"),
    "cookies":  ((1, 1),  [1024, 768, 512], "anime-cookies",  ART / "anime/anime-cookies.png"),
    "sleeping": ((1, 1),  [1024, 768, 512], "anime-sleeping", ART / "anime/anime-sleeping.png"),
    "support":  ((1, 1),  [1024, 768, 512], "anime-support",  ART / "hero.png"),
}

def source_for(name: str, variant: str) -> Path:
    stem, fallback = SCENES[name][2], SCENES[name][3]
    v2 = ART / "anime-v2" / f"{stem}-{variant}.png"
    if v2.is_file():
        return v2
    print(f"[{name}] anime-v2 not found, using placeholder {fallback.name}")
    return fallback

def centre_crop(img: Image.Image, ratio: float) -> Image.Image:
    w, h = img.size
    if w / h > ratio:            # too wide -> trim sides
        new_w = round(h * ratio)
        box = ((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h)
    else:                        # too tall -> trim top/bottom
        new_h = round(w / ratio)
        box = (0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h)
    return img.crop(box)

def export(name: str, variant: str) -> None:
    ratio_wh, widths, _, _ = SCENES[name]
    src = source_for(name, variant)
    with Image.open(src) as img:
        img = img.convert("RGB")
        cropped = centre_crop(img, ratio_wh[0] / ratio_wh[1])
        for width in widths:
            im = cropped.resize(
                (width, round(cropped.height * width / cropped.width)), Image.LANCZOS
            )
            dest = OUT / f"{name}-{width}.webp"
            im.save(dest, "WEBP", quality=80, method=6)
            size = dest.stat().st_size
            note = ""
            if name == "hero" and width == 1280 and size > 160 * 1024:
                note = "  <-- OVER the 160 KB budget"
            print(f"[{name}] {dest.name}  {im.width}x{im.height}  {size / 1024:.1f} KB{note}")

def export_og(variant: str) -> None:
    src = source_for("hero", variant)
    with Image.open(src) as img:
        og = centre_crop(img.convert("RGB"), 1200 / 630).resize((1200, 630), Image.LANCZOS)
        dest = OUT / "og.jpg"
        og.save(dest, "JPEG", quality=85, optimize=True)
        print(f"[og] {dest.name}  1200x630  {dest.stat().st_size / 1024:.1f} KB")

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=["a", "b"], default="a",
                        help="anime-v2 variant to prefer when the set exists (default a)")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in SCENES:
        export(name, args.variant)
    export_og(args.variant)
    return 0

if __name__ == "__main__":
    sys.exit(main())
