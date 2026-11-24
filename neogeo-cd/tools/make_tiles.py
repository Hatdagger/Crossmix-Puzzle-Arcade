"""Crossmix fix-layer art for the Neo Geo CD.

    python3 tools/make_tiles.py

Writes:
  src/assets/gfx/fix/tiles_a.png   bank 3: font, 8 px bricks, frames, bars
  src/assets/gfx/fix/tiles_b.png   bank 4: 16 px cells (2x2 tiles each)
  src/art.h                        role colours + the 14 fix palettes

Every tile is painted in "role" colours (role 1 = the palette's main colour,
2 light, 3 dark, 4 mid, 5..15 shared colours).  The game finds where the
converter put each role and builds palettes 2..15 by role, so one tile shows
in any colour.  Tile 0 of both banks holds all 15 role colours in role order,
so both banks come out of the converter with the same colour order.
Tile numbers match src/tiles.h.  All art is original.
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
GFX = os.path.join(ROOT, 'src', 'assets', 'gfx', 'fix')
FONT = json.load(open(os.path.join(HERE, 'font_big.json')))
MAG = (255, 0, 255)

# role reference colours as painted (must all differ at 5 bits per channel)
REF = [MAG,
       (40, 224, 248), (160, 240, 248), (24, 112, 128), (32, 176, 200),       # 1 C, 2 CH, 3 CL, 4 CM
       (248, 248, 248), (0, 0, 0), (8, 8, 32), (40, 40, 72),                   # 5 W, 6 K, 7 F, 8 FG
       (88, 96, 128), (176, 184, 208), (48, 56, 80),                          # 9 S, 10 SH, 11 SL
       (248, 64, 128), (248, 208, 160), (136, 72, 24), (128, 128, 128)]      # 12 A1, 13 A2, 14 A3, 15 GR
C, CH, CL, CM, W, K, F, FG, S, SH, SL, A1, A2, A3, GR = range(1, 16)

# the shared colours, as shown
SHARED = {W: (248, 248, 240), K: (0, 0, 0), F: (12, 10, 22), FG: (24, 22, 40), S: (64, 68, 92),
          SH: (120, 128, 160), SL: (36, 38, 56), A1: (255, 72, 136), A2: (244, 226, 190),
          A3: (124, 72, 32), GR: (140, 132, 152)}
# palette 2..15 families: main colour
FAMILY = {2: (255, 63, 164), 3: (47, 224, 255), 4: (255, 220, 46), 5: (255, 138, 30), 6: (157, 77, 255),
          7: (166, 255, 58), 8: (255, 59, 71), 9: (120, 116, 136), 10: (236, 236, 228), 11: (255, 178, 30),
          12: (88, 240, 120), 13: (232, 214, 172), 14: (112, 120, 152), 15: (63, 140, 255)}
BACKDROP = (14, 12, 26)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def palette(p):
    base = FAMILY[p]
    pal = [(0, 0, 0)] * 16
    pal[C] = base
    pal[CH] = mix(base, (255, 255, 255), 0.55)
    pal[CL] = mix(base, (0, 0, 0), 0.55)
    pal[CM] = mix(base, (0, 0, 0), 0.25)
    for r, c in SHARED.items(): pal[r] = c
    return pal


class Bank:
    def __init__(self):
        self.im = Image.new('RGB', (128, 128), MAG)
        self.px = self.im.load()
        for r in range(1, 16):            # key strip: every role, in order
            x, y = (r - 1) % 8, (r - 1) // 8
            self.px[x, y] = REF[r]

    def put(self, n, x, y, role):
        if 0 <= x < 8 and 0 <= y < 8 and role:
            self.px[(n % 16) * 8 + x, (n // 16) * 8 + y] = REF[role]

    def tile(self, n, rows):              # rows: 8 strings, '.' = transparent, else role letter
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != '.': self.put(n, x, y, CODE[ch])

    def cell(self, n, canvas):            # 16x16 canvas of roles -> tiles n..n+3
        for q in range(4):
            ox, oy = (q & 1) * 8, (q >> 1) * 8
            for y in range(8):
                for x in range(8):
                    self.put(n + q, x, y, canvas[oy + y][ox + x])


CODE = {'C': C, 'h': CH, 'l': CL, 'm': CM, 'W': W, 'K': K, 'F': F, 'g': FG, 'S': S, 'H': SH, 'L': SL,
        'a': A1, 'b': A2, 'c': A3, 'G': GR}


def glyph(ch):
    return FONT['g'].get(ch, FONT['g']['?'])


def blank():
    return [[0] * 16 for _ in range(16)]


def disc(cv, cx, cy, r, role):
    for y in range(16):
        for x in range(16):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r: cv[y][x] = role


def mask_put(cv, mask, ox, oy, role):
    for y, row in enumerate(mask):
        for x, ch in enumerate(row):
            if ch == '#' and 0 <= oy + y < 16 and 0 <= ox + x < 16: cv[oy + y][ox + x] = role


# 8x8 symbol masks for the square tiles (Calm, Jewel, Swap)
SQ_SYMBOLS = [
    ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'],   # circle
    ['...##...', '..####..', '.######.', '########', '########', '.######.', '..####..', '...##...'],   # diamond
    ['...##...', '...##...', '..####..', '..####..', '.######.', '.######.', '########', '########'],   # triangle
    ['...##...', '...##...', '########', '.######.', '..####..', '.######.', '.##..##.', '##....##'],   # star
    ['########', '########', '##....##', '##....##', '##....##', '##....##', '########', '########'],   # square ring
    ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],   # heart
]
# 6x6 symbols on bubbles (Pop, Grab)
BUB_SYMBOLS = [
    ['......', '..##..', '.####.', '.####.', '..##..', '......'],    # dot
    ['.####.', '##..##', '#....#', '#....#', '##..##', '.####.'],    # ring
    ['..##..', '..##..', '.####.', '.####.', '######', '......'],    # triangle
    ['..##..', '######', '.####.', '.####.', '##..##', '......'],    # star
    ['..##..', '.####.', '######', '######', '.####.', '..##..'],    # diamond
    ['######', '######', '##..##', '##..##', '######', '######'],    # square
]


def sq_cell(sym, lit=False):
    cv = blank()
    for y in range(16):
        for x in range(16):
            if (x in (0, 15) and y in (0, 15)): continue
            cv[y][x] = C
    for i in range(1, 15):
        cv[0][i] = CH; cv[i][0] = CH; cv[15][i] = CL; cv[i][15] = CL
    cv[1][1] = W
    mask_put(cv, SQ_SYMBOLS[sym], 5, 5, CL)       # shadow
    mask_put(cv, SQ_SYMBOLS[sym], 4, 4, W)
    if lit: brackets(cv)
    return cv


def brackets(cv):
    for i in range(5):
        for (x, y) in ((i, 0), (0, i), (15 - i, 0), (15, i), (i, 15), (0, 15 - i), (15 - i, 15), (15, 15 - i)):
            cv[y][x] = W
        for (x, y) in ((i, 1), (1, i), (14 - i, 1) if i < 4 else (11, 1), (14, i), (i, 14), (1, 14 - i), (14 - i, 14) if i < 4 else (11, 14), (14, 14 - i)):
            cv[y][x] = K


def stone(lit=False):
    cv = blank()
    for y in range(16):
        for x in range(16):
            if (x in (0, 15) and y in (0, 15)): continue
            cv[y][x] = CM
    for i in range(1, 15):
        cv[0][i] = CH; cv[i][0] = CH; cv[15][i] = CL; cv[i][15] = CL
    for (x, y) in ((4, 3), (5, 4), (6, 5), (6, 6), (7, 7), (9, 8), (10, 9), (11, 11), (3, 10), (4, 11), (12, 4)):
        cv[y][x] = CL
    if lit: brackets(cv)
    return cv


def bubble(sym=None, grey=False):
    cv = blank()
    disc(cv, 7.5, 7.5, 7.4, CL)
    disc(cv, 7.5, 7.0, 6.6, C)
    disc(cv, 6.0, 5.0, 2.6, CH)
    cv[4][5] = W; cv[4][4] = W; cv[3][5] = W
    if grey:
        for i in range(5):
            cv[5 + i][5 + i] = CL; cv[5 + i][9 - i] = CL
    elif sym is not None:
        mask_put(cv, BUB_SYMBOLS[sym], 5, 6, CL)
        mask_put(cv, BUB_SYMBOLS[sym], 5, 5, W)
    return cv


def head(k):
    cv = blank()
    if k == 0:   # dog: floppy ears
        for y in range(4, 12):
            for x in (1, 2, 3, 12, 13, 14): cv[y][x] = CL
    if k == 1:   # cat: pointy ears
        for i in range(4):
            for x in range(2, 2 + i + 1): cv[1 + i][x] = C
            for x in range(13 - i, 14): cv[1 + i][x] = C
    if k == 2:   # bunny: long ears
        for y in range(0, 6):
            for x in (4, 5, 10, 11): cv[y][x] = C
            cv[y][5] = A1 if y > 0 else C; cv[y][10] = A1 if y > 0 else C
    if k == 3:   # mouse: round ears
        disc(cv, 3, 4, 2.6, C); disc(cv, 12, 4, 2.6, C)
        disc(cv, 3, 4, 1.2, A1); disc(cv, 12, 4, 1.2, A1)
    disc(cv, 7.5, 9, 5.8, C)
    for x in range(3, 13): cv[15][x] = 0
    for x in range(4, 12): cv[14][x] = CL
    for (x, y) in ((5, 8), (6, 8), (5, 9), (6, 9), (9, 8), (10, 8), (9, 9), (10, 9)): cv[y][x] = K
    cv[8][5] = W; cv[8][9] = W
    cv[11][7] = A1; cv[11][8] = A1
    cv[12][6] = CL; cv[12][9] = CL
    return cv


def food(k):
    cv = blank()
    for y in range(1, 15):
        for x in range(1, 15): cv[y][x] = F
    for i in range(1, 15):
        cv[1][i] = CL; cv[14][i] = CL; cv[i][1] = CL; cv[i][14] = CL
    if k == 0:   # bone
        for x in range(5, 11): cv[7][x] = C; cv[8][x] = C
        for (x, y) in ((4, 6), (3, 6), (4, 9), (3, 9), (11, 6), (12, 6), (11, 9), (12, 9), (3, 7), (3, 8), (12, 7), (12, 8)): cv[y][x] = C
        for x in range(5, 11): cv[7][x] = CH
    if k == 1:   # fish
        for y in range(5, 11):
            for x in range(3, 10):
                if abs(y - 7.5) * 2 + abs(x - 6) < 6: cv[y][x] = C
        for (x, y) in ((10, 5), (11, 4), (10, 10), (11, 11), (10, 6), (10, 9), (11, 5), (11, 10)): cv[y][x] = CM
        cv[7][5] = K
    if k == 2:   # carrot
        for y in range(5, 13):
            w = max(1, (13 - y) // 2)
            for x in range(8 - w, 8 + w): cv[y][x] = C
        for (x, y) in ((6, 2), (6, 3), (8, 1), (8, 2), (8, 3), (9, 2), (10, 3), (7, 4), (8, 4)): cv[y][x] = CH
        cv[7][7] = CL; cv[9][8] = CL
    if k == 3:   # cheese
        for y in range(5, 12):
            for x in range(3, 13):
                if y >= 9 or x >= 13 - (y - 3) * 1.4: cv[y][x] = C
        cv[10][5] = CL; cv[8][9] = CL; cv[10][10] = CL
    return cv


def wrapped():
    cv = blank()
    for y in range(1, 15):
        for x in range(1, 15): cv[y][x] = GR
    for x in range(1, 15): cv[1][x] = W; cv[14][x] = SL
    for y in range(1, 15): cv[y][14] = SL
    for i in range(1, 15):
        cv[i][7] = C; cv[i][8] = C; cv[7][i] = C; cv[8][i] = C
    for (x, y) in ((5, 0), (6, 0), (9, 0), (10, 0), (5, 1), (10, 1)): cv[y][x] = C
    return cv


def coin():
    cv = blank()
    disc(cv, 7.5, 7.5, 6.8, CL)
    disc(cv, 7.5, 7.5, 5.8, C)
    disc(cv, 6, 5.5, 1.8, CH)
    for y in range(4, 12): cv[y][7] = CM; cv[y][8] = CM
    for x in range(6, 10): cv[5][x] = CM; cv[10][x] = CM
    return cv


def empty16(lit=False):
    cv = blank()
    for y in range(16):
        for x in range(16): cv[y][x] = F
    for i in range(16): cv[0][i] = FG; cv[i][0] = FG
    if lit: brackets(cv)
    return cv


def flash():
    cv = blank()
    for y in range(1, 15):
        for x in range(1, 15): cv[y][x] = W
    for i in range(1, 15): cv[1][i] = CH; cv[14][i] = CH
    return cv


# the professor (12x12 pixel art from the web version, drawn 1:1 in a 16x16 cell)
PROF_ROLE = {'k': K, 's': A2, 'h': W, 'g': C, 'w': W, 'd': SH, 'p': S, 'b': SL, 'r': A1}
HEAD = ['...kkkkk', '..khhsssk', '.khsgkgsk', '.khsssssk', '..kkssskk']
BODY = ['..kwwrwwk', '.kwwwrwwwk', '.kswwrwwsk', '..kwwwwwk']
PROF = [
    HEAD + BODY + ['..kppkppk', '..kbk.kbk', '.kkk..kkk'],
    HEAD + BODY + ['..kpk.kpk', '.kbk...kbk', '.kk.....kk'],
    HEAD + ['sk.kwrwk.ks', '.kkwwrwwkk', '..kwwwwwk', '..kwwwwwk', '..kpk.kpk', '..kbk.kbk', '..kk...kk'],
    ['...kkkkk', '..khhsssk', 'sk.ksgkgsk.ks', '.kkhsssssk.k', '..kkssskk', '..kwwrwwk', '..kwwrwwk', '..kwwwwwk', '..kppkppk', '.kpk...kpk', 'kbk.....kbk', 'kk.......kk'],
    ['', '', '', '', '', '', '', '', '.kkkkkkkkk', 'khhsgsgswwk', 'kwwwwrwwppk', '.kkkkkkkkk'],
]


def prof(f):
    cv = blank()
    rows = PROF[f]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row[:13]):
            if ch in PROF_ROLE and 0 <= x + 2 < 16: cv[y + 3][x + 2] = PROF_ROLE[ch]
    return cv


def grabber():
    cv = blank()
    disc(cv, 7.5, 9, 5, C)
    disc(cv, 6, 7.5, 1.5, CH)
    for (x, y) in ((5, 9), (10, 9)): cv[y][x] = K
    for y in range(1, 6):
        cv[y][2] = SH; cv[y][13] = SH
    cv[1][3] = SH; cv[1][12] = SH; cv[0][4] = SH; cv[0][11] = SH
    for x in range(4, 12): cv[14][x] = CL
    return cv


def make_bank_a():
    b = Bank()
    # font 32..95: glyph in role C, shadow in K at +1,+1
    for code in range(32, 96):
        g = glyph(chr(code))
        for p, ch in enumerate(g):
            if ch == '#':
                x, y = p % 5 + 1, p // 5
                b.put(code, x + 1, y + 1, K)
        for p, ch in enumerate(g):
            if ch == '#':
                x, y = p % 5 + 1, p // 5
                b.put(code, x, y, C)
    T = {}
    b.tile(1, ['hhhhhhhl', 'hWCCCCCl', 'hCCCCCCl', 'hCCCCCCl', 'hCCCCCCl', 'hCCCCCCl', 'hCCCCCml', 'llllllll'])   # brick
    b.tile(2, ['CCCCCCCC', 'CFFFFFFC', 'CFFFFFFC', 'CFFFFFFC', 'CFFFFFFC', 'CFFFFFFC', 'CFFFFFFC', 'CCCCCCCC'])   # ghost
    b.tile(3, ['gFFFFFFF'] * 8)                                                                               # empty with grid line
    b.tile(4, ['hhhhhhhl', 'hCCWWCCl', 'hCWaaWCl', 'hWaaaaWl', 'hWaaaaWl', 'hCWaaWCl', 'hCCWWCml', 'llllllll'])   # crystal
    b.tile(5, ['SSSSSSSS', 'LLLLLLLL', 'HHHHHHHH', 'WW.WW.WW', 'WW.WW.WW', '.G..G..G', '.G..G..G', '........'])   # spikes
    b.tile(6, ['SSSSSSSS', 'SLSSSLSS', 'SSSSSSSS', 'SSSLSSSL', 'SSSSSSSS', 'SLSSSLSS', 'SSSSSSSS', 'LLLLLLLL'])   # ceiling slab
    b.tile(7, ['CCCCCCCC'] * 8)                                                                               # solid
    for i, ch in enumerate('CEARUDGFS'):                                                                     # weapon letters
        n = 8 + i
        b.tile(n, ['hhhhhhhl', 'hhhhhhhl', 'hhhhhhhl', 'hhhhhhhl', 'hhhhhhhl', 'hhhhhhhl', 'hhhhhhhl', 'llllllll'])
        g = glyph(ch)
        for p, c in enumerate(g):
            if c == '#': b.put(n, p % 5 + 1, p // 5, K)
    # frames: the field sits inside; bars are 3 px against the field
    b.tile(17, ['........', '........', '........', '........', '........', '.....HHH', '.....HSS', '.....HSL'])   # TL
    b.tile(18, ['........', '........', '........', '........', '........', 'HHHHHHHH', 'SSSSSSSS', 'LLLLLLLL'])   # T
    b.tile(19, ['........', '........', '........', '........', '........', 'HHH.....', 'SSL.....', 'LSL.....'])   # TR
    b.tile(20, ['.....HSL'] * 8)                                                                              # L
    b.tile(21, ['HSL.....'] * 8)                                                                              # R
    b.tile(22, ['.....HSL', '.....HSS', '.....LLL', '........', '........', '........', '........', '........'])   # BL
    b.tile(23, ['HHHHHHHH', 'SSSSSSSS', 'LLLLLLLL', '........', '........', '........', '........', '........'])   # B
    b.tile(24, ['HSL.....', 'SSL.....', 'LLL.....', '........', '........', '........', '........', '........'])   # BR
    b.tile(25, ['GSGSGSGS', 'SGSGSGSG', 'GSGSGSGS', 'SGSGSGSG', 'GSGSGSGS', 'SGSGSGSG', 'GSGSGSGS', 'SGSGSGSG'])   # fog A
    b.tile(26, ['SSGSSSGS', 'SGSGSGSG', 'GSSSGSSS', 'SGSGSGSG', 'SSGSSSGS', 'SGSGSGSG', 'GSSSGSSS', 'SGSGSGSG'])   # fog B
    b.tile(27, ['...C....', '...C....', 'CCCCCCC.', '.CCCCC..', '..CCC...', '.CC.CC..', '.C...C..', '........'])   # star
    b.tile(28, ['........', '........', '........', '...CC...', '...CC...', '........', '........', '........'])   # dot
    b.tile(29, ['.C......', '.CC.....', '.CCC....', '.CCCC...', '.CCC....', '.CC.....', '.C......', '........'])   # arrow
    b.tile(30, ['........', '........', '........', 'CCC.CCC.', 'CCC.CCC.', '........', '........', '........'])   # danger line
    b.tile(31, ['KKKKKKKK'] * 8)                                                                              # black
    for f in range(9):                                                                                       # incoming bar
        rows = []
        for y in range(8):
            rows.append('.LCCCCL.' if y >= 8 - f else '.LLLLLL.')
        b.tile(96 + f, rows)
    b.tile(105, ['FFFFFFFF'] * 8)                                                                             # plain field
    b.tile(106, ['SSHHHSSS', 'SH...HSS', 'SH...HSS', 'SSHHHSSS', 'SSHHHSSS', 'SH...HSS', 'SH...HSS', 'SSHHHSSS'])   # chain
    b.tile(107, ['...L....', '...L....', 'LLLLLLL.', '.L...L..', '..L.L...', '.LL.LL..', '.L...L..', '........'])   # star off
    b.tile(108, ['........', '........', 'CCCCCCC.', 'CCCCCCC.', 'CCCCCCC.', 'CCCCCCC.', '........', '........'])   # bar segment
    return b


def make_bank_b():
    b = Bank()
    for s in range(6):
        b.cell(4 + 4 * s, sq_cell(s))
        b.cell(28 + 4 * s, sq_cell(s, True))
        b.cell(56 + 4 * s, bubble(s))
    b.cell(52, stone())
    b.cell(80, bubble(grey=True))
    for k in range(4):
        b.cell(84 + 4 * k, head(k))
        b.cell(100 + 4 * k, food(k))
    b.cell(116, wrapped())
    b.cell(120, coin())
    b.cell(124, empty16(True))
    for f in range(5): b.cell(128 + 4 * f, prof(f))
    b.cell(148, grabber())
    b.cell(152, bubble(0))
    b.cell(156, empty16())
    b.cell(160, stone(True))
    b.cell(164, flash())
    return b


def c3(c):
    return '{ %3d, %3d, %3d }' % c


def write_header():
    out = ['/* Generated by tools/make_tiles.py - do not edit. */', '#ifndef XM_ART_H', '#define XM_ART_H', '',
           '/* role colours as painted in the tile banks (index = role) */',
           'static const unsigned char ROLE_REF[16][3] = {']
    out += ['    %s,' % c3(REF[k]) for k in range(16)]
    out += ['};', '', '/* fix palettes 2..15, by role */', 'static const unsigned char FIX_PAL_RGB[16][16][3] = {']
    for p in range(16):
        pal = palette(p) if p >= 2 else [(0, 0, 0)] * 16
        out.append('    { ' + ', '.join(c3(c) for c in pal) + ' },')
    out += ['};', '', 'static const unsigned char BACKDROP_RGB[3] = %s;' % c3(BACKDROP).replace('{', '{').replace('}', '}'), '', '#endif', '']
    open(os.path.join(ROOT, 'src', 'art.h'), 'w').write('\n'.join(out))


def main():
    os.makedirs(GFX, exist_ok=True)
    make_bank_a().im.save(os.path.join(GFX, 'tiles_a.png'))
    make_bank_b().im.save(os.path.join(GFX, 'tiles_b.png'))
    write_header()
    print('wrote tiles_a.png, tiles_b.png, src/art.h')


if __name__ == '__main__':
    main()
