from PIL import Image, ImageDraw
import os

TEAL = (23, 74, 79, 255)
GOLD = (214, 158, 46, 255)
CREAM = (247, 244, 237, 255)

# Geometric fractions derived from the original 128x128 design:
#   ellipse inset 8/128, star tip distance 18/128, star half-width 11/128,
#   centre dot radius 6/128, ring width 5/128.
def compass(s, opaque=False):
    img = Image.new("RGBA", (s, s), CREAM if opaque else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = s // 2
    inset = max(1, round(s * 8 / 128))
    tip = round(s * 18 / 128)
    halfw = max(1, round(s * 11 / 128))
    radius = max(1, round(s * 6 / 128))
    width = max(1, round(s * 5 / 128))
    d.ellipse([inset, inset, s - inset, s - inset], fill=CREAM, outline=TEAL, width=width)
    d.polygon([(c, tip), (c + halfw, c), (c, s - tip), (c - halfw, c)], fill=TEAL)
    d.polygon([(tip, c), (c, c - halfw), (s - tip, c), (c, c + halfw)], fill=GOLD)
    d.ellipse([c - radius, c - radius, c + radius, c + radius], fill=TEAL)
    return img

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "client", "public")
os.makedirs(out, exist_ok=True)

# Primary browser favicon (128x128, transparent background).
compass(128, opaque=False).save(os.path.join(out, "favicon.png"))
# Reference brand icons for the web app manifest (192 and 512, transparent bg).
compass(192, opaque=False).save(os.path.join(out, "icon-192.png"))
compass(512, opaque=False).save(os.path.join(out, "icon-512.png"))
# iOS home-screen icon (180x180) - opaque cream background (no transparency).
compass(180, opaque=True).save(os.path.join(out, "apple-touch-icon.png"))
# Multi-size ICO for legacy browsers (16/32/48), generated from the 48x48 master.
master = compass(48, opaque=True).convert("RGB")
master.save(os.path.join(out, "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
print("icons written to", out)
