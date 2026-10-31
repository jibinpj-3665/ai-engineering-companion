"""Generate the application icon (PNG + multi-size ICO) with Pillow."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SIZE = 1024
WORK = 512


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def build_gradient() -> Image.Image:
    stops = [(0.0, (124, 58, 237)), (0.5, (79, 70, 229)), (1.0, (6, 182, 212))]
    image = Image.new("RGB", (WORK, WORK), stops[0][1])
    pixels = image.load()
    for y in range(WORK):
        for x in range(WORK):
            t = (x / (WORK - 1) * 0.65) + (y / (WORK - 1) * 0.35)
            for index in range(len(stops) - 1):
                start, colour_a = stops[index]
                end, colour_b = stops[index + 1]
                if start <= t <= end:
                    local = (t - start) / (end - start)
                    pixels[x, y] = tuple(int(lerp(colour_a[i], colour_b[i], local)) for i in range(3))
                    break
            else:
                pixels[x, y] = stops[-1][1]
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).convert("RGBA")


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    base = build_gradient()

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((24, 24, SIZE - 24, SIZE - 24), radius=232, fill=255)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(base, (0, 0), mask)

    draw = ImageDraw.Draw(icon, "RGBA")

    draw.ellipse((-260, -320, 700, 540), fill=(255, 255, 255, 26))
    draw.ellipse((520, 640, 1240, 1320), fill=(255, 255, 255, 18))

    centre = SIZE / 2
    radius = 268
    hexagon = [
        (centre + radius * math.cos(math.radians(60 * index - 30)),
         centre + radius * math.sin(math.radians(60 * index - 30)))
        for index in range(6)
    ]
    draw.polygon(hexagon, fill=(255, 255, 255, 20))
    draw.line(hexagon + [hexagon[0]], fill=(255, 255, 255, 225), width=20, joint="curve")

    inner = 138
    for index in range(6):
        angle = math.radians(60 * index - 30)
        x = centre + inner * math.cos(angle)
        y = centre + inner * math.sin(angle)
        draw.line((centre, centre, x, y), fill=(255, 255, 255, 150), width=12)
        draw.ellipse((x - 26, y - 26, x + 26, y + 26), fill=(255, 255, 255, 235))

    draw.ellipse((centre - 76, centre - 76, centre + 76, centre + 76), fill=(255, 255, 255, 245))
    draw.ellipse((centre - 34, centre - 34, centre + 34, centre + 34), fill=(88, 56, 224, 255))

    draw.arc((90, 90, SIZE - 90, SIZE - 90), start=200, end=320, fill=(255, 255, 255, 70), width=10)

    icon.save(ASSETS / "icon.png")
    icon.save(
        ASSETS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Wrote {ASSETS / 'icon.ico'} and {ASSETS / 'icon.png'}")


if __name__ == "__main__":
    main()
