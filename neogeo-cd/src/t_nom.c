/*
 * NOM NOM! PETS: Baku Baku-style pets and food (js/track-nomnom.js).
 * Pairs of blocks fall: foods and pets' heads (dog + bone, cat + fish,
 * bunny + carrot, mouse + cheese).  A head touching its own food eats it and
 * all matching food connected to it.  A coin clears every block of the kind it
 * lands on.  Incoming units drop wrapped food (5 per unit) that unwraps when
 * something next to it is eaten.
 */
#include "xm.h"
#include "tiles.h"

#define COLS NM_COLS
#define ROWS NM_ROWS
#define EMPTY NM_EMPTY
#define COIN NM_COIN
#define NK 4
#define SPAWN_C 2
#define FALL 850
#define FALL_MIN 130
#define FALL_STEP 65
#define SPEEDUP 30000UL
#define SOFT 45
#define LOCK_DELAY 400
#define DAS 150
#define ARR 50
#define GARBAGE_DELAY 1000
#define MAX_GARBAGE 4
#define PER_UNIT 5
#define FLASH 380
#define SETTLE 140
#define SEND_Q8 33          /* x0.13 */

#define FX 4
#define FY 1

enum { ST_FALL, ST_FLASH, ST_SETTLE, ST_OVER };
static const BYTE TINT[NK] = { PAL_ORANGE, PAL_BLUE, PAL_PINK, PAL_YELLOW };
static const SBYTE OFS[4][2] = { {-1,0}, {0,1}, {1,0}, {0,-1} };

#define N (&t->u.n)
typedef BYTE Grid[ROWS][COLS];
typedef BYTE Map[ROWS][COLS];

static BYTE is_food(BYTE v) { return (BYTE)(v < NK); }
static BYTE is_head(BYTE v) { return (BYTE)(v >= 10 && v < 10 + NK); }
static BYTE is_wrap(BYTE v) { return (BYTE)(v >= 20 && v < 20 + NK); }
static SBYTE kind_of(BYTE v) { return (SBYTE)(is_food(v) ? v : is_head(v) ? v - 10 : is_wrap(v) ? v - 20 : -1); }
static int col_h(Grid g, int c) { int r; for (r = 0; r < ROWS; r++) if (g[r][c] != EMPTY) return ROWS - r; return 0; }

static BYTE gravity(Grid g)
{
    int c, r, w;
    BYTE moved = 0, v;
    for (c = 0; c < COLS; c++) {
        w = ROWS - 1;
        for (r = ROWS - 1; r >= 0; r--) if (g[r][c] != EMPTY) { v = g[r][c]; g[r][c] = EMPTY; if (w != r) moved = 1; g[w--][c] = v; }
    }
    return moved;
}

/* one resolve step; returns 1 if anything is hit */
static BYTE find_eats(Grid g, Map hit, int *eaten, int *coinHits)
{
    static const SBYTE O[4][2] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
    SBYTE st[ROWS * COLS][2];
    int r, c, r2, c2, d, sn, any = 0;
    SBYTE k;
    *eaten = 0; *coinHits = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (g[r][c] == COIN) {
        hit[r][c] = 1; any = 1;
        k = r + 1 < ROWS ? kind_of(g[r + 1][c]) : -1;
        if (k >= 0) for (r2 = 0; r2 < ROWS; r2++) for (c2 = 0; c2 < COLS; c2++) if (kind_of(g[r2][c2]) == k && !hit[r2][c2]) { hit[r2][c2] = 1; (*coinHits)++; }
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        BYTE v = g[r][c], kk, ate = 0;
        if (!is_head(v) || hit[r][c]) continue;
        kk = (BYTE)(v - 10); sn = 0;
        for (d = 0; d < 4; d++) { r2 = r + O[d][0]; c2 = c + O[d][1]; if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] == kk) { st[sn][0] = (SBYTE)r2; st[sn][1] = (SBYTE)c2; sn++; } }
        while (sn) {
            int pr, pc;
            sn--; pr = st[sn][0]; pc = st[sn][1];
            if (hit[pr][pc]) continue;
            hit[pr][pc] = 1; ate = 1; (*eaten)++;
            for (d = 0; d < 4; d++) { r2 = pr + O[d][0]; c2 = pc + O[d][1]; if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && g[r2][c2] == kk && !hit[r2][c2] && sn < ROWS * COLS) { st[sn][0] = (SBYTE)r2; st[sn][1] = (SBYTE)c2; sn++; } }
        }
        if (ate) { hit[r][c] = 1; (*eaten)++; any = 1; }
    }
    return (BYTE)(any || *eaten || *coinHits);
}

static int clear_hits(Grid g, Map hit)
{
    int r, c, un = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
#define UNWRAP(rr, cc) if ((rr) >= 0 && (rr) < ROWS && (cc) >= 0 && (cc) < COLS && !hit[rr][cc] && is_wrap(g[rr][cc])) { g[rr][cc] = (BYTE)(g[rr][cc] - 20); un++; }
        UNWRAP(r + 1, c) UNWRAP(r - 1, c) UNWRAP(r, c + 1) UNWRAP(r, c - 1)
#undef UNWRAP
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) g[r][c] = EMPTY;
    return un;
}

/* units for one chain step, Q8: eaten/3 + (step-1)*1.5 + coinHits/4 */
static WORD step_units_q8(int step, int eaten, int coinHits)
{
    return (WORD)((eaten * 256) / 3 + (step - 1) * 384 + coinHits * 64);
}

/* ---------------------------------------------------------------- the track */
static void die(Track *t) { if (!t->dead) { t->dead = 1; N->state = ST_OVER; trk_sfx(t, S_KO); } }

static BYTE new_block(Track *t)
{
    WORD x = trk_rnd(t, 1000), k = trk_rnd(t, NK), ho = 270;
    DWORD e = N->elapsed;
    while (e >= SPEEDUP && ho > 160) { e -= SPEEDUP; ho = (WORD)(ho - 15); }
    if (ho < 160) ho = 160;
    if (x < 25) return COIN;
    return (BYTE)(x < 25 + ho ? 10 + k : k);
}
static void new_pair(Track *t, BYTE *p)
{
    p[0] = new_block(t); p[1] = new_block(t);
    if (p[0] == COIN && p[1] == COIN) p[1] = (BYTE)trk_rnd(t, NK);
}

static void spawn(Track *t)
{
    N->hasPiece = 1; N->pr = 1; N->pc = SPAWN_C; N->prot = 0; N->pieceNo++;
    N->b[0] = N->next[0]; N->b[1] = N->next[1];
    new_pair(t, N->next);
    N->fallT = 0; N->lockT = 0; N->dasDir = 0;
    if (N->grid[1][SPAWN_C] != EMPTY || N->grid[0][SPAWN_C] != EMPTY) die(t);
}

static BYTE cell_free(const Track *t, int r, int c) { return (BYTE)(c >= 0 && c < COLS && r < ROWS && (r < 0 || N->grid[r][c] == EMPTY)); }
static BYTE fits(const Track *t, int r, int c, int rot) { return (BYTE)(cell_free(t, r, c) && cell_free(t, r + OFS[rot][0], c + OFS[rot][1])); }
static BYTE landed(const Track *t) { return (BYTE)!fits(t, N->pr + 1, N->pc, N->prot); }
static SBYTE drop_row(const Track *t) { int r = N->pr; while (fits(t, r + 1, N->pc, N->prot)) r++; return (SBYTE)r; }
static WORD speed(const Track *t)
{
    DWORD e = N->elapsed; WORD s = FALL;
    while (e >= SPEEDUP && s > FALL_MIN) { e -= SPEEDUP; s = (WORD)(s - FALL_STEP); }
    return s < FALL_MIN ? FALL_MIN : s;
}

static BYTE shift(Track *t, int dx)
{
    if (!fits(t, N->pr, N->pc + dx, N->prot)) return 0;
    N->pc = (BYTE)(N->pc + dx); N->lockT = 0; trk_sfx(t, S_MOVE);
    return 1;
}

static BYTE rotate(Track *t, int dir)
{
    int nr = (N->prot + dir + 4) & 3, i, fr;
    SBYTE tries[4][2];
    tries[0][0] = 0; tries[0][1] = 0;
    tries[1][0] = 0; tries[1][1] = (SBYTE)-OFS[nr][1];
    tries[2][0] = (SBYTE)-OFS[nr][0]; tries[2][1] = 0;
    tries[3][0] = -1; tries[3][1] = 0;
    for (i = 0; i < 4; i++) if (fits(t, N->pr + tries[i][0], N->pc + tries[i][1], nr)) {
        N->pr = (SBYTE)(N->pr + tries[i][0]); N->pc = (BYTE)(N->pc + tries[i][1]); N->prot = (BYTE)nr; N->lockT = 0;
        trk_sfx(t, S_ROTATE); return 1;
    }
    fr = (N->prot + 2) & 3;
    if (fits(t, N->pr, N->pc, fr) || fits(t, N->pr - 1, N->pc, fr)) {
        if (!fits(t, N->pr, N->pc, fr)) N->pr--;
        N->prot = (BYTE)fr; trk_sfx(t, S_ROTATE); return 1;
    }
    return 0;
}

static void land_garbage(Track *t)
{
    Batch bs[8];
    BYTE nb, k, any = 0;
    int i, n, c, h, start;
    if (!t->vs) return;
    nb = trk_take_ready(t, GARBAGE_DELAY, MAX_GARBAGE, bs, 8);
    for (k = 0; k < nb; k++) {
        start = (int)(((DWORD)bs[k].gap * COLS) / 1000) % COLS;
        n = bs[k].n * PER_UNIT;
        for (i = 0; i < n; i++) {
            c = (start + i * 2 + i / 3) % COLS;
            h = col_h(N->grid, c);
            if (h >= ROWS) { die(t); return; }
            N->grid[ROWS - 1 - h][c] = (BYTE)(20 + trk_rnd(t, NK));
            any = 1;
        }
    }
    if (any) trk_sfx(t, S_GARBAGE);
}

static void finish_resolve(Track *t)
{
    if (N->chain > 1 || N->eatNow >= 7 || N->coinNow >= 6) t->bigMark = 1;
    if (t->vs && N->attackQ8) {
        WORD out;
        DWORD a = (DWORD)N->atkFrac + (((DWORD)N->attackQ8 * SEND_Q8) >> 8);
        out = (WORD)(a >> 8); N->atkFrac = (WORD)(a & 255);
        trk_send(t, out);
    }
    if (N->overflow && !N->chain) { die(t); return; }
    if (!N->chain || !t->vs) land_garbage(t);
    if (t->dead) return;
    N->state = ST_FALL;
    spawn(t);
}

static void resolve_check(Track *t)
{
    int eaten, coinHits;
    BYTE any = find_eats(N->grid, N->hits, &eaten, &coinHits), real;
    if (!any) { finish_resolve(t); return; }
    real = (BYTE)(eaten + coinHits > 0);
    if (real) {
        N->chain++;
        N->eaten = (WORD)(N->eaten + eaten + coinHits);
        N->eatNow = (BYTE)(N->eatNow + eaten); N->coinNow = (BYTE)(N->coinNow + coinHits);
        N->score += (DWORD)(eaten + coinHits) * 10 * N->chain * N->chain;
        N->attackQ8 = (WORD)(N->attackQ8 + step_units_q8(N->chain, eaten, coinHits));
        if (N->chain > 1) trk_say(t, "CHAIN!", PAL_YELLOW);
        else if (coinHits) trk_say(t, "COIN!", PAL_AMBER);
        else if (eaten >= 7) trk_say(t, "NOM NOM!", PAL_PINK);
        trk_sfx(t, N->chain > 1 || coinHits >= 6 ? S_BIG : S_CLEAR);
    }
    N->state = ST_FLASH; N->phaseT = real ? FLASH : 120;
}

static void lock(Track *t)
{
    int r2 = N->pr + OFS[N->prot][0], c2 = N->pc + OFS[N->prot][1];
    BYTE over = 0;
    if (N->pr < 0) over = 1; else N->grid[N->pr][N->pc] = N->b[0];
    if (r2 < 0) over = 1; else N->grid[r2][c2] = N->b[1];
    N->hasPiece = 0;
    trk_sfx(t, S_LOCK);
    N->overflow = over;
    N->chain = 0; N->attackQ8 = 0; N->eatNow = 0; N->coinNow = 0;
    if (gravity(N->grid)) { N->state = ST_SETTLE; N->phaseT = SETTLE; }
    else resolve_check(t);
}

static void handle(Track *t, Pad *pad, WORD dt)
{
    WORD rate;
    BYTE held;
    if (PAD_PRESSED(pad, B_A)) rotate(t, -1);
    if (PAD_PRESSED(pad, B_B)) rotate(t, 1);
    if (PAD_PRESSED(pad, B_D) || PAD_PRESSED(pad, B_UP)) { N->pr = drop_row(t); trk_sfx(t, S_HARD); lock(t); return; }
    if (PAD_PRESSED(pad, B_LEFT)) { N->dasDir = -1; N->dasT = 0; shift(t, -1); }
    else if (PAD_PRESSED(pad, B_RIGHT)) { N->dasDir = 1; N->dasT = 0; shift(t, 1); }
    held = (BYTE)(N->dasDir < 0 ? PAD_DOWN(pad, B_LEFT) : N->dasDir > 0 ? PAD_DOWN(pad, B_RIGHT) : 0);
    if (held) {
        N->dasT = (WORD)(N->dasT + dt);
        while (N->dasT >= DAS + ARR) { N->dasT = (WORD)(N->dasT - ARR); if (!shift(t, N->dasDir)) break; }
    } else N->dasDir = 0;
    rate = speed(t);
    if (PAD_DOWN(pad, B_DOWN) && rate > SOFT) rate = SOFT;
    if (landed(t)) {
        N->lockT = (WORD)(N->lockT + dt);
        if (N->lockT >= LOCK_DELAY) lock(t);
    } else {
        N->fallT = (WORD)(N->fallT + dt);
        while (N->fallT >= rate && !landed(t)) { N->fallT = (WORD)(N->fallT - rate); N->pr++; if (PAD_DOWN(pad, B_DOWN)) N->score++; }
    }
}

BYTE nom_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int r, c;
    w &= 0x7f;
    if (w == W_WIPE) { if (!q) for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) N->grid[r][c] = EMPTY; return 1; }
    if (w == W_REMOVE) {
        if (!q) {
            for (r = ROWS - 1; r > 0; r--) for (c = 0; c < COLS; c++) N->grid[r][c] = N->grid[r - 1][c];
            for (c = 0; c < COLS; c++) N->grid[0][c] = EMPTY;
            gravity(N->grid);
        }
        return 1;
    }
    return 0;
}
BYTE nom_safe(const Track *t) { return (BYTE)(N->state == ST_FALL); }
void nom_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = COLS * 2; *h = ROWS * 2; }

static const WORD THINK[9] = { 0, 900, 750, 600, 480, 380, 300, 220, 150 };
static const WORD STEP[9] = { 0, 220, 180, 150, 120, 100, 80, 65, 50 };
static const BYTE MISTAKE[9] = { 0, 40, 30, 22, 15, 10, 6, 3, 1 };

void nom_init(Track *t)
{
    int r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) N->grid[r][c] = EMPTY;
    N->state = ST_FALL;
    new_pair(t, N->next);
    spawn(t);
    if (t->cpu) { N->cpu.level = t->cpu; N->cpu.wait = THINK[t->cpu]; }
}

void nom_update(Track *t, Pad *pad, WORD dt)
{
    int un;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    N->elapsed += dt;
    if (N->state == ST_FALL) { if (N->hasPiece) handle(t, pad, dt); }
    else if (N->state == ST_FLASH) {
        N->phaseT = (SWORD)(N->phaseT - dt);
        if (N->phaseT <= 0) {
            un = clear_hits(N->grid, N->hits);
            if (un) trk_say(t, un > 1 ? "UNWRAPPED" : "UNWRAP", PAL_BEIGE);
            gravity(N->grid);
            N->state = ST_SETTLE; N->phaseT = SETTLE;
        }
    } else if (N->state == ST_SETTLE) {
        N->phaseT = (SWORD)(N->phaseT - dt);
        if (N->phaseT <= 0) resolve_check(t);
    }
}

/* ---------------------------------------------------------------- CPU */
typedef struct { int chain, ate, over; WORD unitsQ8; } Sim;

static BYTE simulate(Grid src, Grid g, int c, int rot, const BYTE *pair, Sim *s)
{
    static Map hit;
    int c2 = c + OFS[rot][1], i, r, cc, h, eaten, coinHits;
    int oc[2]; BYTE ov[2];
    if (c < 0 || c >= COLS || c2 < 0 || c2 >= COLS) return 0;
    for (r = 0; r < ROWS; r++) for (cc = 0; cc < COLS; cc++) g[r][cc] = src[r][cc];
    if (OFS[rot][0] > 0) { oc[0] = c2; ov[0] = pair[1]; oc[1] = c; ov[1] = pair[0]; }
    else { oc[0] = c; ov[0] = pair[0]; oc[1] = c2; ov[1] = pair[1]; }
    for (i = 0; i < 2; i++) {
        h = col_h(g, oc[i]);
        if (h >= ROWS) return 0;
        g[ROWS - 1 - h][oc[i]] = ov[i];
    }
    s->chain = 0; s->ate = 0; s->unitsQ8 = 0;
    for (;;) {
        if (!find_eats(g, hit, &eaten, &coinHits)) break;
        if (eaten + coinHits) { s->chain++; s->ate += eaten + coinHits; s->unitsQ8 = (WORD)(s->unitsQ8 + step_units_q8(s->chain, eaten, coinHits)); }
        clear_hits(g, hit); gravity(g);
    }
    s->over = (g[1][SPAWN_C] != EMPTY || g[0][SPAWN_C] != EMPTY);
    return 1;
}

static SDWORD eval_board(Grid g)
{
    int hs[COLS], c, r, r2, max = 0, bump = 0, groups = 0, buried = 0, wraps = 0, h;
    SDWORD danger = 0;
    for (c = 0; c < COLS; c++) { h = col_h(g, c); hs[c] = h; if (h > max) max = h; if (c) bump += h > hs[c - 1] ? h - hs[c - 1] : hs[c - 1] - h; }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        BYTE v = g[r][c];
        if (v == EMPTY) continue;
        if (is_food(v)) {
            if (c + 1 < COLS && g[r][c + 1] == v) groups++;
            if (r + 1 < ROWS && g[r + 1][c] == v) groups++;
        } else if (is_wrap(v)) wraps++;
        else if (is_head(v)) for (r2 = r - 1; r2 >= 0 && g[r2][c] != EMPTY; r2--) buried++;
    }
    if (max > ROWS - 4) danger = (SDWORD)(max - (ROWS - 4)) * 60;
    if (hs[SPAWN_C] > ROWS - 3) danger += 300;
    return (SDWORD)groups * 3 - (buried * 3) / 2 - (wraps * 3) / 2 - max * 4 - bump * 2 - danger;
}

static void cpu_eval_one(Track *t)
{
    NomCpu *k = &N->cpu;
    static Grid g, g2;
    Sim s, s2;
    int c = k->cand >> 2, rot = k->cand & 3, c2, r2;
    SDWORD sc, bestN = -100000L, v;
    k->cand++;
    if (!simulate(N->grid, g, c, rot, N->b, &s) || s.over) return;
    sc = (SDWORD)s.ate * 8 + (((SDWORD)s.unitsQ8 * 40) >> 8) + (SDWORD)s.chain * 15 + eval_board(g);
    if (k->level >= 9) {
        for (c2 = 0; c2 < COLS; c2++) for (r2 = 0; r2 < 4; r2 += 2) {
            if (!simulate(g, g2, c2, r2, N->next, &s2) || s2.over) continue;
            v = (SDWORD)s2.ate * 6 + (((SDWORD)s2.unitsQ8 * 30) >> 8);
            if (v > bestN) bestN = v;
        }
        if (bestN > -100000L) sc += bestN / 2;
    }
    if (!k->have || sc > k->bestSc || (trk_rnd(t, 100) < MISTAKE[k->level] && trk_rnd(t, 4) == 0)) {
        k->bestSc = sc; k->bestC = (BYTE)c; k->bestRot = (BYTE)rot; k->have = 1;
    }
}

void nom_cpu(Track *t, Pad *pad, WORD dt)
{
    NomCpu *k = &N->cpu;
    WORD st = 0;
    if (N->state != ST_FALL || !N->hasPiece || k->seen != N->pieceNo) {
        k->cand = 0xff; k->seen = N->pieceNo;
        k->wait = (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
        if (N->state != ST_FALL || !N->hasPiece) { pad_feed(pad, 0, dt); return; }
    }
    if (k->cand == 0xff) { k->cand = 0; k->have = 0; k->turns = 0; }
    if (k->cand < COLS * 4 && xm_think) {
        cpu_eval_one(t);
        if (k->cand >= COLS * 4) { if (!k->have) { k->bestC = N->pc; k->bestRot = N->prot; } k->c = k->bestC; k->rot = k->bestRot; }
    }
    if (k->tap) { k->tap = 0; pad_feed(pad, 0, dt); return; }
    if (k->wait > dt) { k->wait = (WORD)(k->wait - dt); pad_feed(pad, 0, dt); return; }
    k->wait = 0;
    if (k->cand < COLS * 4) { pad_feed(pad, 0, dt); return; }
    if (N->prot != k->rot && k->turns < 6) { st = B_B; k->turns++; }
    else if (N->pc < k->c) st = B_RIGHT;
    else if (N->pc > k->c) st = B_LEFT;
    else st = B_D;
    if ((st == B_LEFT || st == B_RIGHT) && !fits(t, N->pr, N->pc + (st == B_LEFT ? -1 : 1), N->prot)) st = B_D;
    k->tap = 1; k->wait = STEP[k->level];
    pad_feed(pad, st, dt);
}

/* ---------------------------------------------------------------- drawing */
static void block(int x, int y, BYTE v)
{
    if (v == EMPTY) return;
    if (v == COIN) cv_cell16(x, y, PAL_AMBER, C_COIN, 0);
    else if (is_head(v)) cv_cell16(x, y, TINT[v - 10], C_HEAD(v - 10), 0);
    else if (is_wrap(v)) cv_cell16(x, y, TINT[v - 20], C_WRAP, 0);
    else cv_cell16(x, y, TINT[v], C_FOOD(v), 0);
}

void nom_draw(Track *t, int ox)
{
    int r, c, fx = ox + FX, y;
    BYTE flashOn = (BYTE)((N->phaseT >> 6) & 1);
    for (y = 0; y < ROWS * 2; y++) { cv_put(fx - 1, FY + y, TW(PAL_PINK, TB3(T_FR_L))); cv_put(fx + COLS * 2, FY + y, TW(PAL_PINK, TB3(T_FR_R))); }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        BYTE v = N->grid[r][c];
        if (v == EMPTY) { cv_cell16(fx + c * 2, FY + r * 2, PAL_STEEL, C_EMPTY16, 0); continue; }
        if (N->state == ST_FLASH && N->hits[r][c] && flashOn) { cv_cell16(fx + c * 2, FY + r * 2, PAL_WHITE, C_FLASH, 0); continue; }
        block(fx + c * 2, FY + r * 2, v);
    }
    cv_put(fx + SPAWN_C * 2, FY, TW(PAL_RED, TB3(T_DOT)));
    if (N->hasPiece && !t->dead) {
        int r2 = N->pr + OFS[N->prot][0], c2 = N->pc + OFS[N->prot][1];
        if (N->pr >= 0) block(fx + N->pc * 2, FY + N->pr * 2, N->b[0]);
        if (r2 >= 0) block(fx + c2 * 2, FY + r2 * 2, N->b[1]);
    }
    cv_text(ox + 17, FY, PAL_BEIGE, "NX");
    block(ox + 17, FY + 1, N->next[1]);
    block(ox + 17, FY + 3, N->next[0]);
    cv_text(ox + 17, FY + 7, PAL_GREY, "EAT");
    cv_text(ox + 17, FY + 8, PAL_PINK, cv_num(N->eaten));
    cv_pending(ox + 2, FY, ROWS * 2, t, 8, GARBAGE_DELAY);
}
