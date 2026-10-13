"""Every logo asset, from one source: brand/ivoryos-logo.ai (the mark and its wordmark, vector).

  uv run --with pillow --with pymupdf python desktop/scripts/make-icon.py

Reads the PDF Illustrator keeps inside the .ai (saved "PDF compatible", the default), so the
mark is rendered from its paths at any size and never upscaled. From the mark alone:

  desktop/build/logo.png                 2000px wide, transparent: the icons below start from it
  desktop/build/icon.png                 macOS app icon: the mark on a rounded tile, the shape macOS
                                         icons are expected to have
  desktop/build/icon-win.png             Windows and Linux: the mark alone on a transparent square.
                                         There an icon is its own shape, and a tile reads as a pale
                                         box around it, most of all in the tray at 16px
  desktop/build/trayTemplate.png, @2x    macOS menu bar: the mark as one solid silhouette with its
                                         dark outline and eyes cut out. "Template" in the name tells
                                         macOS to tint the solid part for a light or dark bar. The
                                         full-colour mark at 18pt is a blur of circuit lines, the
                                         tiled one shows as a box, and the outline alone (an earlier
                                         version) was a tangle of thin lines
  frontend/public/ivoryos-mark.svg       the nav brand (BRAND_MARK in shared-ui TopNav.tsx); the same
  cloud_frontend/public/ivoryos-mark.svg   file for Cloud
  docs-site/src/assets/ivoryos-mark.svg  the docs site's logo and home page
  frontend/src/app/icon.png              the browser tab, 192px (Next.js picks app/icon.png up), with
  frontend/src/app/favicon.ico           16/32/48/64 in the .ico; the same two for cloud_frontend/src/app/,
  docs-site/public/favicon.ico           and the .ico for the docs

and from the whole lockup:

  brand/ivoryos-logo.svg                 mark and wordmark, the text as paths (no font needed)
  brand/ivoryos-logo.png                 the same at 1600px, transparent, for a light background
  brand/ivoryos-logo-dark.png            the wordmark light, for a dark background (the README picks
                                         one by the reader's theme)

electron-builder turns the icons under desktop/build/ into the .icns and .ico.
"""
import os
import re

import pymupdf
from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(ROOT, "desktop", "build")
BRAND = os.path.join(ROOT, "brand")
SOURCE = os.path.join(BRAND, "ivoryos-logo.ai")
WORDMARK_ON_DARK = (236, 236, 236)


def rel(path):
    return os.path.relpath(path, ROOT)


def save(image, path, **kwargs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, **kwargs)
    print("wrote", rel(path), image.size)


def fresh_page(without_text=False):
    """A new page object each time: a crop box, once set, changes the page's coordinates."""
    doc = pymupdf.open(SOURCE, filetype="pdf")
    page = doc[0]
    if without_text:
        # The wordmark sits just under the mark; redacting its box removes the text and nothing else
        # (graphics=0 keeps every path), so the mark can be cropped exactly.
        box = pymupdf.Rect()
        for block in page.get_text("dict")["blocks"]:
            if block["type"] == 0:
                box |= pymupdf.Rect(block["bbox"])
        page.add_redact_annot(box)
        page.apply_redactions(images=0, graphics=0)
    return doc, page


def ink_box(page, region, pad=1.5, zoom=8):
    """The box the ink fills inside `region`, plus a margin. Path bounds leave out stroke width, so
    the content is measured on a rendering instead."""
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=region, alpha=True)
    bbox = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples).getchannel("A").getbbox()
    return pymupdf.Rect(
        region.x0 + bbox[0] / zoom - pad, region.y0 + bbox[1] / zoom - pad,
        region.x0 + bbox[2] / zoom + pad, region.y0 + bbox[3] / zoom + pad,
    )


def drawings_box(page):
    box = pymupdf.Rect()
    for drawing in page.get_drawings():
        box |= drawing["rect"]
    return box


def render(box, width, without_text=False):
    _, page = fresh_page(without_text)
    page.set_cropbox(box)
    zoom = width / box.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
    return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)


def write_svg(box, path, without_text=False):
    _, page = fresh_page(without_text)
    page.set_cropbox(box)
    text = page.get_svg_image(text_as_path=True)
    # 1x1 image stubs are left where the PDF had nothing to draw; a browser does not need them.
    text = re.sub(r"<image\b[^>]*?/>", "", text)
    text = re.sub(r"<image\b[^>]*>.*?</image>", "", text, flags=re.S)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(text)
    print("wrote", rel(path), f"{len(text) // 1024}KB, {text.count('<path')} paths")
    return text


def squared(image, size, margin):
    """The image centred on a transparent square, as large as fits inside the margin."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min((size - 2 * margin) / image.width, (size - 2 * margin) / image.height)
    fitted = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


# --- the mark -------------------------------------------------------------------------------------
_, measure = fresh_page(without_text=True)
around = drawings_box(measure)
mark_box = ink_box(measure, pymupdf.Rect(around.x0 - 8, around.y0 - 8, around.x1 + 8, around.y1 + 8))

logo = render(mark_box, 2000, without_text=True)
save(logo, os.path.join(BUILD, "logo.png"))

svg_text = write_svg(mark_box, os.path.join(ROOT, "frontend", "public", "ivoryos-mark.svg"), without_text=True)
for path in (("cloud_frontend", "public", "ivoryos-mark.svg"), ("docs-site", "src", "assets", "ivoryos-mark.svg")):
    with open(os.path.join(ROOT, *path), "w") as handle:
        handle.write(svg_text)
    print("wrote", os.path.join(*path))

tab = squared(logo, 192, 8)
for app in ("frontend", "cloud_frontend"):
    save(tab, os.path.join(ROOT, app, "src", "app", "icon.png"))
ico = squared(logo, 256, 10)
for path in (("frontend", "src", "app", "favicon.ico"), ("cloud_frontend", "src", "app", "favicon.ico"), ("docs-site", "public", "favicon.ico")):
    save(ico, os.path.join(ROOT, *path), format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# macOS icon grid: an 824px rounded square on a 1024 canvas, the mark on it.
SIZE, TILE, RADIUS = 1024, 824, 185
icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
margin = (SIZE - TILE) // 2
ImageDraw.Draw(icon).rounded_rectangle(
    [margin, margin, SIZE - margin, SIZE - margin], radius=RADIUS,
    fill=(250, 248, 242, 255), outline=(226, 222, 212, 255), width=4,
)
width = 660
height = round(logo.height * width / logo.width)
icon.alpha_composite(logo.resize((width, height), Image.LANCZOS), ((SIZE - width) // 2, (SIZE - height) // 2 + 8))
save(icon, os.path.join(BUILD, "icon.png"))

# No tile: the mark as large as fits, with a little room so it does not touch the edges.
save(squared(logo, SIZE, 24), os.path.join(BUILD, "icon-win.png"))

# Menu bar: the whole silhouette, minus the dark outline and eyes. The mask is the mark's alpha
# times a ramp over luminance (0 on the dark outline at about 60, 1 from about 100 up), so the
# antialiasing is kept while the mid-grey circuit lines (about 110) count as solid fill: at 18pt
# they are narrower than a pixel, and half-counting them left a speckle.
lum = logo.convert("L")
fill = lum.point(lambda v: 0 if v <= 65 else 255 if v >= 100 else round((v - 65) * 255 / 35))
mark = Image.new("RGBA", logo.size, (0, 0, 0, 0))
mark.putalpha(ImageChops.multiply(fill, logo.getchannel("A")))
for scale, suffix in ((1, ""), (2, "@2x")):
    h = 18 * scale  # 18pt tall, the usual height of a menu bar icon
    w = round(logo.width * h / logo.height)
    canvas = Image.new("RGBA", (25 * scale, h), (0, 0, 0, 0))
    canvas.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((canvas.width - w) // 2, 0))
    save(canvas, os.path.join(BUILD, f"trayTemplate{suffix}.png"))

# --- the lockup -----------------------------------------------------------------------------------
_, whole = fresh_page()
lockup_box = ink_box(whole, whole.rect, pad=4)
write_svg(lockup_box, os.path.join(BRAND, "ivoryos-logo.svg"))
light = render(lockup_box, 1600)
save(light, os.path.join(BRAND, "ivoryos-logo.png"))

# The dark one: every inked pixel below the mark is wordmark, recoloured with its alpha kept.
dark = light.copy()
pixels = dark.load()
first_text_row = int((mark_box.y1 - lockup_box.y0) * (1600 / lockup_box.width)) + 1
for y in range(first_text_row, dark.height):
    for x in range(dark.width):
        r, g, b, a = pixels[x, y]
        if a:
            pixels[x, y] = (*WORDMARK_ON_DARK, a)
save(dark, os.path.join(BRAND, "ivoryos-logo-dark.png"))
