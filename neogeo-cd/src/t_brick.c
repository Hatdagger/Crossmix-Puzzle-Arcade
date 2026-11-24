/*
 * The brick engine (js/track-brick.js) and the tracks built on it:
 * Brick (modern), Arsenal (weapons), Power Brick (crystals + powers) and
 * Climb (the professor).  Each switches modern features with a BrickSet.
 */
#include "xm.h"
#include "tiles.h"

#define COLS BR_COLS
#define ROWS BR_ROWS
#define HIDDEN BR_HIDDEN

/* screen layout inside a 20-column half */
#define FX 6            /* field column */
#define FY 3            /* field row (first visible row) */

/* ---------------------------------------------------------------- pieces */
/* types 1..7 = I J L O S T Z; cells for rotation 0, rotated like the web version */
static const SBYTE BASE[8][4][2] = {
    { {0,0},{0,0},{0,0},{0,0} },
    { {0,1},{1,1},{2,1},{3,1} },   /* I */
    { {0,0},{0,1},{1,1},{2,1} },   /* J */
    { {2,0},{0,1},{1,1},{2,1} },   /* L */
    { {0,0},{1,0},{0,1},{1,1} },   /* O */
    { {1,0},{2,0},{0,1},{1,1} },   /* S */
    { {1,0},{0,1},{1,1},{2,1} },   /* T */
    { {0,0},{1,0},{1,1},{2,1} }    /* Z */
};
static const BYTE SIZE[8] = { 0, 4, 3, 3, 2, 3, 3, 3 };
static SBYTE SH[8][4][4][2];       /* [type][rot][cell][x/y] */
static BYTE sh_ready = 0;

static void shapes_init(void)
{
    int t, r, c;
    if (sh_ready) return;
    for (t = 1; t < 8; t++) {
        for (c = 0; c < 4; c++) { SH[t][0][c][0] = BASE[t][c][0]; SH[t][0][c][1] = BASE[t][c][1]; }
        for (r = 1; r < 4; r++) for (c = 0; c < 4; c++) {
            SH[t][r][c][0] = (SBYTE)(SIZE[t] - 1 - SH[t][r - 1][c][1]);
            SH[t][r][c][1] = SH[t][r - 1][c][0];
        }
    }
    sh_ready = 1;
}

/* SRS kicks (y-down), [from][0: to from+1, 1: to from-1][test], from the web tables */
static const SBYTE KJ[4][2][5][2] = {
    { { {0,0},{-1,0},{-1,-1},{0,2},{-1,2} }, { {0,0},{1,0},{1,-1},{0,2},{1,2} } },
    { { {0,0},{1,0},{1,1},{0,-2},{1,-2} }, { {0,0},{1,0},{1,1},{0,-2},{1,-2} } },
    { { {0,0},{1,0},{1,-1},{0,2},{1,2} }, { {0,0},{-1,0},{-1,-1},{0,2},{-1,2} } },
    { { {0,0},{-1,0},{-1,1},{0,-2},{-1,-2} }, { {0,0},{-1,0},{-1,1},{0,-2},{-1,-2} } }
};
static const SBYTE KI[4][2][5][2] = {
    { { {0,0},{-2,0},{1,0},{-2,1},{1,-2} }, { {0,0},{-1,0},{2,0},{-1,-2},{2,1} } },
    { { {0,0},{-1,0},{2,0},{-1,-2},{2,1} }, { {0,0},{2,0},{-1,0},{2,-1},{-1,2} } },
    { { {0,0},{2,0},{-1,0},{2,-1},{-1,2} }, { {0,0},{1,0},{-2,0},{1,2},{-2,-1} } },
    { { {0,0},{1,0},{-2,0},{1,2},{-2,-1} }, { {0,0},{-2,0},{1,0},{-2,1},{1,-2} } }
};

/* ---------------------------------------------------------------- settings */
static const BrickSet SET_BRICK   = { 1, 5, 1, 1, 1, 1, 1, 1,  1, 1, 1, 1, 1, 1, 1,  0 };
static const BrickSet SET_ARSENAL = { 0, 1, 1, 1, 0, 1, 1, 1,  0, 0, 0, 0, 0, 0, 1,  0 };
static const BrickSet SET_POWER   = { 0, 5, 0, 0, 0, 1, 0, 0,  0, 1, 0, 0, 0, 1, 1,  0 };
static const BrickSet SET_CLIMB   = { 0, 1, 0, 0, 0, 0, 0, 0,  0, 0, 0, 0, 0, 1, 1,  110 };

static const BYTE LINE_ATTACK[5] = { 0, 0, 1, 2, 4 };
static const BYTE COMBO_T[12] = { 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5 };
static const WORD GRAV[15] = { 1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7 };
#define DAS 167
#define ARR 33
#define LOCK_MS 500
#define MAX_RESETS 15
#define GARBAGE_DELAY 1000

/* Climb */
#define FIELD_H 16
#define TOP (ROWS - FIELD_H)
#define CEIL0 1
#define FALL_MS 750
#define WALK_MS 700
#define PROF_FALL_MS 120
#define CLIMB_MS 1300
#define WIN_MS 2600
static const BYTE DROP_EVERY[11] = { 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3 };
enum { PS_WALK, PS_CLIMB, PS_FALL, PS_WIN, PS_DEAD };

/* Arsenal */
#define SLOTS 8
static const BYTE MIXED_SEND[5] = { 0, 0, 0, 1, 2 };
static const BYTE W_WEIGHT[10] = { 0, 3, 5, 15, 10, 10, 10, 10, 10, 5 };   /* x5: wipe .6 empty 1 add 3 ... */
static const char *const W_SHORT[10] = { "", "CLEAR", "EMPTY", "+LINE", "-LINE", "FAST", "SLOW", "GRAV", "FLIP", "SWAP" };
static BYTE w_self(BYTE w) { return (BYTE)(w == W_WIPE || w == W_REMOVE || w == W_SLOW || w == W_GRAVITY); }

/* Power Brick */
#define MAX_STARS 5
#define PER_STAR 4
#define CRYSTAL_PTS 3
static const BYTE POWER_OF[6] = { 0, P_SHAKE, P_SHIELD, P_FOG, P_HANDS, P_RUSH };
static const char *const POWER_SHORT[6] = { "", "SHK", "SHD", "FOG", "HND", "RSH" };
static const char *const POWER_NAME[6] = { "", "SHAKE", "SHIELD", "FOG", "HANDS", "RUSH" };

#define B (&t->u.b)

/* CPU dice: never the track's own, so Climb races keep identical pieces */
static DWORD cpu_seed = 0x9E3779B9UL;
static WORD cpu_rnd(WORD n)
{
    DWORD x = cpu_seed;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    cpu_seed = x;
    return (WORD)(((x >> 16) * (DWORD)n) >> 16);
}

/* ---------------------------------------------------------------- basics */
static BYTE cell_type(BYTE c)
{
    if (c & BC_CRYSTAL) return (BYTE)(c & 7);
    return c;
}

static BYTE ceil_row(const Track *t) { return (BYTE)(TOP + B->ceil); }

static BYTE collides(const Track *t, BYTE type, BYTE rot, int x, int y)
{
    int i, cx, cy, top = t->kind == TK_CLIMB ? ceil_row(t) : -99;
    for (i = 0; i < 4; i++) {
        cx = x + SH[type][rot][i][0]; cy = y + SH[type][rot][i][1];
        if (cx < 0 || cx >= COLS || cy >= ROWS || cy < top) return 1;
        if (cy >= 0 && B->grid[cy][cx]) return 1;
    }
    return 0;
}

static BYTE random_type(Track *t)
{
    int i, j; BYTE tmp;
    if (t->kind == TK_CLIMB && B->solHead < B->soln) return B->solType[B->solHead++];
    if (B->s->bag) {
        if (!B->bagn) {
            for (i = 0; i < 7; i++) B->bag[i] = (BYTE)(i + 1);
            for (i = 6; i > 0; i--) { j = trk_rnd(t, (WORD)(i + 1)); tmp = B->bag[i]; B->bag[i] = B->bag[j]; B->bag[j] = tmp; }
            B->bagn = 7;
        }
        return B->bag[--B->bagn];
    }
    return (BYTE)(1 + trk_rnd(t, 7));
}

static void fill_queue(Track *t) { while (B->qn < 6) B->queue[B->qn++] = random_type(t); }

static BYTE queue_pop(Track *t)
{
    BYTE v = B->queue[0]; int k;
    for (k = 1; k < B->qn; k++) B->queue[k - 1] = B->queue[k];
    B->qn--;
    fill_queue(t);
    return v;
}

static void die(Track *t)
{
    if (!t->dead) { t->dead = 1; trk_sfx(t, S_KO); }
}

static void spike_row(Track *t, int row);

static void spawn(Track *t, BYTE type)
{
    int x, tries, i, cx, cy;
    if (!type) type = queue_pop(t); else fill_queue(t);
    x = type == 4 ? 4 : 3;
    B->hasPiece = 1; B->ptype = type; B->prot = 0; B->px = (SBYTE)x;
    B->py = t->kind == TK_CLIMB ? (SBYTE)ceil_row(t) : 0;
    B->pieceId++;
    B->gravT = 0; B->lockT = 0; B->resets = 0; B->lastRot = 0;
    B->lowest = B->py;
    B->crystal = -1;
    if (t->kind == TK_CLIMB) {
        /* bricks in the way at the top don't end the game: the spikes destroy those lines */
        for (tries = 0; tries < 4 && collides(t, type, 0, x, B->py); tries++)
            for (i = 0; i < 4; i++) {
                cx = x + SH[type][0][i][0]; cy = B->py + SH[type][0][i][1];
                if (cy >= 0 && cy < ROWS && B->grid[cy][cx]) spike_row(t, cy);
            }
        if (collides(t, type, 0, x, B->py)) die(t);
        return;
    }
    if (collides(t, type, 0, x, 0)) {
        if (!collides(t, type, 0, x, -1)) B->py = -1;
        else die(t);
    }
    if (t->kind == TK_POWER && !t->dead && trk_rnd(t, 4) == 0) B->crystal = (SBYTE)trk_rnd(t, 4);
}

static BYTE on_ground(const Track *t) { return collides(t, B->ptype, B->prot, B->px, B->py + 1); }

static void touched(Track *t)
{
    if (B->s->lockResets && on_ground(t) && B->resets < MAX_RESETS) { B->lockT = 0; B->resets++; }
}

static BYTE move(Track *t, int dx)
{
    if (collides(t, B->ptype, B->prot, B->px + dx, B->py)) return 0;
    B->px = (SBYTE)(B->px + dx); B->lastRot = 0; touched(t); trk_sfx(t, S_MOVE);
    return 1;
}

static BYTE rotate(Track *t, int dir)
{
    BYTE to, from = B->prot, n, i;
    int nx, ny;
    const SBYTE (*k)[2];
    if (B->ptype == 4) return 0;
    to = (BYTE)((from + (dir > 0 ? 1 : 3)) & 3);
    k = B->ptype == 1 ? KI[from][dir > 0 ? 0 : 1] : KJ[from][dir > 0 ? 0 : 1];
    n = B->s->srs ? 5 : 1;
    for (i = 0; i < n; i++) {
        nx = B->px + k[i][0]; ny = B->py + k[i][1];
        if (!collides(t, B->ptype, to, nx, ny)) {
            B->px = (SBYTE)nx; B->py = (SBYTE)ny; B->prot = to; B->lastRot = 1; B->lastKick = i; touched(t);
            trk_sfx(t, S_ROTATE);
            return 1;
        }
    }
    return 0;
}

static SBYTE ghost_y(const Track *t)
{
    int y = B->py;
    while (!collides(t, B->ptype, B->prot, B->px, y + 1)) y++;
    return (SBYTE)y;
}

static BYTE level_of(const Track *t)
{
    DWORD e = B->elapsed; BYTE lv = 1;
    if (t->kind == TK_CLIMB) return 1;
    while (e >= 60000UL && lv < 15) { e -= 60000UL; lv++; }
    return lv;
}

static WORD gravity_ms(const Track *t)
{
    DWORD g = t->kind == TK_CLIMB ? FALL_MS : GRAV[level_of(t) - 1];
    g = (g << 8) / trk_speed_q8(t);
    return (WORD)(g ? g : 1);
}

static BYTE row_full(const Track *t, int y)
{
    int x;
    for (x = 0; x < COLS; x++) if (!B->grid[y][x]) return 0;
    return 1;
}
static BYTE row_any(const Track *t, int y)
{
    int x;
    for (x = 0; x < COLS; x++) if (B->grid[y][x]) return 1;
    return 0;
}
static void clear_row(Track *t, int y) { int x; for (x = 0; x < COLS; x++) B->grid[y][x] = 0; }
static void remove_row(Track *t, int row)   /* rows above move down */
{
    int y, x;
    for (y = row; y > 0; y--) for (x = 0; x < COLS; x++) B->grid[y][x] = B->grid[y - 1][x];
    clear_row(t, 0);
}

/* ---------------------------------------------------------------- Arsenal */
static BYTE roll_weapon(Track *t)
{
    WORD x = trk_rnd(t, 78), w;
    for (w = 1; w <= 9; w++) { if (x < W_WEIGHT[w]) return (BYTE)w; x = (WORD)(x - W_WEIGHT[w]); }
    return W_ADD;
}
static BYTE works_on_opp(const Track *t, BYTE w)
{
    return (BYTE)(t->opp && !t->opp->dead && trk_takes(t->opp, w, t));
}
static void place_letter(Track *t)
{
    BYTE ys[200], xs[200];
    int n = 0, y, x, k;
    for (y = HIDDEN; y < ROWS; y++) for (x = 0; x < COLS; x++) {
        BYTE c = B->grid[y][x];
        if (c && !(c & BC_LETTER)) { ys[n] = (BYTE)y; xs[n] = (BYTE)x; n++; }
    }
    if (!n) return;
    k = trk_rnd(t, (WORD)n);
    B->grid[ys[k]][xs[k]] = (BYTE)(BC_LETTER | roll_weapon(t));
}
static void fire(Track *t, BYTE atSelf)
{
    BYTE w; int k;
    if (!B->invn) { trk_sfx(t, S_BAD); return; }
    w = B->inv[0];
    if (!atSelf && !works_on_opp(t, w)) { trk_say(t, "NO EFFECT ON THEM", PAL_GREY); trk_sfx(t, S_BAD); return; }
    for (k = 1; k < B->invn; k++) B->inv[k - 1] = B->inv[k];
    B->invn--;
    if (atSelf) {
        if (w == W_SWAP) { trk_say(t, "NO EFFECT", PAL_GREY); return; }
        trk_apply_weapon(t, w, t);
    } else trk_hit(t, w);
}
static void discard(Track *t)
{
    int k;
    if (!B->invn) return;
    for (k = 1; k < B->invn; k++) B->inv[k - 1] = B->inv[k];
    B->invn--;
    trk_sfx(t, S_BACK);
}

/* ---------------------------------------------------------------- Power Brick */
BYTE power_stars(const Track *t)
{
    BYTE s = (BYTE)(B->points / PER_STAR);
    return s > MAX_STARS ? MAX_STARS : s;
}
BYTE brick_inv_count(const Track *t) { return t->kind == TK_ARSENAL ? B->invn : 0; }

static void cast(Track *t)
{
    BYTE st = power_stars(t), w, i;
    if (!st) { trk_sfx(t, S_BAD); return; }
    w = POWER_OF[st];
    B->points = (BYTE)(B->points - st * PER_STAR);
    trk_say(t, WEAPON_NAME[w], (w == P_SHAKE || w == P_SHIELD) ? PAL_CYAN : PAL_RED);
    trk_sfx(t, S_CAST);
    if (w == P_SHAKE) { for (i = 0; i < 3; i++) remove_row(t, ROWS - 1); }
    else if (w == P_SHIELD) B->shield = 1;
    else trk_hit(t, w);
}

/* ---------------------------------------------------------------- clearing and scoring */
static BYTE clear_lines(Track *t)
{
    int y, n = 0, x, k;
    BYTE found[40], nf = 0, crystals = 0;
    B->clearRows = 0;
    /* Power Brick: the crystal brick of the piece that just locked goes into the grid */
    if (t->kind == TK_POWER && B->crystal >= 0) {
        int cx = B->px + SH[B->ptype][B->prot][B->crystal][0], cy = B->py + SH[B->ptype][B->prot][B->crystal][1];
        if (cy >= 0 && B->grid[cy][cx] == B->ptype) B->grid[cy][cx] = (BYTE)(BC_CRYSTAL | B->ptype);
        B->crystal = -1;
    }
    for (y = 0; y < ROWS; y++) if (row_full(t, y)) for (x = 0; x < COLS; x++) {
        BYTE c = B->grid[y][x];
        if ((c & BC_LETTER) && nf < 40) found[nf++] = (BYTE)(c & 15);
        if (c & BC_CRYSTAL) crystals++;
    }
    for (y = ROWS - 1; y >= 0; y--) {
        if (row_full(t, y)) {
            B->clearRows |= 1UL << y;
            remove_row(t, y); n++; y++;
        }
    }
    (void)k;
    if (n) B->clearT = 200;
    if (t->kind == TK_ARSENAL && n) {
        BYTE got = 0, lost = 0, i, j;
        for (i = 0; i < nf; i++) for (j = 0; j < n; j++) {
            if (B->invn < SLOTS) { B->inv[B->invn++] = found[i]; got++; } else lost++;
        }
        if (got) { trk_say(t, got == 1 ? W_SHORT[found[0]] : "+WEAPONS", PAL_YELLOW); trk_sfx(t, S_HOLD); }
        if (lost) trk_say(t, "FULL! LOST", PAL_GREY);
        if (n == 1) place_letter(t);
    }
    if (t->kind == TK_POWER && n) {
        BYTE before = power_stars(t);
        WORD p = (WORD)(B->points + n + crystals * CRYSTAL_PTS);
        B->points = (BYTE)(p > MAX_STARS * PER_STAR ? MAX_STARS * PER_STAR : p);
        if (crystals) { trk_say(t, crystals > 1 ? "+CRYSTALS" : "+CRYSTAL", PAL_PINK); trk_sfx(t, S_HOLD); }
        if (power_stars(t) > before) trk_say(t, POWER_NAME[power_stars(t)], PAL_YELLOW);
    }
    return (BYTE)n;
}

static BYTE tspin_kind(const Track *t)
{
    int x = B->px, y = B->py, n = 0, f;
    BYTE c[4];
    static const BYTE FRONT[4][2] = { {0,1}, {1,2}, {2,3}, {3,0} };
    if (!B->s->tspin || B->ptype != 6 || !B->lastRot) return 0;
#define FILLED(cx, cy) ((cx) < 0 || (cx) >= COLS || (cy) >= ROWS || ((cy) >= 0 && B->grid[cy][cx]))
    c[0] = (BYTE)FILLED(x, y); c[1] = (BYTE)FILLED(x + 2, y); c[2] = (BYTE)FILLED(x + 2, y + 2); c[3] = (BYTE)FILLED(x, y + 2);
#undef FILLED
    n = c[0] + c[1] + c[2] + c[3];
    if (n < 3) return 0;
    f = c[FRONT[B->prot][0]] + c[FRONT[B->prot][1]];
    return (BYTE)((f < 2 && B->lastKick != 4) ? 1 : 2);
}

static BYTE grid_empty(const Track *t)
{
    int y;
    for (y = 0; y < ROWS; y++) if (row_any(t, y)) return 0;
    return 1;
}

static void score_clear(Track *t, BYTE n, BYTE ts)
{
    static const char *const NAMES[5] = { "", "SINGLE", "DOUBLE", "TRIPLE", "QUAD!" };
    static const char *const TS[5] = { "", "T-SPIN SINGLE", "T-SPIN DOUBLE", "T-SPIN TRIPLE", "T-SPIN" };
    WORD atk;
    BYTE difficult, empty;
    const char *label = 0;
    B->lines = (WORD)(B->lines + n);
    if (t->kind == TK_ARSENAL) {
        if (n >= 4) t->bigMark = 1;
        if (n >= 2) trk_say(t, NAMES[n > 4 ? 4 : n], PAL_CYAN);
        trk_sfx(t, n >= 4 ? S_BIG : S_CLEAR);
        if (!B->noUnits) trk_send(t, MIXED_SEND[n > 4 ? 4 : n]);
        return;
    }
    if (ts == 2) { atk = (WORD)(n * 2); label = TS[n > 4 ? 4 : n]; }
    else if (ts == 1) { atk = n >= 2 ? 1 : 0; label = "MINI T-SPIN"; }
    else { atk = LINE_ATTACK[n > 4 ? 4 : n]; label = n >= 2 ? NAMES[n > 4 ? 4 : n] : 0; }
    difficult = (BYTE)(n >= 4 || ts > 0);
    if (difficult) {
        t->bigMark = 1;
        if (B->b2bOn && B->s->b2b) { atk++; trk_say(t, "BACK TO BACK", PAL_VIOLET); }
        B->b2bOn = 1;
    } else B->b2bOn = 0;
    B->combo++;
    if (B->s->combo && B->combo > 0) {
        atk = (WORD)(atk + COMBO_T[B->combo > 11 ? 11 : B->combo]);
        trk_say(t, "COMBO", PAL_YELLOW);
    }
    empty = grid_empty(t);
    if (empty && B->s->allClear) { atk = (WORD)(atk + 10); trk_say(t, "ALL CLEAR!", PAL_GREEN); }
    if (label) trk_say(t, label, ts ? PAL_VIOLET : PAL_CYAN);
    trk_sfx(t, n >= 4 || ts ? S_BIG : S_CLEAR);
    trk_send(t, atk);
}

static void land_garbage(Track *t)
{
    Batch bs[8];
    BYTE nb, k, i;
    int x, y;
    nb = trk_take_ready(t, B->s->garbageDelay ? GARBAGE_DELAY : 0, t->kind == TK_CLIMB ? 6 : 8, bs, 8);
    if (!nb) return;
    for (k = 0; k < nb; k++) {
        BYTE hole = (BYTE)(bs[k].gap % COLS);
        for (i = 0; i < bs[k].n; i++) {
            if (t->kind != TK_CLIMB && row_any(t, 0)) die(t);
            for (y = 0; y < ROWS - 1; y++) for (x = 0; x < COLS; x++) B->grid[y][x] = B->grid[y + 1][x];
            for (x = 0; x < COLS; x++) B->grid[ROWS - 1][x] = (BYTE)(x == hole ? 0 : BC_GARB);
            if (t->kind == TK_CLIMB && B->prof.y > 0) B->prof.y--;
        }
    }
    if (t->kind == TK_CLIMB) {
        for (y = 0; y < ceil_row(t); y++) clear_row(t, y);   /* pushed into the ceiling = destroyed */
        if (B->prof.y < ceil_row(t)) { B->prof.state = PS_DEAD; die(t); }
    }
    trk_sfx(t, S_GARBAGE);
}

/* ---------------------------------------------------------------- Climb */
static BYTE cells_of(BYTE type, BYTE rot, int x, int y, SBYTE out[4][2])
{
    int i;
    for (i = 0; i < 4; i++) { out[i][0] = (SBYTE)(x + SH[type][rot][i][0]); out[i][1] = (SBYTE)(y + SH[type][rot][i][1]); }
    return 4;
}
/* same squares whatever the rotation number or height */
static BYTE same_shape(SBYTE a[4][2], SBYTE b[4][2])
{
    int i, j, ma = 99, mb = 99, ok;
    for (i = 0; i < 4; i++) { if (a[i][1] < ma) ma = a[i][1]; if (b[i][1] < mb) mb = b[i][1]; }
    for (i = 0; i < 4; i++) {
        ok = 0;
        for (j = 0; j < 4; j++) if (a[i][0] == b[j][0] && a[i][1] - ma == b[j][1] - mb) ok = 1;
        if (!ok) return 0;
    }
    return 1;
}

static BYTE G2[ROWS][COLS];   /* scratch grid for the stage generator */

static BYTE carvable(BYTE type, BYTE rot, int x, int y)
{
    SBYTE c[4][2];
    int i, j, yy, mine, under;
    cells_of(type, rot, x, y, c);
    for (i = 0; i < 4; i++) {
        if (c[i][0] < 0 || c[i][0] >= COLS || c[i][1] < TOP + CEIL0 + 4 || c[i][1] >= ROWS || !G2[c[i][1]][c[i][0]]) return 0;
    }
    for (i = 0; i < 4; i++) for (yy = 0; yy < c[i][1]; yy++) {
        if (!G2[yy][c[i][0]]) continue;
        mine = 0; for (j = 0; j < 4; j++) if (c[j][0] == c[i][0] && c[j][1] == yy) mine = 1;
        if (!mine) return 0;
    }
    for (i = 0; i < 4; i++) {
        int by = c[i][1] + 1;
        if (by >= ROWS) return 1;
        under = G2[by][c[i][0]] != 0;
        mine = 0; for (j = 0; j < 4; j++) if (c[j][0] == c[i][0] && c[j][1] == by) mine = 1;
        if (under && !mine) return 1;
    }
    return 0;
}

static BYTE g2_full(int y) { int x; for (x = 0; x < COLS; x++) if (!G2[y][x]) return 0; return 1; }

static void gen_stage(Track *t)
{
    int k = 4 + B->stage, N, attempt, y, x, tries, carved, py, nopt, i;
    BYTE opts[ROWS];
    if (k > 12) k = 12;
    N = (k * 4 + 2) / 5; if (N < 4) N = 4; if (N > 10) N = 10;
    for (attempt = 0; attempt < 30; attempt++) {
        BYTE holesOk;
        for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) G2[y][x] = (BYTE)(y >= ROWS - N ? 1 + trk_rnd(t, 7) : 0);
        carved = 0; tries = 0;
        while (tries++ < 1500) {
            BYTE type, rot; int px;
            holesOk = 1;
            for (y = ROWS - N; y < ROWS; y++) if (g2_full(y)) holesOk = 0;
            if (carved >= k && holesOk) break;
            if (carved >= k + 4 || carved >= 16) break;
            type = (BYTE)(1 + trk_rnd(t, 7)); rot = (BYTE)trk_rnd(t, 4); px = (int)trk_rnd(t, COLS + 3) - 2;
            nopt = 0;
            for (py = TOP; py < ROWS; py++) if (carvable(type, rot, px, py)) opts[nopt++] = (BYTE)py;
            if (!nopt) continue;
            py = opts[trk_rnd(t, (WORD)nopt)];
            for (i = 0; i < 4; i++) G2[py + SH[type][rot][i][1]][px + SH[type][rot][i][0]] = 0;
            B->solPlan[carved].type = type; B->solPlan[carved].rot = rot; B->solPlan[carved].x = (SBYTE)px; B->solPlan[carved].y = (SBYTE)py;
            carved++;
        }
        holesOk = 1;
        for (y = ROWS - N; y < ROWS; y++) if (g2_full(y)) holesOk = 0;
        if (holesOk && carved >= (k < 5 ? k : 5)) {
            /* the solution is the carved pieces in reverse */
            for (i = 0; i < carved / 2; i++) { PieceSpot s = B->solPlan[i]; B->solPlan[i] = B->solPlan[carved - 1 - i]; B->solPlan[carved - 1 - i] = s; }
            B->soln = (BYTE)carved;
            for (i = 0; i < carved; i++) B->solType[i] = B->solPlan[i].type;
            return;
        }
    }
    /* fallback: a plain pile with one hole per row */
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) G2[y][x] = (BYTE)(y >= ROWS - 4 ? BC_GARB : 0);
    for (y = ROWS - 4; y < ROWS; y++) G2[y][trk_rnd(t, COLS)] = 0;
    B->soln = 0;
}

static BYTE free_walk(void)
{
    int x = 0, y = TOP + CEIL0, dir = 1, step, nx;
#define BL(cx, cy) ((cx) < 0 || (cx) >= COLS || (cy) >= ROWS || ((cy) >= 0 && G2[cy][cx]))
    for (step = 0; step < 300; step++) {
        while (y + 2 < ROWS && !BL(x, y + 2) && !BL(x + 1, y + 2)) y++;
        if (y + 2 >= ROWS) return 1;
        nx = dir > 0 ? x + 2 : x - 1;
        if (BL(nx, y) || BL(nx, y + 1)) dir = -dir; else x += dir;
    }
#undef BL
    return 0;
}

static BYTE p_blocked(const Track *t, int cx, int cy)
{
    if (cx < 0 || cx >= COLS || cy >= ROWS) return 1;
    if (cy < 0) return 0;
    return (BYTE)(B->grid[cy][cx] != 0);
}
static BYTE area_free(const Track *t, int x, int y)
{
    return (BYTE)(!p_blocked(t, x, y) && !p_blocked(t, x + 1, y) && !p_blocked(t, x, y + 1) && !p_blocked(t, x + 1, y + 1));
}
static BYTE on_floor(const Track *t) { return (BYTE)(B->prof.y + 2 >= ROWS); }
static BYTE supported(const Track *t)
{
    return (BYTE)(on_floor(t) || p_blocked(t, B->prof.x, B->prof.y + 2) || p_blocked(t, B->prof.x + 1, B->prof.y + 2));
}

static void new_stage(Track *t)
{
    int tries, y, x;
    B->stage++;
    for (tries = 0; tries < 20; tries++) { gen_stage(t); if (!free_walk()) break; }
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) B->grid[y][x] = G2[y][x];
    B->solHead = 0; B->solIdx = 0;
    B->ceil = CEIL0; B->placedSince = 0;
    B->qn = 0;
    fill_queue(t);
    B->prof.x = 0; B->prof.y = (BYTE)(TOP + CEIL0); B->prof.dir = 1; B->prof.state = PS_WALK; B->prof.t = 0; B->prof.frame = 0; B->prof.anim = 0;
    while (!supported(t)) B->prof.y++;
    spawn(t, 0);
    trk_say(t, "STAGE", PAL_AMBER);
}

static void spike_row(Track *t, int row)
{
    if (row < 0 || row >= ROWS || !row_any(t, row)) return;
    clear_row(t, row);
    B->clearRows = 1UL << row; B->clearT = 200;
    trk_say(t, "CRUNCH!", PAL_RED);
    trk_sfx(t, S_GARBAGE);
}

static void stage_clear(Track *t)
{
    B->prof.state = PS_WIN; B->prof.t = 0;
    B->hasPiece = 0;
    trk_say(t, "STAGE CLEAR!", PAL_GREEN);
    trk_sfx(t, S_BIG);
    if (t->race) { t->raceWon = 1; return; }
    trk_send(t, 4);
}

static void prof_dies(Track *t) { B->prof.state = PS_DEAD; die(t); }

static void update_prof(Track *t, WORD dt)
{
    Prof *p = &B->prof;
    int nx;
    p->anim = (WORD)(p->anim + dt);
    if (p->state == PS_DEAD) return;
    if (p->state == PS_WIN) {
        p->t = (WORD)(p->t + dt);
        if (p->t >= WIN_MS && !t->raceWon) new_stage(t);
        return;
    }
    if (p->y < ceil_row(t)) { prof_dies(t); return; }
    if (!area_free(t, p->x, p->y)) {
        if (p->state != PS_CLIMB) { p->state = PS_CLIMB; p->t = 0; trk_say(t, "CLIMB!", PAL_YELLOW); }
        p->t = (WORD)(p->t + dt);
        if (p->t >= CLIMB_MS) {
            p->t = (WORD)(p->t - CLIMB_MS);
            if (p->y) p->y--;
            if (p->y < ceil_row(t)) prof_dies(t);
        }
        return;
    }
    if (p->state == PS_CLIMB) { p->state = PS_WALK; p->t = 0; }
    if (on_floor(t)) { stage_clear(t); return; }
    if (!supported(t)) {
        if (p->state != PS_FALL) { p->state = PS_FALL; p->t = 0; }
        p->t = (WORD)(p->t + dt);
        while (p->t >= PROF_FALL_MS && !supported(t)) { p->t = (WORD)(p->t - PROF_FALL_MS); p->y++; }
        if (on_floor(t)) stage_clear(t);
        return;
    }
    if (p->state == PS_FALL) { p->state = PS_WALK; p->t = 0; }
    p->t = (WORD)(p->t + dt);
    if (p->t < WALK_MS) return;
    p->t = (WORD)(p->t - WALK_MS);
    nx = p->dir == 1 ? p->x + 2 : p->x - 1;
    if (p_blocked(t, nx, p->y) || p_blocked(t, nx, p->y + 1)) { p->dir = (BYTE)(p->dir == 1 ? 0 : 1); return; }
    p->x = (BYTE)(p->dir == 1 ? p->x + 1 : p->x - 1); p->frame ^= 1;
}

static BYTE drop_every(const Track *t)
{
    int k = B->ceil - CEIL0;
    return DROP_EVERY[k > 10 ? 10 : k];
}

static void drop_ceiling(Track *t)
{
    int row;
    B->ceil++;
    B->placedSince = 0;
    row = ceil_row(t) - 1;
    if (row >= 0 && row < ROWS) clear_row(t, row);
    spike_row(t, ceil_row(t));
    trk_sfx(t, S_GARBAGE);
    if (B->prof.y < ceil_row(t)) prof_dies(t);
}

/* ---------------------------------------------------------------- lock */
static void lock_piece(Track *t)
{
    SBYTE c[4][2];
    BYTE allHidden = 1, n, ts, i;
    ts = t->kind == TK_CLIMB ? 0 : tspin_kind(t);
    cells_of(B->ptype, B->prot, B->px, B->py, c);
    for (i = 0; i < 4; i++) {
        if (c[i][1] >= 0) B->grid[c[i][1]][c[i][0]] = B->ptype;
        if (c[i][1] >= HIDDEN) allHidden = 0;
    }
    trk_sfx(t, S_LOCK);
    if (t->kind == TK_CLIMB) {
        if (B->solIdx >= 0 && B->solIdx < B->soln) {
            SBYTE s[4][2];
            PieceSpot *sp = &B->solPlan[B->solIdx];
            cells_of(sp->type, sp->rot, sp->x, 0, s);
            B->solIdx = (SBYTE)((sp->type == B->ptype && same_shape(s, c)) ? B->solIdx + 1 : -1);
        } else B->solIdx = -1;
        B->hasPiece = 0;
        n = clear_lines(t);
        if (n) score_clear(t, n, 0); else land_garbage(t);
        if (t->dead) return;
        B->placedSince++;
        if (B->placedSince >= drop_every(t)) drop_ceiling(t);
        if (t->dead) return;
        spike_row(t, ceil_row(t));
        spawn(t, 0);
        return;
    }
    n = clear_lines(t);
    if (n) score_clear(t, n, ts);
    else {
        B->combo = -1;
        if (ts) { trk_say(t, ts == 2 ? "T-SPIN" : "MINI T-SPIN", PAL_VIOLET); t->bigMark = 1; }
        land_garbage(t);
    }
    if (allHidden && !n) { die(t); return; }
    if (t->dead) return;
    B->holdUsed = 0;
    spawn(t, 0);
}

static void hold(Track *t)
{
    BYTE cur;
    if (!B->s->hold || B->holdUsed) return;
    cur = B->ptype;
    if (B->holdType) { BYTE h = B->holdType; B->holdType = cur; spawn(t, h); }
    else { B->holdType = cur; spawn(t, 0); }
    B->holdUsed = 1;
    trk_sfx(t, S_HOLD);
}

static void hard_drop(Track *t)
{
    B->py = ghost_y(t);
    trk_sfx(t, S_HARD);
    lock_piece(t);
}

/* ---------------------------------------------------------------- CPU */
static const WORD CPU_THINK[9] = { 0, 660, 560, 430, 390, 320, 260, 200, 130 };
static const WORD CPU_STEP[9] = { 0, 160, 140, 120, 100, 90, 80, 60, 50 };
static const BYTE CPU_MISTAKE[9] = { 0, 30, 25, 20, 15, 10, 7, 4, 2 };

static WORD base_rows[ROWS];
static BYTE POPC[16] = { 0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4 };
#define POP10(m) (POPC[(m) & 15] + POPC[((m) >> 4) & 15] + POPC[((m) >> 8) & 3])

static WORD coll_rows[ROWS];          /* base_rows plus Climb's ceiling, for collisions */
static WORD PM[8][4][4];               /* piece row masks [type][rot][row] */
static BYTE pm_ready;

static void load_base_rows(const Track *t)
{
    int y, c, top = t->kind == TK_CLIMB ? ceil_row(t) : 0, ty, r, i;
    if (!pm_ready) {
        for (ty = 1; ty < 8; ty++) for (r = 0; r < 4; r++) {
            for (i = 0; i < 4; i++) PM[ty][r][i] = 0;
            for (i = 0; i < 4; i++) PM[ty][r][SH[ty][r][i][1]] |= (WORD)(1 << SH[ty][r][i][0]);
        }
        pm_ready = 1;
    }
    for (y = 0; y < ROWS; y++) {
        WORD m = 0;
        for (c = 0; c < COLS; c++) if (B->grid[y][c]) m |= (WORD)(1 << c);
        base_rows[y] = m;
        coll_rows[y] = (WORD)(y < top ? 0x3ff : m);
    }
}

/* collides() with row bitmasks: much cheaper for the CPU's search */
static BYTE fast_collide(BYTE type, BYTE rot, int x, int y)
{
    int k, cy;
    WORD m, s;
    for (k = 0; k < 4; k++) {
        m = PM[type][rot][k];
        if (!m) continue;
        cy = y + k;
        if (cy >= ROWS) return 1;
        if (x >= 0) { s = (WORD)(m << x); if (s & ~0x3ff) return 1; }
        else { if (m & ((1 << -x) - 1)) return 1; s = (WORD)(m >> -x); }
        if (cy >= 0 && (coll_rows[cy] & s)) return 1;
    }
    return 0;
}

static SDWORD eval_place(const Track *t, BYTE type, BYTE rot, int x, int y)
{
    WORD rows[ROWS], seen = 0, m, nw;
    int i, yy, c, lines = 0, agg = 0, holes = 0, bump = 0, maxH = 0, h[COLS];
    SDWORD sc;
    SBYTE cs[4][2];
    for (yy = 0; yy < ROWS; yy++) rows[yy] = base_rows[yy];
    cells_of(type, rot, x, y, cs);
    for (i = 0; i < 4; i++) if (cs[i][1] >= 0) rows[cs[i][1]] |= (WORD)(1 << cs[i][0]);
    for (yy = ROWS - 1; yy >= 0; yy--) {
        if (rows[yy] == 0x3ff) {
            for (i = yy; i > 0; i--) rows[i] = rows[i - 1];
            rows[0] = 0; lines++; yy++;
        }
    }
    for (c = 0; c < COLS; c++) h[c] = 0;
    for (yy = 0; yy < ROWS; yy++) {
        m = rows[yy];
        holes += POP10(seen & ~m & 0x3ff);
        nw = (WORD)(m & ~seen);
        if (nw) for (c = 0; c < COLS; c++) if (nw & (1 << c)) h[c] = ROWS - yy;
        seen |= m;
    }
    for (c = 0; c < COLS; c++) { agg += h[c]; if (h[c] > maxH) maxH = h[c]; }
    for (c = 0; c < COLS - 1; c++) bump += h[c] > h[c + 1] ? h[c] - h[c + 1] : h[c + 1] - h[c];
    sc = -51L * agg + (maxH > 14 ? 150L : 76L) * lines - 36L * holes - 18L * bump;
    /* track bonuses */
    if (t->kind == TK_ARSENAL && lines) sc += 30L * lines;
    if (t->kind == TK_POWER && lines) sc += 25L * lines;
    if (t->kind == TK_CLIMB) {
        const Prof *p = &B->prof;
        if (B->solIdx >= 0 && B->solIdx < B->soln) {
            SBYTE s[4][2];
            const PieceSpot *sp = &B->solPlan[B->solIdx];
            cells_of(sp->type, sp->rot, sp->x, 0, s);
            if (sp->type == type && same_shape(s, cs)) sc += 10000L;
        }
        for (i = 0; i < 4; i++) if (cs[i][0] >= p->x && cs[i][0] <= p->x + 1 && cs[i][1] >= p->y && cs[i][1] <= p->y + 1) sc -= 200;
        sc += 80L * lines;
    }
    return sc;
}

/* one rotation's placements per call (the search is spread over frames) */
static void cpu_search_step(Track *t)
{
    BrickCpu *c = &B->cpu;
    BYTE type = B->ptype, rot = c->rotNow;
    int x, y, i, above;
    SDWORD sc;
    if (rot == 0) load_base_rows(t);
    for (x = -3; x < COLS; x++) {
        if (fast_collide(type, rot, x, B->py)) continue;
        y = B->py;
        while (!fast_collide(type, rot, x, y + 1)) y++;
        above = 1;
        for (i = 0; i < 4; i++) if (y + SH[type][rot][i][1] >= HIDDEN) above = 0;
        if (above) continue;
        sc = eval_place(t, type, rot, x, y);
        if (!c->haveBest || sc > c->bestSc) {
            if (c->haveBest) { c->best2Sc = c->bestSc; c->best2X = c->bestX; c->best2Rot = c->bestRot; }
            c->bestSc = sc; c->bestX = (SBYTE)x; c->bestRot = rot; c->haveBest++;
        } else if (c->haveBest == 1 || sc > c->best2Sc) {
            c->best2Sc = sc; c->best2X = (SBYTE)x; c->best2Rot = rot; c->haveBest++;
        }
    }
    c->rotNow++;
    if (c->rotNow >= (type == 4 ? 1 : 4)) {
        c->think = 0;
        if (c->haveBest) {
            c->plan = 1;
            if (c->haveBest > 1 && cpu_rnd(100) < c->mistake) { c->bestX = c->best2X; c->bestRot = c->best2Rot; }
        }
    }
}

static BYTE cpu_wait_climb(const Track *t)
{
    const Prof *p = &B->prof;
    int y = B->py, i, cx, cy;
    BrickCpu const *c = &B->cpu;
    while (!collides(t, B->ptype, c->bestRot, c->bestX, y + 1)) y++;
    for (i = 0; i < 4; i++) {
        cx = c->bestX + SH[B->ptype][c->bestRot][i][0]; cy = y + SH[B->ptype][c->bestRot][i][1];
        if (cx >= p->x - 1 && cx <= p->x + 2 && cy >= p->y - 1 && cy <= p->y + 2) return 1;
    }
    return 0;
}

static void cpu_weapons(Track *t, WORD dt);
static void cpu_powers(Track *t, WORD dt);

void brick_cpu(Track *t, Pad *pad, WORD dt)
{
    BrickCpu *c = &B->cpu;
    WORD st = 0;
    if (t->kind == TK_ARSENAL) cpu_weapons(t, dt);
    if (t->kind == TK_POWER) cpu_powers(t, dt);
    if (!B->hasPiece) { pad_feed(pad, 0, dt); return; }
    if (t->kind == TK_CLIMB && B->pieceId == c->seen) {
        c->since = (WORD)(c->since + dt);
        if (c->since > 600 && !c->think) { c->since = 0; c->think = 1; c->rotNow = 0; c->haveBest = 0; c->plan = 0; }
    }
    if (B->pieceId != c->seen) {
        c->seen = B->pieceId;
        c->wait = (WORD)((DWORD)CPU_THINK[c->level] * (70 + cpu_rnd(61)) / 100);
        c->since = 0; c->fails = 0;
        c->think = 1; c->rotNow = 0; c->haveBest = 0; c->plan = 0;
    }
    if (c->think && xm_think) cpu_search_step(t);
    if (c->tap) { c->tap = 0; pad_feed(pad, 0, dt); return; }
    if (c->wait > dt) c->wait = (WORD)(c->wait - dt); else c->wait = 0;
    if (c->wait || !c->plan) { pad_feed(pad, 0, dt); return; }
    if (B->prot != c->bestRot && c->fails < 6) { st = B_B; c->fails++; }
    else if (B->px != c->bestX && c->fails < 30) { st = B->px < c->bestX ? B_RIGHT : B_LEFT; c->fails++; }
    else if (t->kind == TK_CLIMB && cpu_wait_climb(t)) { pad_feed(pad, 0, dt); return; }
    else if (B->s->hardDrop) st = B->s->dDrop ? B_D : B_UP;
    else { pad_feed(pad, B_DOWN, dt); return; }
    c->tap = 1; c->wait = CPU_STEP[c->level];
    pad_feed(pad, st, dt);
}

void brick_cpu_take(Track *t, BYTE level)
{
    BrickCpu *c = &B->cpu;
    c->level = level; c->step = CPU_STEP[level]; c->mistake = CPU_MISTAKE[level];
    c->seen = (WORD)(B->pieceId - 1); c->think = 0; c->plan = 0;
    B->cpuT = 1500; B->holdT = 0;
}

static BYTE stack_h(const Track *t)
{
    int y;
    for (y = 0; y < ROWS; y++) if (row_any(t, y)) return (BYTE)(ROWS - y);
    return 0;
}
static BYTE stack_holes(const Track *t)
{
    int x, y, seen, n = 0;
    for (x = 0; x < COLS; x++) { seen = 0; for (y = 0; y < ROWS; y++) { if (B->grid[y][x]) seen = 1; else if (seen) n++; } }
    return (BYTE)(n > 255 ? 255 : n);
}

/* Arsenal CPU: when to fire (js cpuWeapons) */
static void cpu_weapons(Track *t, WORD dt)
{
    BYTE w, maxH, holes, use = 0;   /* 1 self, 2 opp, 3 throw */
    Track *o = t->opp;
    if (B->cpuT > dt) { B->cpuT = (WORD)(B->cpuT - dt); return; }
    B->cpuT = 0;
    if (!B->invn) return;
    B->cpuT = (WORD)(500 + (9 - B->cpu.level) * 180);
    w = B->inv[0]; maxH = stack_h(t); holes = stack_holes(t);
    B->holdT = (WORD)(B->holdT + 500);
    switch (w) {
    case W_WIPE: use = maxH > 13 ? 1 : 0; break;
    case W_REMOVE: use = maxH > 3 ? 1 : 0; break;
    case W_GRAVITY: use = holes > 2 ? 1 : (B->holdT > 6000 ? 3 : 0); break;
    case W_SLOW: use = t->speedLv > -2 ? 1 : 3; break;
    case W_EMPTY:
        use = works_on_opp(t, w) && (brick_inv_count(o) || (o->kind == TK_POWER && power_stars(o) >= 2)) ? 2 :
              (B->holdT > 4000 || !works_on_opp(t, w) ? 3 : 0);
        break;
    case W_SWAP: use = !works_on_opp(t, w) ? 3 : maxH > 11 ? 2 : (B->holdT > 6000 ? 3 : 0); break;
    default: use = works_on_opp(t, w) ? 2 : 3; break;
    }
    if (use && cpu_rnd(100) < (WORD)(25 - B->cpu.level * 3)) use = 3;
    if (!use) { if (B->invn >= SLOTS && B->holdT > 3000) use = w_self(w) ? 1 : 3; else return; }
    B->holdT = 0;
    if (use == 3) discard(t); else fire(t, (BYTE)(use == 1));
}

/* Power Brick CPU: save up, but use what's there when in trouble */
static void cpu_powers(Track *t, WORD dt)
{
    BYTE st, h, goal;
    if (B->cpuT > dt) { B->cpuT = (WORD)(B->cpuT - dt); return; }
    B->cpuT = (WORD)(400 + (9 - B->cpu.level) * 150);
    st = power_stars(t);
    if (!st) return;
    h = stack_h(t); goal = (BYTE)(2 + B->cpu.level / 3);
    if (st == 1 && h > 11) { cast(t); return; }
    if (st == 2 && !B->shield && trk_pending_total(t) >= 3) { cast(t); return; }
    if (st >= goal || st == MAX_STARS) cast(t);
}

/* ---------------------------------------------------------------- weapon effects */
BYTE brick_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int x, y, wr;
    w &= 0x7f;
    switch (w) {
    case W_WIPE:
        if (q) return 1;
        if (t->kind == TK_CLIMB) { B->stage--; new_stage(t); }
        else for (y = 0; y < ROWS; y++) clear_row(t, y);
        return 1;
    case W_REMOVE:
        if (t->kind == TK_CLIMB) return 0;
        if (q) return 1;
        remove_row(t, ROWS - 1);
        return 1;
    case W_GRAVITY:
        if (t->kind == TK_CLIMB) return 0;
        if (q) return 1;
        for (x = 0; x < COLS; x++) {
            wr = ROWS - 1;
            for (y = ROWS - 1; y >= 0; y--) if (B->grid[y][x]) { BYTE v = B->grid[y][x]; B->grid[y][x] = 0; B->grid[wr--][x] = v; }
        }
        if (B->hasPiece && collides(t, B->ptype, B->prot, B->px, B->py)) { B->py = (SBYTE)(B->py - 2); if (B->py < -1) B->py = -1; }
        return 1;
    case W_EMPTY:
        if (t->kind == TK_ARSENAL) { if (!q) B->invn = 0; return 1; }
        if (t->kind == TK_POWER) { if (!q) { B->points = 0; B->shield = 0; } return 1; }
        return 0;
    }
    return 0;
}
BYTE brick_safe(const Track *t) { (void)t; return 1; }

/* ---------------------------------------------------------------- init / update */
void brick_init(Track *t)
{
    shapes_init();
    switch (t->kind) {
    case TK_ARSENAL: B->s = &SET_ARSENAL; break;
    case TK_POWER:   B->s = &SET_POWER; break;
    case TK_CLIMB:   B->s = &SET_CLIMB; break;
    default:         B->s = &SET_BRICK; break;
    }
    t->cancelOn = B->s->cancel;
    B->combo = -1; B->crystal = -1; B->solIdx = -1;
    if (t->cpu) {
        B->cpu.level = t->cpu; B->cpu.step = CPU_STEP[t->cpu]; B->cpu.mistake = CPU_MISTAKE[t->cpu];
        B->cpu.seen = 0xffff; B->cpuT = 1500;
    }
    if (t->kind == TK_CLIMB) { B->ceil = CEIL0; new_stage(t); return; }
    fill_queue(t);
    spawn(t, 0);
}

void brick_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h)
{
    *x = FX; *y = FY; *w = COLS;
    *h = t->kind == TK_CLIMB ? FIELD_H : ROWS - HIDDEN;
}

void brick_update(Track *t, Pad *pad, WORD dt)
{
    WORD interval, softMs;
    BYTE soft, L, R;
    if (B->clearT) B->clearT = B->clearT > dt ? (WORD)(B->clearT - dt) : 0;
    if (t->kind == TK_CLIMB) {
        if (!t->dead) update_prof(t, dt);
        if (t->dead || B->prof.state == PS_WIN) { if (!t->dead) trk_tick_pending(t, dt); return; }
    }
    if (t->dead) return;
    trk_tick_pending(t, dt);
    B->elapsed += dt;
    if (t->kind == TK_ARSENAL) {
        BYTE left = (BYTE)(t->side == 0);
        if (PAD_PRESSED(pad, B_C)) fire(t, left);
        if (PAD_PRESSED(pad, B_D)) fire(t, (BYTE)!left);
        if (PAD_PRESSED(pad, B_SELECT)) discard(t);
    }
    if (t->kind == TK_POWER && PAD_PRESSED(pad, B_C)) cast(t);
    if (!B->hasPiece) return;
    if (PAD_PRESSED(pad, B_A)) rotate(t, -1);
    if (PAD_PRESSED(pad, B_B)) rotate(t, 1);
    if (B->s->hold && PAD_PRESSED(pad, B_C)) { hold(t); if (t->dead) return; }
    if (B->s->hardDrop && ((B->s->dDrop && PAD_PRESSED(pad, B_D)) || PAD_PRESSED(pad, B_UP))) { hard_drop(t); return; }

    L = (BYTE)PAD_DOWN(pad, B_LEFT); R = (BYTE)PAD_DOWN(pad, B_RIGHT);
    if (PAD_PRESSED(pad, B_LEFT)) { B->dasDir = -1; B->dasT = 0; B->arrT = 0; move(t, -1); }
    else if (PAD_PRESSED(pad, B_RIGHT)) { B->dasDir = 1; B->dasT = 0; B->arrT = 0; move(t, 1); }
    if ((B->dasDir < 0 && !L) || (B->dasDir > 0 && !R)) { B->dasDir = (SBYTE)(L ? -1 : R ? 1 : 0); B->dasT = 0; }
    if (B->dasDir) {
        B->dasT = (WORD)(B->dasT + dt);
        if (B->dasT >= DAS) {
            B->dasT = DAS;
            B->arrT = (WORD)(B->arrT + dt);
            while (B->arrT >= ARR) { B->arrT = (WORD)(B->arrT - ARR); if (!move(t, B->dasDir)) { B->arrT = 0; break; } }
        }
    }

    soft = (BYTE)PAD_DOWN(pad, B_DOWN);
    interval = gravity_ms(t);
    softMs = B->s->softMs ? B->s->softMs : (B->s->fastSoft ? 50 : 100);
    if (soft && interval > softMs) interval = softMs;
    if (soft && !B->wasSoft && B->gravT > interval) B->gravT = interval;
    B->wasSoft = soft;
    B->gravT += dt;
    while (B->gravT >= interval) {
        B->gravT -= interval;
        if (!on_ground(t)) {
            B->py++; B->lastRot = 0;
            if (B->py > B->lowest) { B->lowest = B->py; B->resets = 0; }
        } else { B->gravT = 0; break; }
    }
    if (on_ground(t)) {
        B->lockT = (WORD)(B->lockT + dt);
        if (B->lockT >= LOCK_MS) lock_piece(t);
    } else B->lockT = 0;
}

/* ---------------------------------------------------------------- drawing */
static BYTE pal_of(BYTE c)
{
    if (c & BC_LETTER) return w_self((BYTE)(c & 15)) ? PAL_CYAN : PAL_ORANGE;
    c = cell_type(c);
    return (BYTE)(c + 1);     /* I=2 pink .. Z=8 red, garbage=9 grey */
}
static WORD cell_word(BYTE c)
{
    if (c & BC_LETTER) return TW(pal_of(c), TB3(T_LETTER + (c & 15) - 1));
    if (c & BC_CRYSTAL) return TW(pal_of(c), TB3(T_CRYSTAL));
    return TW(pal_of(c), TB3(T_BRICK));
}

/* a small piece for HOLD / NEXT: 8 px bricks; I stands upright to fit 3 columns */
static void mini(int x, int y, BYTE type)
{
    BYTE rot = type == 1 ? 1 : 0, i;
    int ox = type == 1 ? -2 : 0;
    if (!type) return;
    for (i = 0; i < 4; i++) cv_put(x + ox + SH[type][rot][i][0], y + SH[type][rot][i][1] - (type == 1 ? 0 : 0), TW((BYTE)(type + 1), TB3(T_BRICK)));
}

static void draw_climb(Track *t, int ox);

void brick_draw(Track *t, int ox)
{
    int x, y, i, fx = ox + FX;
    BYTE c;
    if (t->kind == TK_CLIMB) { draw_climb(t, ox); return; }
    cv_frame(fx, FY, COLS, ROWS - HIDDEN, PAL_STEEL);
    for (y = HIDDEN; y < ROWS; y++) for (x = 0; x < COLS; x++) {
        c = B->grid[y][x];
        if ((B->clearT && (B->clearRows & (1UL << y)))) cv_put(fx + x, FY + y - HIDDEN, TW(PAL_WHITE, TB3(T_SOLID)));
        else cv_put(fx + x, FY + y - HIDDEN, c ? cell_word(c) : TW(PAL_STEEL, TB3(T_EMPTY)));
    }
    if (!t->dead && B->hasPiece) {
        SBYTE cs[4][2];
        if (B->s->ghost) {
            cells_of(B->ptype, B->prot, B->px, ghost_y(t), cs);
            for (i = 0; i < 4; i++) if (cs[i][1] >= HIDDEN) cv_put(fx + cs[i][0], FY + cs[i][1] - HIDDEN, TW((BYTE)(B->ptype + 1), TB3(T_GHOST)));
        }
        cells_of(B->ptype, B->prot, B->px, B->py, cs);
        for (i = 0; i < 4; i++) if (cs[i][1] >= HIDDEN)
            cv_put(fx + cs[i][0], FY + cs[i][1] - HIDDEN, TW((BYTE)(B->ptype + 1), TB3(i == B->crystal ? T_CRYSTAL : T_BRICK)));
    }
    /* next pieces (right) */
    cv_text(ox + 17, FY - 1, PAL_BEIGE, "NXT");
    for (i = 0; i < B->s->preview && i < 5; i++) mini(ox + 17, FY + i * 4, B->queue[i]);
    cv_pending(ox + 4, FY, ROWS - HIDDEN, t, 8, B->s->garbageDelay ? GARBAGE_DELAY : 0);
    /* left panel */
    if (t->kind == TK_ARSENAL) {
        cv_text(ox, FY - 1, PAL_BEIGE, "ARMS");
        for (i = 0; i < SLOTS; i++) {
            if (i < B->invn) {
                BYTE w = B->inv[i];
                cv_put(ox + 1, FY + i * 2, TW(works_on_opp(t, w) ? (w_self(w) ? PAL_CYAN : PAL_ORANGE) : PAL_RED, TB3(T_LETTER + w - 1)));
            } else cv_put(ox + 1, FY + i * 2, TW(PAL_STEEL, TB3(T_EMPTY)));
            if (i == 0) cv_put(ox, FY, TW(PAL_YELLOW, TB3(T_ARROW)));
        }
        cv_text(ox, FY + 17, PAL_GREY, "LINE");
        cv_text(ox, FY + 18, PAL_AMBER, cv_num(B->lines));
        if (B->invn) {
            BYTE w = B->inv[0];
            cv_text(ox + 1, FY + 21, works_on_opp(t, w) ? PAL_YELLOW : PAL_RED, W_SHORT[w]);
            cv_text(ox + 7, FY + 21, PAL_GREY, t->side ? "C:1P D:ME" : "C:ME D:2P");
        }
    } else if (t->kind == TK_POWER) {
        BYTE st = power_stars(t), part;
        cv_text(ox, FY - 1, PAL_BEIGE, "POWR");
        for (i = MAX_STARS; i >= 1; i--) {
            int yy = FY + (MAX_STARS - i) * 2;
            BYTE on = (BYTE)(i <= st);
            cv_put(ox, yy, TW(on ? PAL_YELLOW : PAL_STEEL, TB3(on ? T_STAR : T_STAR_OFF)));
            cv_text(ox + 1, yy, on ? (i <= 2 ? PAL_CYAN : PAL_PINK) : PAL_STEEL, POWER_SHORT[i]);
        }
        part = st >= MAX_STARS ? PER_STAR : (BYTE)(B->points - st * PER_STAR);
        for (i = 0; i < PER_STAR; i++) cv_put(ox + i, FY + 10, TW(i < part ? PAL_PINK : PAL_STEEL, TB3(T_LINE_H)));
        if (B->shield) cv_text(ox, FY + 12, PAL_CYAN, "SHLD");
        cv_text(ox, FY + 17, PAL_GREY, "LINE");
        cv_text(ox, FY + 18, PAL_AMBER, cv_num(B->lines));
        if (st) { cv_text(ox + 3, FY + 21, PAL_YELLOW, "C: "); cv_text(ox + 6, FY + 21, PAL_YELLOW, POWER_NAME[st]); }
    } else {
        cv_text(ox, FY - 1, PAL_BEIGE, "HOLD");
        if (B->holdType) mini(ox + 2, FY + 1, B->holdType);
        cv_text(ox, FY + 14, PAL_GREY, "LINE");
        cv_text(ox, FY + 15, PAL_AMBER, cv_num(B->lines));
        cv_text(ox, FY + 17, PAL_GREY, "LV");
        cv_text(ox, FY + 18, PAL_GREEN, cv_num(level_of(t)));
    }
}

static void draw_climb(Track *t, int ox)
{
    int x, y, fx = ox + FX, i, r;
    BYTE c, ceil = B->ceil;
    const Prof *p = &B->prof;
    cv_frame(fx, FY, COLS, FIELD_H, PAL_STEEL);
    for (y = 0; y < FIELD_H; y++) for (x = 0; x < COLS; x++) {
        r = TOP + y;
        c = B->grid[r][x];
        if (y < ceil - 1) cv_put(fx + x, FY + y, TW(PAL_STEEL, TB3((x == 2 || x == 7) ? T_CHAIN : T_CEIL)));
        else if (y == ceil - 1) cv_put(fx + x, FY + y, TW(PAL_STEEL, TB3(T_SPIKES)));
        else if (B->clearT && (B->clearRows & (1UL << r))) cv_put(fx + x, FY + y, TW(PAL_WHITE, TB3(T_SOLID)));
        else cv_put(fx + x, FY + y, c ? cell_word(c) : TW(PAL_STEEL, TB3(T_EMPTY)));
    }
    /* professor (2x2 tiles); bricks fall over him */
    {
        BYTE f = p->state == PS_CLIMB ? 2 : p->state == PS_DEAD ? 4 : p->frame;
        int py = FY + p->y - TOP, px = fx + p->x;
        if (p->state == PS_WIN) {
            if (p->t < 400) py = FY + FIELD_H - 2;
            else if (p->t < 1800) { f = 3; py = FY + FIELD_H - 2; }
            else { f = (BYTE)((p->t >> 7) & 1); py = FY + FIELD_H - 2; px += (int)((p->t - 1800) / 200); }
        }
        if (px < fx + COLS - 1 && py >= FY) {
            BYTE flip = (BYTE)(p->dir == 0);
            WORD base = TB4(C_PROF(f));
            /* the tiles are drawn facing right; facing left swaps the columns (the art is symmetric enough) */
            cv_put(px + (flip ? 1 : 0), py, TW(PAL_CYAN, base));
            cv_put(px + (flip ? 0 : 1), py, TW(PAL_CYAN, (WORD)(base + 1)));
            cv_put(px + (flip ? 1 : 0), py + 1, TW(PAL_CYAN, (WORD)(base + 2)));
            cv_put(px + (flip ? 0 : 1), py + 1, TW(PAL_CYAN, (WORD)(base + 3)));
        }
    }
    if (!t->dead && B->hasPiece) {
        SBYTE cs[4][2];
        cells_of(B->ptype, B->prot, B->px, B->py, cs);
        for (i = 0; i < 4; i++) if (cs[i][1] >= TOP + ceil) cv_put(fx + cs[i][0], FY + cs[i][1] - TOP, TW((BYTE)(B->ptype + 1), TB3(T_BRICK)));
    }
    cv_text(ox + 17, FY - 1, PAL_BEIGE, "NXT");
    mini(ox + 17, FY, B->queue[0]);
    cv_text(ox, FY - 1, PAL_GREY, "STG");
    cv_text(ox, FY, PAL_AMBER, cv_num(B->stage));
    cv_text(ox, FY + 3, PAL_GREY, "DROP");
    {
        BYTE de = drop_every(t);
        cv_text(ox + 1, FY + 4, PAL_RED, cv_num(de > B->placedSince ? (DWORD)(de - B->placedSince) : 0));
    }
    cv_text(ox, FY + 7, PAL_GREY, "LINE");
    cv_text(ox, FY + 8, PAL_WHITE, cv_num(B->lines));
    cv_pending(ox + 4, FY, FIELD_H, t, 8, GARBAGE_DELAY);
}
