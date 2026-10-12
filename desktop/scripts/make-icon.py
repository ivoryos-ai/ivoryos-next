"""Build the app icons (1024x1024) from desktop/build/logo.png.

  build/icon.png      macOS: the logo on a rounded tile, the shape macOS icons are expected to have.
  build/icon-win.png  Windows and Linux: the logo alone on a transparent square. There an icon is
                      its own shape, and a tile reads as a pale box around it, most of all in the
                      tray at 16px.
  build/trayTemplate.png, trayTemplate@2x.png
                      The macOS menu bar: the logo's outline and eyes only, black on transparent.
                      The "Template" in the name tells macOS to tint it for a light or dark menu
                      bar, as it does every menu bar icon; the full-colour logo at 18pt is a blur
                      of circuit lines, and the tiled one shows as a box.

electron-builder turns these into the .icns and .ico. Replace logo.png (any size of at least
~700px wide; SVG not needed) and run:  uv run --with pillow python scripts/make-icon.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "..", "build")
SIZE, TILE, RADIUS = 1024, 824, 185  # macOS icon grid: an 824px rounded square on a 1024 canvas

logo = Image.open(os.path.join(BUILD, "logo.png")).convert("RGBA")
icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
margin = (SIZE - TILE) // 2
ImageDraw.Draw(icon).rounded_rectangle(
    [margin, margin, SIZE - margin, SIZE - margin], radius=RADIUS,
    fill=(250, 248, 242, 255), outline=(226, 222, 212, 255), width=4,
)
width = 660
height = round(logo.height * width / logo.width)
logo = logo.resize((width, height), Image.LANCZOS)
icon.alpha_composite(logo, ((SIZE - width) // 2, (SIZE - height) // 2 + 8))
icon.save(os.path.join(BUILD, "icon.png"))
print("wrote build/icon.png", icon.size)

# No tile: the logo as large as fits, with a little room so it does not touch the edges.
bare = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
source = Image.open(os.path.join(BUILD, "logo.png")).convert("RGBA")
width = SIZE - 2 * 24
height = round(source.height * width / source.width)
bare.alpha_composite(source.resize((width, height), Image.LANCZOS), ((SIZE - width) // 2, (SIZE - height) // 2))
bare.save(os.path.join(BUILD, "icon-win.png"))
print("wrote build/icon-win.png", bare.size)

# Menu bar: keep only the dark outline and eyes, as black with the logo's own antialiasing.
source = Image.open(os.path.join(BUILD, "logo.png")).convert("RGBA")
lum = source.convert("L")
outline = Image.composite(lum.point(lambda v: 255 if v < 90 else 0), Image.new("L", source.size, 0), source.getchannel("A"))
mark = Image.new("RGBA", source.size, (0, 0, 0, 0))
mark.putalpha(outline)
for scale, suffix in ((1, ""), (2, "@2x")):
    h = 18 * scale  # 18pt tall, the usual height of a menu bar icon
    w = round(source.width * h / source.height)
    canvas = Image.new("RGBA", (25 * scale, h), (0, 0, 0, 0))
    canvas.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((canvas.width - w) // 2, 0))
    canvas.save(os.path.join(BUILD, f"trayTemplate{suffix}.png"))
    print(f"wrote build/trayTemplate{suffix}.png", canvas.size)
