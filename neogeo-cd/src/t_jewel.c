/*
 * JEWEL: Columns-style falling jewels (js/track-jewel.js).
 * A column of 3 jewels falls into a 6-wide well. A cycles down, B cycles up.
 * 3+ in a line across, down or diagonally clears; chains follow.
 * Incoming units rise as rock rows (one gap per batch); a rock breaks next to a clear.
 */
#include "xm.h"
#include "tiles.h"

#define COLS JW_COLS
#define ROWS JW_ROWS
#define NC 6
#define ROCK 9
#define SPAWN_C 2
#define FALL 900
#define FALL_MIN 140
#define FALL_STEP 70
#define SPEEDUP 30000UL
#define SOFT 75
#define LOCK_DELAY 350
#define DAS 150
#define ARR 50
#define GARBAGE_DELAY 1000
#define MAX_GARBAGE 4
#define FLASH 380
#define SETTLE 140
#define SEND_Q8 115         /* x0.45 */

#define FX 4
#define FY 1

enum { ST_FALL, ST_FLASH, ST_SETTLE, ST_OVER };
static const BYTE KPAL[NC] = { PAL_RED, PAL_CYAN, PAL_LIME, PAL_YELLOW, PAL_PINK, PAL_WHITE };
static const SBYTE DIRS[4][2] = { {0,1}, {1,0}, {1,1}, {1,-1} };

#define J (&t->u.j)
typedef SBYTE Grid[ROWS][COLS];

/* ---------------------------------------------------------------- rules */
static BYTE find_matches(Grid g, BYTE hit[ROWS][COLS])
{
    int r, c, d, n, rr, cc, pr, pc, i, count = 0;
    SBYTE k;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        k = g[r][c];
        if (k < 0 || k >= NC) continue;
        for (d = 0; d < 4; d++) {
            pr = r - DIRS[d][0]; pc = c - DIRS[d][1];
            if (pr >= 0 && pr < ROWS && pc >= 0 && pc < COLS && g[pr][pc] == k) continue;
            n = 0; rr = r; cc = c;
            while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && g[rr][cc] == k) { n++; rr += DIRS[d][0]; cc += DIRS[d][1]; }
            if (n >= 3) for (i = 0; i < n; i++) hit[r + DIRS[d][0] * i][c + DIRS[d][1] * i] = 1;
        }
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) count += hit[r][c];
    return (BYTE)count;
}

static BYTE clear_hits(Grid g, BYTE hit[ROWS][COLS])
{
    int r, c, broke = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
        if (r + 1 < ROWS && g[r + 1][c] == ROCK && !hit[r + 1][c]) { g[r + 1][c] = -2; broke++; }
        if (r > 0 && g[r - 1][c] == ROCK && !hit[r - 1][c]) { g[r - 1][c] = -2; broke++; }
        if (c + 1 < COLS && g[r][c + 1] == ROCK && !hit[r][c + 1]) { g[r][c + 1] = -2; broke++; }
        if (c > 0 && g[r][c - 1] == ROCK && !hit[r][c - 1]) { g[r][c - 1] = -2; broke++; }
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c] || g[r][c] == -2) g[r][c] = -1;
    return (BYTE)broke;
}

static void gravity(Grid g)
{
    int c, r, w;
    SBYTE v;
    for (c = 0; c < COLS; c++) {
        w = ROWS - 1;
        for (r = ROWS - 1; r >= 0; r--) if (g[r][c] >= 0) { v = g[r][c]; g[r][c] = -1; g[w--][c] = v; }
    }
}

static int col_h(Grid g, int c) { int r; for (r = 0; r < ROWS; r++) if (g[r][c] >= 0) return ROWS - r; return 0; }
static WORD step_units(BYTE step, BYTE count) { return (WORD)((step - 1) + (count >= 5 ? 1 : 0) + (count >= 8 ? 1 : 0)); }

/* ---------------------------------------------------------------- the track */
static void new_gems(Track *t, BYTE *a) { int i; for (i = 0; i < 3; i++) a[i] = (BYTE)trk_rnd(t, NC); }

static void die(Track *t) { if (!t->dead) { t->dead = 1; J->state = ST_OVER; trk_sfx(t, S_KO); } }

static void spawn(Track *t)
{
    int i;
    J->hasPiece = 1; J->pc = SPAWN_C; J->pr = -3; J->pieceNo++;
    for (i = 0; i < 3; i++) J->gems[i] = J->next[i];
    new_gems(t, J->next);
    J->fallT = 0; J->lockT = 0; J->dasDir = 0;
    if (J->grid[0][SPAWN_C] >= 0) die(t);
}

static BYTE cell_free(const Track *t, int r, int c) { return (BYTE)(c >= 0 && c < COLS && r < ROWS && (r < 0 || J->grid[r][c] < 0)); }
static BYTE fits(const Track *t, int r, int c) { return (BYTE)(cell_free(t, r, c) && cell_free(t, r + 1, c) && cell_free(t, r + 2, c)); }
static BYTE landed(const Track *t) { return (BYTE)!fits(t, J->pr + 1, J->pc); }
static SBYTE drop_row(const Track *t) { int r = J->pr; while (fits(t, r + 1, J->pc)) r++; return (SBYTE)r; }
static WORD speed(const Track *t)
{
    DWORD e = J->elapsed; WORD s = FALL;
    while (e >= SPEEDUP && s > FALL_MIN) { e -= SPEEDUP; s = (WORD)(s - FALL_STEP); }
    return s < FALL_MIN ? FALL_MIN : s;
}

static BYTE shift(Track *t, int dx)
{
    if (!fits(t, J->pr, J->pc + dx)) return 0;
    J->pc = (BYTE)(J->pc + dx); J->lockT = 0; trk_sfx(t, S_MOVE);
    return 1;
}
static void cycle(Track *t, int dir)
{
    BYTE *g = J->gems, v;
    if (dir > 0) { v = g[2]; g[2] = g[1]; g[1] = g[0]; g[0] = v; }
    else { v = g[0]; g[0] = g[1]; g[1] = g[2]; g[2] = v; }
    trk_sfx(t, S_ROTATE);
}

static void land_garbage(Track *t)
{
    Batch bs[8];
    BYTE nb, k, i;
    int r, c;
    if (!t->vs) return;
    nb = trk_take_ready(t, GARBAGE_DELAY, MAX_GARBAGE, bs, 8);
    if (!nb) return;
    for (k = 0; k < nb; k++) {
        int gap = (int)(((DWORD)bs[k].gap * COLS) / 1000) % COLS;
        for (i = 0; i < bs[k].n; i++) {
            for (c = 0; c < COLS; c++) if (J->grid[0][c] >= 0) { die(t); return; }
            for (r = 0; r < ROWS - 1; r++) for (c = 0; c < COLS; c++) J->grid[r][c] = J->grid[r + 1][c];
            for (c = 0; c < COLS; c++) J->grid[ROWS - 1][c] = (SBYTE)(c == gap ? -1 : ROCK);
        }
    }
    gravity(J->grid);
    trk_sfx(t, S_GARBAGE);
}

static void finish_resolve(Track *t)
{
    if (t->vs && J->attack) {
        WORD out;
        J->atkFrac = (WORD)(J->atkFrac + J->attack * SEND_Q8);
        out = (WORD)(J->atkFrac >> 8); J->atkFrac &= 255;
        trk_send(t, out);
    }
    if (J->overflow && !J->chain) { die(t); return; }
    if (!J->chain || !t->vs) land_garbage(t);
    if (t->dead) return;
    J->state = ST_FALL;
    spawn(t);
}

static void resolve_check(Track *t)
{
    BYTE count = find_matches(J->grid, J->hits);
    if (!count) { finish_resolve(t); return; }
    J->chain++;
    J->jewels = (WORD)(J->jewels + count);
    J->score += (DWORD)count * 10 * J->chain * J->chain;
    J->attack = (BYTE)(J->attack + step_units(J->chain, count));
    if (J->chain > 1 || count >= 5) t->bigMark = 1;
    if (J->chain > 1) trk_say(t, "CHAIN!", PAL_YELLOW);
    else if (count >= 5) trk_say(t, "BIG MATCH", PAL_CYAN);
    trk_sfx(t, J->chain > 1 ? S_BIG : S_CLEAR);
    J->state = ST_FLASH; J->phaseT = FLASH;
}

static void lock(Track *t)
{
    int i, r;
    BYTE over = 0;
    for (i = 0; i < 3; i++) { r = J->pr + i; if (r < 0) over = 1; else J->grid[r][J->pc] = (SBYTE)J->gems[i]; }
    J->hasPiece = 0;
    trk_sfx(t, S_LOCK);
    J->overflow = over; J->chain = 0; J->attack = 0;
    resolve_check(t);
}

static void handle(Track *t, Pad *pad, WORD dt)
{
    WORD rate;
    BYTE held;
    if (PAD_PRESSED(pad, B_A)) cycle(t, 1);
    if (PAD_PRESSED(pad, B_B)) cycle(t, -1);
    if (PAD_PRESSED(pad, B_D) || PAD_PRESSED(pad, B_UP)) { J->pr = drop_row(t); trk_sfx(t, S_HARD); lock(t); return; }
    if (PAD_PRESSED(pad, B_LEFT)) { J->dasDir = -1; J->dasT = 0; shift(t, -1); }
    else if (PAD_PRESSED(pad, B_RIGHT)) { J->dasDir = 1; J->dasT = 0; shift(t, 1); }
    held = (BYTE)(J->dasDir < 0 ? PAD_DOWN(pad, B_LEFT) : J->dasDir > 0 ? PAD_DOWN(pad, B_RIGHT) : 0);
    if (held) {
        J->dasT = (WORD)(J->dasT + dt);
        while (J->dasT >= DAS + ARR) { J->dasT = (WORD)(J->dasT - ARR); if (!shift(t, J->dasDir)) break; }
    } else J->dasDir = 0;
    rate = speed(t);
    if (PAD_DOWN(pad, B_DOWN) && rate > SOFT) rate = SOFT;
    if (landed(t)) {
        J->lockT = (WORD)(J->lockT + dt);
        if (J->lockT >= LOCK_DELAY) lock(t);
    } else {
        J->fallT = (WORD)(J->fallT + dt);
        while (J->fallT >= rate && !landed(t)) { J->fallT = (WORD)(J->fallT - rate); J->pr++; if (PAD_DOWN(pad, B_DOWN)) J->score++; }
    }
}

BYTE jewel_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int r, c;
    w &= 0x7f;
    if (w == W_WIPE) { if (!q) for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) J->grid[r][c] = -1; return 1; }
    if (w == W_REMOVE) {
        if (!q) {
            for (r = ROWS - 1; r > 0; r--) for (c = 0; c < COLS; c++) J->grid[r][c] = J->grid[r - 1][c];
            for (c = 0; c < COLS; c++) J->grid[0][c] = -1;
        }
        return 1;
    }
    return 0;
}
BYTE jewel_safe(const Track *t) { return (BYTE)(J->state == ST_FALL); }
void jewel_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = COLS * 2; *h = ROWS * 2; }

static const WORD THINK[9] = { 0, 900, 750, 600, 480, 380, 300, 220, 150 };
static const WORD STEP[9] = { 0, 220, 180, 150, 120, 100, 80, 65, 50 };
static const BYTE MISTAKE[9] = { 0, 40, 30, 22, 15, 10, 6, 3, 1 };

void jewel_init(Track *t)
{
    int r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) J->grid[r][c] = -1;
    J->state = ST_FALL;
    new_gems(t, J->next);
    spawn(t);
    if (t->cpu) { J->cpu.level = t->cpu; J->cpu.wait = THINK[t->cpu]; }
}

void jewel_update(Track *t, Pad *pad, WORD dt)
{
    BYTE broke;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    J->elapsed += dt;
    if (J->state == ST_FALL) { if (J->hasPiece) handle(t, pad, dt); }
    else if (J->state == ST_FLASH) {
        J->phaseT = (SWORD)(J->phaseT - dt);
        if (J->phaseT <= 0) {
            broke = clear_hits(J->grid, J->hits);
            if (broke) trk_say(t, broke > 1 ? "ROCKS" : "ROCK", PAL_BEIGE);
            gravity(J->grid);
            J->state = ST_SETTLE; J->phaseT = SETTLE;
        }
    } else if (J->state == ST_SETTLE) {
        J->phaseT = (SWORD)(J->phaseT - dt);
        if (J->phaseT <= 0) resolve_check(t);
    }
}

/* ---------------------------------------------------------------- CPU */
typedef struct { BYTE chain, units, cleared, over; } Sim;

static void simulate(Grid src, Grid g, int c, const BYTE *gems, Sim *s)
{
    BYTE hit[ROWS][COLS], m;
    int r, top = -1, i, r0;
    for (r = 0; r < ROWS; r++) for (i = 0; i < COLS; i++) g[r][i] = src[r][i];
    for (r = 0; r < ROWS; r++) { if (g[r][c] >= 0) break; top = r; }
    r0 = top - 2; s->over = 0;
    for (i = 0; i < 3; i++) { if (r0 + i < 0) s->over = 1; else g[r0 + i][c] = (SBYTE)gems[i]; }
    s->chain = 0; s->units = 0; s->cleared = 0;
    for (;;) {
        m = find_matches(g, hit);
        if (!m) break;
        s->chain++; s->cleared = (BYTE)(s->cleared + m); s->units = (BYTE)(s->units + step_units(s->chain, m));
        clear_hits(g, hit); gravity(g);
    }
    if (s->chain) s->over = 0;
}

static SDWORD eval_board(Grid g)
{
    int hs[COLS], c, r, d, max = 0, bump = 0, pairs = 0, h;
    SDWORD danger = 0;
    for (c = 0; c < COLS; c++) { h = col_h(g, c); hs[c] = h; if (h > max) max = h; if (c) bump += h > hs[c - 1] ? h - hs[c - 1] : hs[c - 1] - h; }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        SBYTE k = g[r][c];
        if (k < 0 || k >= NC) continue;
        for (d = 0; d < 4; d++) {
            int r2 = r + DIRS[d][0], c2 = c + DIRS[d][1];
            if (r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] == k) pairs++;
        }
    }
    if (max > ROWS - 4) danger = (SDWORD)(max - (ROWS - 4)) * 60;
    if (hs[SPAWN_C] > ROWS - 4) danger += 200;
    return (SDWORD)pairs * 3 - max * 4 - bump * 2 - danger;
}

static void cpu_eval_one(Track *t)
{
    JewelCpu *k = &J->cpu;
    Grid g, g2;
    Sim s, s2;
    BYTE gems[3];
    int c = k->cand / 3, rot = k->cand % 3, i, c2;
    SDWORD sc, bestN = -100000L;
    for (i = 0; i < 3; i++) gems[i] = J->gems[(i + rot) % 3];
    simulate(J->grid, g, c, gems, &s);
    if (s.over) { k->sc[k->cand] = -1000000L; k->cand++; return; }
    sc = (SDWORD)s.cleared * 8 + (SDWORD)s.units * 40 + (SDWORD)s.chain * 15 + eval_board(g);
    if (k->level >= 9) {
        for (c2 = 0; c2 < COLS; c2++) {
            simulate(g, g2, c2, J->next, &s2);
            if (!s2.over) { SDWORD v = (SDWORD)s2.cleared * 6 + (SDWORD)s2.units * 30; if (v > bestN) bestN = v; }
        }
        if (bestN > -100000L) sc += bestN / 2;
    }
    k->sc[k->cand] = sc;
    if (!k->have || sc > k->bestSc) { k->bestSc = sc; k->bestC = (BYTE)c; k->bestRot = (BYTE)rot; k->have = 1; }
    k->cand++;
}

void jewel_cpu(Track *t, Pad *pad, WORD dt)
{
    JewelCpu *k = &J->cpu;
    WORD st = 0;
    if (J->state != ST_FALL || !J->hasPiece || k->seen != J->pieceNo) {
        k->pass = 0; k->seen = J->pieceNo;
        k->wait = (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
        if (J->state != ST_FALL || !J->hasPiece) { pad_feed(pad, 0, dt); return; }
    }
    if (!k->pass) { k->pass = 1; k->cand = 0; k->have = 0; }
    if (k->pass == 1 && xm_think) {
        do cpu_eval_one(t); while (k->cand < 18 && xm_time_ok());
        if (k->cand >= 18) {
            k->pass = 2;
            if (!k->have) { k->bestC = J->pc; k->bestRot = 0; }
            else if (trk_rnd(t, 100) < MISTAKE[k->level]) {
                /* one of the next few best, not a random column */
                SDWORD lim = k->bestSc; int i, pick = 1 + trk_rnd(t, 3), n;
                for (n = 0; n < pick; n++) {
                    SDWORD b = -2000000L; int bi = -1;
                    for (i = 0; i < 18; i++) if (k->sc[i] < lim && k->sc[i] > b && k->sc[i] > -1000000L) { b = k->sc[i]; bi = i; }
                    if (bi < 0) break;
                    lim = b; k->bestC = (BYTE)(bi / 3); k->bestRot = (BYTE)(bi % 3);
                }
            }
            k->rot = k->bestRot; k->c = k->bestC;
        }
    }
    if (k->tap) { k->tap = 0; pad_feed(pad, 0, dt); return; }
    if (k->wait > dt) { k->wait = (WORD)(k->wait - dt); pad_feed(pad, 0, dt); return; }
    k->wait = 0;
    if (k->pass != 2) { pad_feed(pad, 0, dt); return; }
    if (k->rot > 0) { st = B_B; k->rot--; }
    else if (J->pc < k->c) st = B_RIGHT;
    else if (J->pc > k->c) st = B_LEFT;
    else st = B_D;
    if ((st == B_LEFT || st == B_RIGHT) && !fits(t, J->pr, J->pc + (st == B_LEFT ? -1 : 1))) st = B_D;
    k->tap = 1; k->wait = STEP[k->level];
    pad_feed(pad, st, dt);
}

/* ---------------------------------------------------------------- drawing */
static void gem(int x, int y, SBYTE k)
{
    if (k == ROCK) cv_cell16(x, y, PAL_GREY, C_STONE, 0);
    else cv_cell16(x, y, KPAL[k], C_SQ(k), 0);
}

void jewel_draw(Track *t, int ox)
{
    int r, c, i, fx = ox + FX;
    BYTE flashOn = (BYTE)((J->phaseT >> 6) & 1);
    for (r = 0; r < ROWS * 2; r++) { cv_put(fx - 1, FY + r, TW(PAL_STEEL, TB3(T_FR_L))); cv_put(fx + COLS * 2, FY + r, TW(PAL_STEEL, TB3(T_FR_R))); }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        SBYTE k = J->grid[r][c];
        if (k < 0) { cv_cell16(fx + c * 2, FY + r * 2, PAL_STEEL, C_EMPTY16, 0); continue; }
        if (J->state == ST_FLASH && J->hits[r][c] && flashOn) { cv_cell16(fx + c * 2, FY + r * 2, PAL_WHITE, C_FLASH, 0); continue; }
        gem(fx + c * 2, FY + r * 2, k);
    }
    if (J->hasPiece && !t->dead) {
        SBYTE dr = drop_row(t);
        for (i = 0; i < 3; i++) if (dr + i >= 0 && dr + i != J->pr + i) cv_put(fx + J->pc * 2, FY + (dr + i) * 2 + 1, TW(KPAL[J->gems[i]], TB3(T_DOT)));
        for (i = 0; i < 3; i++) if (J->pr + i >= 0) gem(fx + J->pc * 2, FY + (J->pr + i) * 2, (SBYTE)J->gems[i]);
    }
    /* next */
    cv_text(ox + 17, FY, PAL_BEIGE, "NX");
    for (i = 0; i < 3; i++) gem(ox + 17, FY + 1 + i * 2, (SBYTE)((J->hasPiece && J->pr < 0) ? J->gems[i] : J->next[i]));
    cv_text(ox + 17, FY + 9, PAL_GREY, "JW");
    cv_text(ox + 17, FY + 10, PAL_AMBER, cv_num(J->jewels));
    cv_pending(ox + 2, FY, ROWS * 2, t, 16, GARBAGE_DELAY);
}
