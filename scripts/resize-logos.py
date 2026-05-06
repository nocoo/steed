#!/usr/bin/env python3
"""Generate derived logo assets from root logo.png (Basalt B-3 spec).

Vite SPA project — assets go to apps/web/public/.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "apps" / "web" / "public"
OG_BG = (15, 15, 15)


def resize(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    img = Image.open(SOURCE).convert("RGBA")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    # public/ — sidebar and display assets
    for size in [24, 80]:
        resize(img, size).save(PUBLIC / f"logo-{size}.png", "PNG", optimize=True)

    # favicon.ico (replaces non-existent favicon.svg)
    ico_16, ico_32 = resize(img, 16), resize(img, 32)
    ico_16.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32)],
        append_images=[ico_32],
    )

    # apple-touch-icon
    resize(img, 180).save(PUBLIC / "apple-touch-icon.png", "PNG", optimize=True)

    # OG image 1200x630
    canvas = Image.new("RGB", (1200, 630), OG_BG)
    logo = resize(img, 252)
    canvas.paste(logo, (474, 189), logo)
    canvas.save(PUBLIC / "og-image.png", "PNG", optimize=True)

    print("✓ public/logo-24.png (24×24)")
    print("✓ public/logo-80.png (80×80)")
    print("✓ public/favicon.ico (16+32)")
    print("✓ public/apple-touch-icon.png (180×180)")
    print("✓ public/og-image.png (1200×630)")


if __name__ == "__main__":
    main()
