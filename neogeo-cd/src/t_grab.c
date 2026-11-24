/*
 * GRAB: Magical Drop-style grab-and-throw (js/track-grab.js).
 * Balls hang from the ceiling and new rows push down over time.  The grabber
 * pulls the lowest run of one colour out of a column (A, C or Down) and throws
 * them back up under any column (B, D or Up).  3+ of a colour in a column clears
 * with every touching ball of that colour; balls below a gap move up and can chain.
 */
#include "xm.h"
#include "tiles.h"

#define COLS GR_COLS
#define ROWS GR_ROWS
#define NC 5
#define PUSH_EVERY 9000
#define PUSH_MIN 2600
#define PUSH_STEP 600
#define SPEEDUP 20000UL
#define START_ROWS 5
#define DAS 150
#define ARR 55
#define GARBAGE_DELAY 1200
#define MAX_GARBAGE 3
#define ROWS_PER_UNIT_Q8 448   /* 1.75 */
#define FLASH 300
#define SETTLE 130
#define COMBO_WIN 1500
#define SEND_Q8 90             /* x0.35 */

#define FX 3
#define FY 1

enum { ST_PLAY, ST_FLASH, ST_SETTLE, ST_OVER };
static const BYTE KPAL[NC] = { PAL_RED, PAL_BLUE, PAL_GREEN, PAL_YELLOW, PAL_VIOLET };

#define G (&t->u.g)
typedef SBYTE Grid[ROWS][COLS];
typedef BYTE Map[ROWS][COLS];

static int col_h(Grid g, int c) { int h = 0; while (h < ROWS && g[h][c] >= 0) h++; return h; }
static int bottom_run(Grid g, int c, SBYTE *k)
{
    int h = col_h(g, c), n = 0;
    if (!h) return 0;
    *k = g[h - 1][c];
    while (h - 1 - n >= 0 && g[h - 1 - n][c] == *k) n++;
    return n;
}
static int grab_from(Grid g, int c, BYTE *hk, BYTE *hn)
{
    SBYTE k;
    int n = bottom_run(g, c, &k), h, i;
    if (!n || (*hn && k != (SBYTE)*hk)) return 0;
    h = col_h(g, c);
    for (i = 0; i < n; i++) g[h - 1 - i][c] = -1;
    *hk = (BYTE)k; *hn = (BYTE)(*hn + n);
    return n;
}
static BYTE throw_to(Grid g, int c, BYTE *hk, BYTE *hn, Map moved)
{
    int h = col_h(g, c), i, r, cc;
    if (!*hn || h + *hn > ROWS) return 0;
    for (r = 0; r < ROWS; r++) for (cc = 0; cc < COLS; cc++) moved[r][cc] = 0;
    for (i = 0; i < *hn; i++) { g[h + i][c] = (SBYTE)*hk; moved[h + i][c] = 1; }
    *hn = 0;
    return 1;
}
static int find_clears(Grid g, Map moved, Map hit)
{
    SBYTE stack[ROWS * COLS][2];
    int sn = 0, r, c, e, i, any, count = 0;
    SBYTE k;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (c = 0; c < COLS; c++) {
        r = 0;
        while (r < ROWS) {
            k = g[r][c];
            if (k < 0) { r++; continue; }
            e = r; while (e < ROWS && g[e][c] == k) e++;
            if (e - r >= 3) {
                any = 0; for (i = r; i < e; i++) if (moved[i][c]) any = 1;
                if (any) for (i = r; i < e; i++) if (!hit[i][c]) { hit[i][c] = 1; stack[sn][0] = (SBYTE)i; stack[sn][1] = (SBYTE)c; sn++; }
            }
            r = e;
        }
    }
    while (sn) {
        int pr, pc, d;
        static const SBYTE O[4][2] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
        sn--; pr = stack[sn][0]; pc = stack[sn][1]; k = g[pr][pc];
        for (d = 0; d < 4; d++) {
            int r2 = pr + O[d][0], c2 = pc + O[d][1];
            if (r2 >= 0 && r2 < ROWS && c2 >= 0 && c2 < COLS && !hit[r2][c2] && g[r2][c2] == k) { hit[r2][c2] = 1; stack[sn][0] = (SBYTE)r2; stack[sn][1] = (SBYTE)c2; sn++; }
        }
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) count += hit[r][c];
    return count;
}
static void clear_and_rise(Grid g, Map hit, Map moved)
{
    int c, r, w, gap;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) moved[r][c] = 0;
    for (c = 0; c < COLS; c++) {
        w = 0; gap = 0;
        for (r = 0; r < ROWS; r++) {
            if (hit[r][c]) { g[r][c] = -1; gap = 1; continue; }
            if (g[r][c] < 0) continue;
            if (w != r) { g[w][c] = g[r][c]; g[r][c] = -1; if (gap) moved[w][c] = 1; }
            w++;
        }
    }
}
/* units in Q8 */
static WORD step_units_q8(BYTE step, int count) { return (WORD)(((step - 1) + (count >= 6 ? 1 : 0) + (count >= 10 ? 1 : 0)) << 8); }
static WORD combo_units_q8(BYTE combo) { return (WORD)(combo >= 2 ? (combo - 1) * 128 : 0); }

/* ---------------------------------------------------------------- the track */
static void die(Track *t) { if (!t->dead) { t->dead = 1; G->state = ST_OVER; trk_sfx(t, S_KO); } }

static BYTE push_row(Track *t)
{
    int r, c, tries;
    SBYTE k;
    for (c = 0; c < COLS; c++) if (G->grid[ROWS - 1][c] >= 0) { die(t); return 0; }
    for (r = ROWS - 1; r > 0; r--) for (c = 0; c < COLS; c++) G->grid[r][c] = G->grid[r - 1][c];
    for (c = 0; c < COLS; c++) {
        tries = 0;
        do { k = (SBYTE)trk_rnd(t, NC); tries++; } while (tries < 4 && c >= 2 && G->grid[0][c - 1] == k && G->grid[0][c - 2] == k);
        G->grid[0][c] = k;
    }
    return 1;
}

static WORD push_every(const Track *t)
{
    DWORD e = G->elapsed; WORD v = PUSH_EVERY;
    while (e >= SPEEDUP && v > PUSH_MIN) { e -= SPEEDUP; v = (WORD)(v - PUSH_STEP); }
    return v < PUSH_MIN ? PUSH_MIN : v;
}

static BYTE move(Track *t, int dx)
{
    int p = G->pos + dx;
    if (p < 0 || p >= COLS) return 0;
    G->pos = (BYTE)p; trk_sfx(t, S_MOVE);
    return 1;
}

static void finish_resolve(Track *t)
{
    if (G->chain) {
        G->attackQ8 = (WORD)(G->attackQ8 + combo_units_q8(G->combo));
        if (G->chain > 1 || G->clearedNow >= 6 || G->combo >= 3) t->bigMark = 1;
        G->lastClear = G->elapsed;
        if (t->vs && G->attackQ8) {
            WORD out;
            DWORD a = (DWORD)G->atkFrac + (((DWORD)G->attackQ8 * SEND_Q8) >> 8);
            out = (WORD)(a >> 8); G->atkFrac = (WORD)(a & 255);
            trk_send(t, out);
        }
    }
    G->state = ST_PLAY;
}

static void resolve_check(Track *t, Map moved)
{
    int count = find_clears(G->grid, moved, G->hits);
    if (!count) { finish_resolve(t); return; }
    G->chain++;
    if (G->chain == 1) G->combo = (BYTE)((G->lastClear && G->elapsed - G->lastClear <= COMBO_WIN) ? G->combo + 1 : 1);
    G->balls = (WORD)(G->balls + count); G->clearedNow = (BYTE)(G->clearedNow + count);
    G->score += (DWORD)count * 10 * G->chain * G->chain * (G->combo ? G->combo : 1);
    G->attackQ8 = (WORD)(G->attackQ8 + step_units_q8(G->chain, count));
    if (G->chain > 1) trk_say(t, "CHAIN!", PAL_YELLOW);
    else if (G->combo > 1) trk_say(t, "COMBO!", PAL_ORANGE);
    else if (count >= 6) trk_say(t, "BIG GRAB", PAL_CYAN);
    trk_sfx(t, G->chain > 1 || G->combo > 1 ? S_BIG : S_CLEAR);
    G->state = ST_FLASH; G->phaseT = FLASH;
}

static void grab(Track *t)
{
    if (!grab_from(G->grid, G->pos, &G->hk, &G->hn)) { trk_sfx(t, S_BAD); return; }
    G->beam = 140; G->beamCol = G->pos;
    trk_sfx(t, S_HOLD);
}

static void throw_balls(Track *t)
{
    Map moved;
    if (!G->hn) { trk_sfx(t, S_BAD); return; }
    if (!throw_to(G->grid, G->pos, &G->hk, &G->hn, moved)) { trk_sfx(t, S_BAD); return; }
    G->beam = 140; G->beamCol = G->pos;
    trk_sfx(t, S_HARD);
    G->chain = 0; G->attackQ8 = 0; G->clearedNow = 0;
    resolve_check(t, moved);
}

static void handle(Track *t, Pad *pad, WORD dt)
{
    BYTE held;
    if (PAD_PRESSED(pad, B_LEFT)) { G->dasDir = -1; G->dasT = 0; move(t, -1); }
    else if (PAD_PRESSED(pad, B_RIGHT)) { G->dasDir = 1; G->dasT = 0; move(t, 1); }
    held = (BYTE)(G->dasDir < 0 ? PAD_DOWN(pad, B_LEFT) : G->dasDir > 0 ? PAD_DOWN(pad, B_RIGHT) : 0);
    if (held) {
        G->dasT = (WORD)(G->dasT + dt);
        while (G->dasT >= DAS + ARR) { G->dasT = (WORD)(G->dasT - ARR); if (!move(t, G->dasDir)) break; }
    } else G->dasDir = 0;
    if (G->state != ST_PLAY) return;
    if (PAD_PRESSED(pad, B_A) || PAD_PRESSED(pad, B_C) || PAD_PRESSED(pad, B_DOWN)) grab(t);
    else if (PAD_PRESSED(pad, B_B) || PAD_PRESSED(pad, B_D) || PAD_PRESSED(pad, B_UP)) throw_balls(t);
}

BYTE grab_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int r, c, i;
    w &= 0x7f;
    if (w == W_WIPE) {
        if (!q) { for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) G->grid[r][c] = -1; for (i = 0; i < START_ROWS; i++) push_row(t); }
        return 1;
    }
    if (w == W_REMOVE) {
        if (!q) {
            for (r = 0; r < ROWS - 1; r++) for (c = 0; c < COLS; c++) G->grid[r][c] = G->grid[r + 1][c];
            for (c = 0; c < COLS; c++) G->grid[ROWS - 1][c] = -1;
        }
        return 1;
    }
    return 0;
}
BYTE grab_safe(const Track *t) { return (BYTE)(G->state == ST_PLAY); }
void grab_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = COLS * 2; *h = ROWS * 2 + 2; }

static const WORD THINK[9] = { 0, 1050, 860, 700, 620, 540, 470, 445, 420 };
static const WORD STEP[9] = { 0, 200, 170, 150, 130, 115, 100, 95, 88 };
static const BYTE MISTAKE[9] = { 0, 40, 30, 20, 16, 13, 10, 9, 8 };

void grab_init(Track *t)
{
    int r, c, i;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) G->grid[r][c] = -1;
    G->pos = 3; G->state = ST_PLAY;
    G->lastClear = 0;
    for (i = 0; i < START_ROWS; i++) push_row(t);
    if (t->cpu) { G->cpu.level = t->cpu; G->cpu.wait = THINK[t->cpu]; G->cpu.two = (BYTE)(t->cpu >= 3); }
}

void grab_update(Track *t, Pad *pad, WORD dt)
{
    if (G->beam) G->beam = G->beam > dt ? (WORD)(G->beam - dt) : 0;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    G->elapsed += dt;
    handle(t, pad, dt);
    if (G->state == ST_PLAY) {
        G->pushT += dt;
        if (G->pushT >= push_every(t)) { G->pushT = 0; if (push_row(t)) trk_sfx(t, S_TICK); }
        if (t->vs && !t->dead) {
            Batch bs[4];
            BYTE nb = trk_take_ready(t, GARBAGE_DELAY, MAX_GARBAGE, bs, 4), k, n = 0;
            for (k = 0; k < nb; k++) G->rowFrac = (WORD)(G->rowFrac + bs[k].n * ROWS_PER_UNIT_Q8);
            while (G->rowFrac >= 256 && !t->dead) { G->rowFrac = (WORD)(G->rowFrac - 256); push_row(t); n++; }
            if (n) trk_sfx(t, S_GARBAGE);
        }
    } else if (G->state == ST_FLASH) {
        G->phaseT = (SWORD)(G->phaseT - dt);
        if (G->phaseT <= 0) { clear_and_rise(G->grid, G->hits, G->rose); G->state = ST_SETTLE; G->phaseT = SETTLE; }
    } else if (G->state == ST_SETTLE) {
        G->phaseT = (SWORD)(G->phaseT - dt);
        if (G->phaseT <= 0) resolve_check(t, G->rose);
    }
}

/* ---------------------------------------------------------------- CPU */
static SDWORD eval_board(Grid g)
{
    int c, d, h, max = 0, sq = 0, setups = 0, n;
    SBYTE bottoms[COLS], k;
    SDWORD danger = 0;
    for (c = 0; c < COLS; c++) {
        h = col_h(g, c); if (h > max) max = h; sq += h * h;
        n = bottom_run(g, c, &k); bottoms[c] = n ? k : -1;
        if (n == 2) setups += 6;
    }
    for (c = 0; c < COLS; c++) for (d = c + 1; d < COLS; d++) if (bottoms[c] >= 0 && bottoms[c] == bottoms[d]) setups += 2;
    if (max >= ROWS - 3) danger = (SDWORD)(max - (ROWS - 4)) * 70;
    return (SDWORD)setups - sq / 4 - max * 3 - danger;
}

/* plan: up to 3 actions; tmask bit i = throw */
static void try_plan(Track *t, const BYTE *cols, BYTE n, BYTE tmask)
{
    GrabCpu *k = &G->cpu;
    static Grid g;
    static Map moved, hit;
    BYTE hk = G->hk, hn = G->hn, i, chain = 0;
    int r, c, cleared = 0, walk = 0, p = G->pos, m;
    WORD units = 0;
    SDWORD sc;
    BYTE hadMove = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) g[r][c] = G->grid[r][c];
    for (i = 0; i < n; i++) {
        if (tmask & (1 << i)) { if (!throw_to(g, cols[i], &hk, &hn, moved)) return; hadMove = 1; }
        else if (!grab_from(g, cols[i], &hk, &hn)) return;
        walk += cols[i] > p ? cols[i] - p : p - cols[i]; p = cols[i];
    }
    if (hadMove) for (;;) {
        m = find_clears(g, moved, hit);
        if (!m) break;
        chain++; cleared += m; units = (WORD)(units + (step_units_q8(chain, m) >> 8));
        clear_and_rise(g, hit, moved);
    }
    sc = (SDWORD)units * 45 + (SDWORD)cleared * 7 + (SDWORD)chain * 20 + eval_board(g) - (walk * 6) / 10;
    if (!k->have || sc > k->bestSc || (k->have && trk_rnd(t, 100) < 1)) {
        if (!k->have || sc > k->bestSc) {
            k->bestSc = sc; k->bestN = n; k->bestT = tmask;
            for (i = 0; i < n; i++) k->best[i] = cols[i];
            k->have = 1;
        }
    }
}

/* one (throw column, first grab column) pair per call: at most 7 playouts a frame */
static void cpu_plan_step(Track *t)
{
    GrabCpu *k = &G->cpu;
    BYTE cols[3], c3, c2 = k->c2, c1 = k->c1;
    if (G->hn) {
        if (c1 == 0) { cols[0] = c2; try_plan(t, cols, 1, 1); }
        cols[0] = c1; cols[1] = c2; try_plan(t, cols, 2, 2);
    } else {
        cols[0] = c1; cols[1] = c2; try_plan(t, cols, 2, 2);
        if (k->two) for (c3 = 0; c3 < COLS; c3++) if (c3 != c1) { cols[0] = c1; cols[1] = c3; cols[2] = c2; try_plan(t, cols, 3, 4); }
    }
    if (++k->c1 >= COLS) { k->c1 = 0; k->c2++; }
}

void grab_cpu(Track *t, Pad *pad, WORD dt)
{
    GrabCpu *k = &G->cpu;
    WORD st = 0;
    BYTE i;
    if (G->state != ST_PLAY) { pad_feed(pad, 0, dt); return; }
    if (k->tap) { k->tap = 0; pad_feed(pad, 0, dt); return; }
    if (k->n == 1) {           /* planning */
        cpu_plan_step(t);
        if (k->c2 >= COLS) {
            k->n = 0;
            if (k->have) {
                if (trk_rnd(t, 100) < MISTAKE[k->level] && k->bestN >= 2) k->best[k->bestN - 1] = (BYTE)trk_rnd(t, COLS);
                k->planN = k->bestN; k->planT = k->bestT;
                for (i = 0; i < k->bestN; i++) k->plan[i] = k->best[i];
            } else k->wait = THINK[k->level];
        }
    }
    if (k->wait > dt) { k->wait = (WORD)(k->wait - dt); pad_feed(pad, 0, dt); return; }
    k->wait = 0;
    if (k->n == 1) { pad_feed(pad, 0, dt); return; }
    if (!k->planN) { k->n = 1; k->c2 = 0; k->c1 = 0; k->have = 0; pad_feed(pad, 0, dt); return; }
    if (G->pos < k->plan[0]) st = B_RIGHT;
    else if (G->pos > k->plan[0]) st = B_LEFT;
    else {
        if (!(k->planT & 1)) {
            SBYTE kk;
            int n = bottom_run(G->grid, k->plan[0], &kk);
            if (!n || (G->hn && kk != (SBYTE)G->hk)) { k->planN = 0; pad_feed(pad, 0, dt); return; }
            st = B_A;
        } else st = B_B;
        for (i = 1; i < k->planN; i++) k->plan[i - 1] = k->plan[i];
        k->planN--; k->planT >>= 1;
        if (!k->planN) k->wait = (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
    }
    k->tap = 1;
    if (!k->wait) k->wait = STEP[k->level];
    pad_feed(pad, st, dt);
}

/* ---------------------------------------------------------------- drawing */
void grab_draw(Track *t, int ox)
{
    int r, c, fx = ox + FX, y;
    BYTE flashOn = (BYTE)((G->phaseT >> 6) & 1);
    for (y = 0; y < ROWS * 2 + 2; y++) { cv_put(fx - 1, FY + y, TW(PAL_STEEL, TB3(T_FR_L))); cv_put(fx + COLS * 2, FY + y, TW(PAL_STEEL, TB3(T_FR_R))); }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        SBYTE k = G->grid[r][c];
        if (k < 0) {
            BYTE beam = (BYTE)(G->beam && c == G->beamCol);
            cv_cell16(fx + c * 2, FY + r * 2, beam ? PAL_WHITE : (c == G->pos ? PAL_BLUE : PAL_STEEL), C_EMPTY16, 0);
            continue;
        }
        if (G->state == ST_FLASH && G->hits[r][c] && flashOn) { cv_cell16(fx + c * 2, FY + r * 2, PAL_WHITE, C_FLASH, 0); continue; }
        cv_cell16(fx + c * 2, FY + r * 2, KPAL[k], C_BUB(k), 0);
    }
    /* danger line + grabber */
    for (c = 0; c < COLS * 2; c++) cv_put(fx + c, FY + ROWS * 2, TW(PAL_RED, TB3(T_DANGER)));
    if (!t->dead) {
        cv_cell16(fx + G->pos * 2, FY + ROWS * 2, t->side ? PAL_CYAN : PAL_AMBER, C_GRABBER, 0);
        if (G->hn) cv_put(fx + G->pos * 2 + 1, FY + ROWS * 2, TW(KPAL[G->hk], TB3(T_DOT)));
    }
    /* right panel: what's held, next push */
    cv_text(ox + 18, FY, PAL_BEIGE, "HL");
    if (G->hn) { cv_cell16(ox + 18, FY + 1, KPAL[G->hk], C_BUB(G->hk), 0); cv_text(ox + 18, FY + 3, PAL_WHITE, cv_num(G->hn)); }
    cv_text(ox + 18, FY + 6, PAL_GREY, "PS");
    {
        WORD pe = push_every(t);
        int n = (int)(((DWORD)G->pushT * 8) / pe), i;
        for (i = 0; i < 8; i++) cv_put(ox + 18, FY + 15 - i, TW(i < n ? PAL_RED : PAL_STEEL, TB3(T_BAR + 8)));
    }
    cv_pending(ox + 1, FY, ROWS * 2, t, 16, GARBAGE_DELAY);
}
