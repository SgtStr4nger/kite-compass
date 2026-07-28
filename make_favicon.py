from PIL import Image, ImageDraw
# simple compass-rose favicon, teal on cream
s = 128
img = Image.new("RGBA", (s, s), (0,0,0,0))
d = ImageDraw.Draw(img)
teal = (23, 74, 79, 255)
gold = (214, 158, 46, 255)
cream = (247, 244, 237, 255)
c = s//2
d.ellipse([8,8,s-8,s-8], fill=cream, outline=teal, width=5)
# vertical star (teal)
d.polygon([(c, 18),(c+11, c),(c, s-18),(c-11, c)], fill=teal)
# horizontal star (gold)
d.polygon([(18, c),(c, c-11),(s-18, c),(c, c+11)], fill=gold)
d.ellipse([c-6,c-6,c+6,c+6], fill=teal)
img.save("/home/user/workspace/kite-compass/client/public/favicon.png")
print("favicon written")
