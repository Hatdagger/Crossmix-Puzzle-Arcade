"""Turn PC harness screen dumps (test/hw_pc.c) into PNG screenshots.

    python3 test/render.py SHOTDIR [--sheet sheet.png]

Each SHOTDIR/NAME.txt (28 rows of 40 fix words) becomes SHOTDIR/NAME.png at 2x,
drawn with the real tile banks and palettes from tools/make_tiles.py.
"""
import glob, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tools'))
import make_tiles as mt  # noqa: E402

GFX = os.path.join(HERE, '..', 'src', 'assets', 'gfx')
BANK = {3: Image.open(os.path.join(GFX, 'fix', 'tiles_a.png')).convert('RGB').load(),
        4: Image.open(os.path.join(GFX, 'fix', 'tiles_b.png')).convert('RGB').load()}
ROLE = {c: r for r, c in enumerate(mt.REF) if r}
PALS = {p: mt.palette(p) for p in range(2, 16)}
BG = Image.open(os.path.join(GFX, 'bg.png')).convert('RGB')
BACK = BG.copy()
px = BACK.load()
for y in range(224):
    for x in range(320):
        if px[x, y] == mt.MAG: px[x, y] = mt.BACKDROP


def render(path):
    rows = [[int(v, 16) for v in line.split()] for line in open(path) if line.strip()]
    im = BACK.copy()
    dst = im.load()
    for ty, words in enumerate(rows):
        for tx, w in enumerate(words):
            tile, pal = w & 0xfff, w >> 12
            bank, idx = tile >> 8, tile & 0xff
            if bank not in BANK or pal not in PALS: continue
            src = BANK[bank]
            ox, oy = (idx % 16) * 8, (idx // 16) * 8
            for y in range(8):
                for x in range(8):
                    r = ROLE.get(src[ox + x, oy + y])
                    if r: dst[tx * 8 + x, ty * 8 + y] = PALS[pal][r]
    out = path[:-4] + '.png'
    im.resize((640, 448), Image.NEAREST).save(out)
    return out


def main():
    d = sys.argv[1]
    outs = [render(p) for p in sorted(glob.glob(os.path.join(d, '*.txt')))]
    if '--sheet' in sys.argv:
        sheet = sys.argv[sys.argv.index('--sheet') + 1]
        ims = [Image.open(p).resize((320, 224)) for p in outs]
        cols = 4
        rows = (len(ims) + cols - 1) // cols
        sh = Image.new('RGB', (cols * 324, rows * 228), (0, 0, 0))
        for i, im in enumerate(ims): sh.paste(im, ((i % cols) * 324, (i // cols) * 228))
        sh.save(sheet)
    print('rendered %d screens' % len(outs))


if __name__ == '__main__':
    main()
