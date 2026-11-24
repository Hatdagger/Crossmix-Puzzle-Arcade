/*
 * POP: Puzzle Bobble-style bubble shooter (js/track-pop.js).
 * Aim with left/right (hold B for fine aim), fire with A, D or Up, C swaps with
 * the next bubble.  3+ of a colour pops; bubbles left hanging drop.  Only drops
 * attack: every 2 dropped = 1 unit.  The ceiling comes down every few shots.
 * Incoming units stick grey bubbles under the cluster (2 per unit).
 * On the Neo Geo the bubbles are 16 px (2x2 fix tiles) with 16 px rows.
 */
#include "xm.h"
#include "tiles.h"
#include "pop_tab.h"

#define COLS PO_COLS
#define MAXR PO_MAXR
#define DEAD PO_DEAD
#define NC 6
#define GREY 9
#define R 8                 /* radius, px */
#define D 16
#define RH 16
#define W (COLS * D)
#define LY (R + DEAD * RH)  /* launcher centre */
#define TICKS 200
#define STEP 2
#define SPEED_Q8 141        /* 0.55 px per ms */
#define AIM_DELAY 150
#define AIM_RATE 12
#define AIM_FINE 45
#define START_ROWS 5
#define DROP_EVERY 12
#define DROP_MIN 7
#define DROP_FASTER 30000UL
#define HURRY 8000
#define GARBAGE_DELAY 1000
#define MAX_GARBAGE 4
#define GREYS_PER_UNIT 2
#define UNITS_PER_CEIL 8
#define FLASH 260
#define SEND_Q8 218         /* x0.85 */

#define FX 3
#define FY 1

enum { ST_AIM, ST_FLY, ST_POP, ST_OVER };
static const BYTE KPAL[NC] = { PAL_RED, PAL_BLUE, PAL_GREEN, PAL_YELLOW, PAL_VIOLET, PAL_WHITE };

#define P (&t->u.p)
typedef SBYTE Grid[MAXR][COLS];

/* macros, not functions: these run thousands of times a frame and a 68000 call is slow */
#define row_len(r) (((r) & 1) ? COLS - 1 : COLS)
#define cell_x(r, c) (R + (c) * D + (((r) & 1) ? R : 0))
#define cell_y(r) (R + (r) * RH)
#define in_grid(r, c) ((r) >= 0 && (r) < MAXR && (c) >= 0 && (c) < row_len(r))

static int neighbours(int r, int c, SBYTE out[6][2])
{
    static const SBYTE ODD[4][2] = { {-1,0}, {-1,1}, {1,0}, {1,1} }, EVEN[4][2] = { {-1,-1}, {-1,0}, {1,-1}, {1,0} };
    const SBYTE (*o)[2];
    int n = 0, k, rr, cc;
    if (r & 1) o = ODD; else o = EVEN;
    if (in_grid(r, c - 1)) { out[n][0] = (SBYTE)r; out[n][1] = (SBYTE)(c - 1); n++; }
    if (in_grid(r, c + 1)) { out[n][0] = (SBYTE)r; out[n][1] = (SBYTE)(c + 1); n++; }
    for (k = 0; k < 4; k++) { rr = r + o[k][0]; cc = c + o[k][1]; if (in_grid(rr, cc)) { out[n][0] = (SBYTE)rr; out[n][1] = (SBYTE)cc; n++; } }
    return n;
}

/* ---------------------------------------------------------------- flight */
typedef struct { SDWORD x, y, vx, vy; } Shot;

static void new_shot(WORD tick, Shot *s)
{
    s->x = (SDWORD)(W / 2) << 8; s->y = (SDWORD)LY << 8;
    s->vx = AIM_VX[tick]; s->vy = AIM_VY[tick];
}

/* lowest row with a bubble, kept up to date by the callers (-1: empty) */
static int low_row(Grid g)
{
    int r, c;
    for (r = MAXR - 1; r >= 0; r--) for (c = 0; c < COLS; c++) if (g[r][c] >= 0) return r;
    return -1;
}

/* one sub-step of `step` px; returns 1 when the bubble touches the ceiling or another bubble.
   low = lowest occupied row: below it nothing can be hit, so most steps cost almost nothing */
static BYTE step_shot(Grid g, int top, Shot *s, int step, int low)
{
    int gy, r0, r, c, c0, dx, dy, x;
    s->x += s->vx * step; s->y += s->vy * step;
    if (s->x < ((SDWORD)R << 8)) { s->x = ((SDWORD)(2 * R) << 8) - s->x; s->vx = -s->vx; }
    if (s->x > ((SDWORD)(W - R) << 8)) { s->x = ((SDWORD)(2 * (W - R)) << 8) - s->x; s->vx = -s->vx; }
    gy = (int)(s->y >> 8) - top; x = (int)(s->x >> 8);
    if (gy <= R) return 1;
    if (gy > R + (low + 1) * RH + D) return 0;
    r0 = (gy - R + RH / 2) / RH;
    for (r = r0 - 1; r <= r0 + 1; r++) {
        if (r < 0 || r >= MAXR) continue;
        c0 = (x - ((r & 1) ? R : 0)) / D;
        for (c = c0 - 1; c <= c0 + 1; c++) {
            if (c < 0 || c >= row_len(r) || g[r][c] < 0) continue;
            dx = cell_x(r, c) - x; dy = cell_y(r) - gy;
            if (dx > -(D - 1) && dx < D - 1 && dy > -(D - 1) && dy < D - 1 && dx * dx + dy * dy < (D - 2) * (D - 2)) return 1;
        }
    }
    return 0;
}

static void snap(Grid g, int top, const Shot *s, int *br, int *bc)
{
    int gy = (int)(s->y >> 8) - top, x = (int)(s->x >> 8), r0, r, c, dx, dy, d, bd = 0x7fff;
    r0 = (gy - R + RH / 2) / RH; if (r0 < 0) r0 = 0;
    *br = -1;
    for (r = r0 - 1; r <= r0 + 1; r++) {
        if (r < 0 || r >= MAXR) continue;
        for (c = 0; c < row_len(r); c++) {
            if (g[r][c] >= 0) continue;
            dx = cell_x(r, c) - x; dy = cell_y(r) - gy; d = dx * dx + dy * dy;
            if (d < bd) { bd = d; *br = r; *bc = c; }
        }
    }
    if (*br < 0) {
        *br = r0 < MAXR ? r0 : MAXR - 1;
        *bc = x / D; if (*bc >= row_len(*br)) *bc = row_len(*br) - 1; if (*bc < 0) *bc = 0;
    }
}

/* ---------------------------------------------------------------- groups */
static BYTE seen_[MAXR][COLS];

static int group(Grid g, int r, int c, SBYTE out[][2])
{
    SBYTE q[MAXR * COLS][2], nb[6][2];
    int qn = 0, n = 0, k, i, j;
    SBYTE kk = g[r][c];
    for (i = 0; i < MAXR; i++) for (j = 0; j < COLS; j++) seen_[i][j] = 0;
    q[qn][0] = (SBYTE)r; q[qn][1] = (SBYTE)c; qn++; seen_[r][c] = 1;
    while (qn) {
        qn--;
        out[n][0] = q[qn][0]; out[n][1] = q[qn][1];
        k = neighbours(out[n][0], out[n][1], nb);
        n++;
        for (i = 0; i < k; i++) if (!seen_[nb[i][0]][nb[i][1]] && g[nb[i][0]][nb[i][1]] == kk) { seen_[nb[i][0]][nb[i][1]] = 1; q[qn][0] = nb[i][0]; q[qn][1] = nb[i][1]; qn++; }
    }
    return n;
}

/* remove everything not held up by the ceiling row; returns how many dropped */
static int drop_floating(Grid g)
{
    SBYTE q[MAXR * COLS][2], nb[6][2];
    int qn = 0, r, c, i, k, n = 0;
    for (r = 0; r < MAXR; r++) for (c = 0; c < COLS; c++) seen_[r][c] = 0;
    for (c = 0; c < COLS; c++) if (g[0][c] >= 0) { seen_[0][c] = 1; q[qn][0] = 0; q[qn][1] = (SBYTE)c; qn++; }
    while (qn) {
        qn--; r = q[qn][0]; c = q[qn][1];
        k = neighbours(r, c, nb);
        for (i = 0; i < k; i++) if (!seen_[nb[i][0]][nb[i][1]] && g[nb[i][0]][nb[i][1]] >= 0) { seen_[nb[i][0]][nb[i][1]] = 1; q[qn][0] = nb[i][0]; q[qn][1] = nb[i][1]; qn++; }
    }
    for (r = 0; r < MAXR; r++) for (c = 0; c < row_len(r); c++) if (g[r][c] >= 0 && !seen_[r][c]) { g[r][c] = -1; n++; }
    return n;
}

static int lowest(Grid g)
{
    int r, c;
    for (r = MAXR - 1; r >= 0; r--) for (c = 0; c < row_len(r); c++) if (g[r][c] >= 0) return r;
    return -1;
}

/* place k at (r, c); mark what pops (1) and which greys break (2). Returns popped count. */
static int resolve(Grid g, int r, int c, SBYTE k, BYTE mark[MAXR][COLS], int *greys)
{
    SBYTE grp[MAXR * COLS][2], nb[6][2];
    int n, i, j, kk;
    g[r][c] = k;
    *greys = 0;
    for (i = 0; i < MAXR; i++) for (j = 0; j < COLS; j++) mark[i][j] = 0;
    if (k == GREY) return 0;
    n = group(g, r, c, grp);
    if (n < 3) return 0;
    for (i = 0; i < n; i++) mark[grp[i][0]][grp[i][1]] = 1;
    for (i = 0; i < n; i++) {
        kk = neighbours(grp[i][0], grp[i][1], nb);
        for (j = 0; j < kk; j++) if (g[nb[j][0]][nb[j][1]] == GREY && !mark[nb[j][0]][nb[j][1]]) { mark[nb[j][0]][nb[j][1]] = 2; (*greys)++; }
    }
    return n;
}

static int remove_marked(Grid g, BYTE mark[MAXR][COLS])
{
    int r, c;
    for (r = 0; r < MAXR; r++) for (c = 0; c < COLS; c++) if (mark[r][c]) g[r][c] = -1;
    return drop_floating(g);
}

/* ---------------------------------------------------------------- the track */
static void die(Track *t) { if (!t->dead) { t->dead = 1; P->state = ST_OVER; trk_sfx(t, S_KO); } }

static void fill(Track *t, int rows)
{
    int r, c;
    for (r = 0; r < rows; r++) for (c = 0; c < row_len(r); c++) {
        SBYTE k = (SBYTE)trk_rnd(t, NC);
        if (c && trk_rnd(t, 10) < 3) k = P->grid[r][c - 1];
        P->grid[r][c] = k;
    }
}

static BYTE colors_on_board(const Track *t, BYTE *have)
{
    int r, c, n = 0, i;
    SBYTE k;
    for (r = 0; r < MAXR; r++) for (c = 0; c < row_len(r); c++) {
        k = P->grid[r][c];
        if (k < 0 || k >= NC) continue;
        for (i = 0; i < n; i++) if (have[i] == k) break;
        if (i == n) have[n++] = (BYTE)k;
    }
    return (BYTE)n;
}

static BYTE pick_color(Track *t)
{
    BYTE have[NC], n = colors_on_board(t, have), i, j, tmp;
    if (!n) return (BYTE)trk_rnd(t, NC);
    for (i = 0; i < n; i++) for (j = (BYTE)(i + 1); j < n; j++) if (have[j] < have[i]) { tmp = have[i]; have[i] = have[j]; have[j] = tmp; }
    return have[trk_rnd(t, n)];
}

static int top_px(const Track *t) { return P->drop * RH; }
static BYTE drop_every(const Track *t)
{
    DWORD e = P->elapsed; int v = DROP_EVERY;
    while (e >= DROP_FASTER && v > DROP_MIN) { e -= DROP_FASTER; v--; }
    return (BYTE)v;
}
static void check_line(Track *t) { if (lowest(P->grid) + P->drop >= DEAD) die(t); }

static void fire(Track *t)
{
    Shot s;
    new_shot(P->tick, &s);
    P->sx = s.x; P->sy = s.y; P->svx = s.vx; P->svy = s.vy; P->sk = P->cur;
    P->cur = P->next; P->next = pick_color(t);
    P->state = ST_FLY; P->dist = 0; P->idle = 0;
    trk_sfx(t, S_HARD);
}

static void lower_ceiling(Track *t) { P->drop++; P->shake = 300; trk_sfx(t, S_GARBAGE); }

static int grey_spot(Track *t, int x, int *br, int *bc)
{
    int r, c, i, k, up, upGrey, s, bs = -32000, dx;
    SBYTE nb[6][2];
    *br = -1; *bc = 0;
    while (x < 0) x += W;
    while (x >= W) x -= W;
    for (r = 0; r < MAXR; r++) for (c = 0; c < row_len(r); c++) {
        if (P->grid[r][c] >= 0) continue;
        if (r == 0) { up = 2; upGrey = 0; }
        else {
            up = 0; upGrey = 0;
            k = neighbours(r, c, nb);
            for (i = 0; i < k; i++) if (nb[i][0] < r) {
                SBYTE v = P->grid[nb[i][0]][nb[i][1]];
                if (v >= 0 && v != GREY) up++; else if (v == GREY) upGrey++;
            }
        }
        if (!up && !upGrey) continue;
        dx = cell_x(r, c) - x; if (dx < 0) dx = -dx;
        s = up * 30 - upGrey * 10 - r * 6 - (dx * 4) / 5;
        if (s > bs) { bs = s; *br = r; *bc = c; }
    }
    return *br >= 0;
}

static void land_garbage(Track *t)
{
    Batch bs[8];
    BYTE nb, k;
    WORD total = 0, i;
    int r = 0, c = 0;
    if (!t->vs) return;
    nb = trk_take_ready(t, GARBAGE_DELAY, MAX_GARBAGE, bs, 8);
    if (!nb) return;
    for (k = 0; k < nb; k++) {
        int aim = (int)(((DWORD)bs[k].gap * W) / 1000);
        for (i = 0; i < bs[k].n * GREYS_PER_UNIT; i++) if (grey_spot(t, aim + i * D * 3, &r, &c)) P->grid[r][c] = GREY;
        total = (WORD)(total + bs[k].n);
    }
    P->unitsTaken = (BYTE)(P->unitsTaken + total);
    while (P->unitsTaken >= UNITS_PER_CEIL) { P->unitsTaken -= UNITS_PER_CEIL; lower_ceiling(t); }
    trk_sfx(t, S_GARBAGE);
}

static void after_shot(Track *t, BYTE popped)
{
    BYTE have[NC], n, i, ok;
    if (!popped) land_garbage(t);
    if (t->dead) return;
    if (!P->shotsLeft) { lower_ceiling(t); P->shotsLeft = drop_every(t); }
    check_line(t);
    if (t->dead) return;
    n = colors_on_board(t, have);
    if (n) {
        for (ok = 0, i = 0; i < n; i++) if (have[i] == P->cur) ok = 1;
        if (!ok) P->cur = pick_color(t);
        for (ok = 0, i = 0; i < n; i++) if (have[i] == P->next) ok = 1;
        if (!ok) P->next = pick_color(t);
    }
    P->state = ST_AIM;
}

static void land(Track *t)
{
    Shot s;
    int r, c, greys, n;
    s.x = P->sx; s.y = P->sy; s.vx = P->svx; s.vy = P->svy;
    snap(P->grid, top_px(t), &s, &r, &c);
    P->shots++; if (P->shotsLeft) P->shotsLeft--;
    trk_sfx(t, S_LOCK);
    n = resolve(P->grid, r, c, (SBYTE)P->sk, P->mark, &greys);
    P->npop = (BYTE)n; P->ngrey = (BYTE)greys;
    if (n) { P->state = ST_POP; P->popT = FLASH; trk_sfx(t, S_CLEAR); }
    else after_shot(t, 0);
}

static void finish_pop(Track *t)
{
    int n = remove_marked(P->grid, P->mark), units;
    BYTE big = 0;
    P->dropped = (WORD)(P->dropped + n);
    P->score += (DWORD)P->npop * 10 + (n ? 10UL << (n > 12 ? 12 : n) : 0);
    if (P->ngrey) trk_say(t, P->ngrey > 1 ? "GREYS" : "GREY", PAL_BEIGE);
    units = n / 2; big = (BYTE)(n >= 4);
    if (lowest(P->grid) < 0) {
        units += 3; big = 1; P->clears++;
        trk_say(t, "ALL CLEAR", PAL_GREEN);
        P->drop = 0; fill(t, START_ROWS);
    } else if (n >= 2) trk_say(t, "DROPPED!", n >= 6 ? PAL_YELLOW : PAL_CYAN);
    if (big) { t->bigMark = 1; trk_sfx(t, S_BIG); }
    if (t->vs && units > 0) {
        WORD out;
        P->atkFrac = (WORD)(P->atkFrac + units * SEND_Q8);
        out = (WORD)(P->atkFrac >> 8); P->atkFrac &= 255;
        trk_send(t, out);
    }
    after_shot(t, 1);
}

static void aim(Track *t, Pad *pad, WORD dt)
{
    BYTE held;
    WORD rate;
    if (PAD_PRESSED(pad, B_LEFT)) { P->aimDir = -1; P->aimT = 0; if (P->tick) P->tick--; }
    else if (PAD_PRESSED(pad, B_RIGHT)) { P->aimDir = 1; P->aimT = 0; if (P->tick < TICKS) P->tick++; }
    held = (BYTE)(P->aimDir < 0 ? PAD_DOWN(pad, B_LEFT) : P->aimDir > 0 ? PAD_DOWN(pad, B_RIGHT) : 0);
    if (held) {
        rate = PAD_DOWN(pad, B_B) ? AIM_FINE : AIM_RATE;
        P->aimT = (WORD)(P->aimT + dt);
        while (P->aimT >= AIM_DELAY + rate) {
            P->aimT = (WORD)(P->aimT - rate);
            if (P->aimDir < 0 && P->tick) P->tick--;
            if (P->aimDir > 0 && P->tick < TICKS) P->tick++;
        }
    } else P->aimDir = 0;
    if (PAD_PRESSED(pad, B_C)) { BYTE x = P->cur; P->cur = P->next; P->next = x; trk_sfx(t, S_HOLD); }
    P->idle += dt;
    if (PAD_PRESSED(pad, B_A) || PAD_PRESSED(pad, B_D) || PAD_PRESSED(pad, B_UP) || P->idle >= HURRY) fire(t);
}

static void fly(Track *t, WORD dt)
{
    Shot s;
    int top = top_px(t), low = low_row(P->grid);
    s.x = P->sx; s.y = P->sy; s.vx = P->svx; s.vy = P->svy;
    P->dist = (WORD)(P->dist + dt * SPEED_Q8);
    while (P->dist >= (STEP << 8)) {
        P->dist = (WORD)(P->dist - (STEP << 8));
        if (step_shot(P->grid, top, &s, STEP, low)) { P->sx = s.x; P->sy = s.y; land(t); return; }
    }
    P->sx = s.x; P->sy = s.y; P->svx = s.vx; P->svy = s.vy;
}

BYTE pop_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int r, c;
    w &= 0x7f;
    if (w == W_WIPE) { if (!q) { for (r = 0; r < MAXR; r++) for (c = 0; c < COLS; c++) P->grid[r][c] = -1; P->drop = 0; fill(t, START_ROWS); } return 1; }
    if (w == W_REMOVE) { if (!q && P->drop) P->drop--; return 1; }
    return 0;
}
BYTE pop_safe(const Track *t) { return (BYTE)(P->state == ST_AIM); }
void pop_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = W / 8; *h = (LY + R) / 8; }

static const WORD THINK[9] = { 0, 1100, 900, 750, 600, 480, 380, 280, 200 };
static const BYTE EVERY[9] = { 0, 9, 9, 8, 7, 6, 6, 5, 5 };
static const BYTE MISTAKE[9] = { 0, 40, 30, 22, 15, 10, 6, 3, 1 };

void pop_init(Track *t)
{
    int r, c;
    for (r = 0; r < MAXR; r++) for (c = 0; c < COLS; c++) P->grid[r][c] = -1;
    P->shotsLeft = DROP_EVERY;
    P->tick = TICKS / 2;
    fill(t, START_ROWS);
    P->cur = pick_color(t); P->next = pick_color(t);
    P->state = ST_AIM;
    if (t->cpu) { P->cpu.level = t->cpu; P->cpu.every = EVERY[t->cpu]; }
}

void pop_update(Track *t, Pad *pad, WORD dt)
{
    if (P->shake) P->shake = P->shake > dt ? (WORD)(P->shake - dt) : 0;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    P->elapsed += dt;
    if (P->state == ST_AIM) aim(t, pad, dt);
    else if (P->state == ST_FLY) fly(t, dt);
    else if (P->state == ST_POP) { if (P->popT > dt) P->popT = (WORD)(P->popT - dt); else { P->popT = 0; finish_pop(t); } }
}

/* ---------------------------------------------------------------- CPU */
static SDWORD eval_shot(Track *t, WORD tick, BYTE k)
{
    static Grid g;
    static BYTE mark[MAXR][COLS];
    Shot s;
    int i, r, c, n, greys, dropped, top = top_px(t), low, same = 0, other = 0, kk;
    SBYTE nb[6][2];
    SDWORD sc = 0;
    new_shot(tick, &s);
    kk = low_row(P->grid);
    for (i = 0; i < 120; i++) if (step_shot(P->grid, top, &s, 6, kk)) break;
    snap(P->grid, top, &s, &r, &c);
    for (i = 0; i < MAXR; i++) for (kk = 0; kk < COLS; kk++) g[i][kk] = P->grid[i][kk];
    n = resolve(g, r, c, (SBYTE)k, mark, &greys);
    if (n) {
        dropped = remove_marked(g, mark);
        sc += 30 + n * 6 + dropped * 22 + greys * 8;
        if (lowest(g) < 0) sc += 400;
    } else {
        kk = neighbours(r, c, nb);
        for (i = 0; i < kk; i++) { SBYTE v = g[nb[i][0]][nb[i][1]]; if (v == (SBYTE)k) same++; else if (v >= 0) other++; }
        sc += same * 10 - other * 3;
    }
    low = lowest(g) + P->drop;
    if (low >= DEAD) sc -= 100000L;
    else if (low >= DEAD - 3) sc -= (low - (DEAD - 4)) * 25;
    sc -= r * 2;
    return sc;
}

static void keep(PopCpu *k, SDWORD sc, WORD tk)
{
    int i, j;
    for (i = 0; i < k->nt; i++) if (sc > k->tsc[i]) break;
    if (i >= 4) return;
    for (j = (k->nt < 4 ? k->nt : 3); j > i; j--) { k->tsc[j] = k->tsc[j - 1]; k->ttk[j] = k->ttk[j - 1]; }
    k->tsc[i] = sc; k->ttk[i] = tk;
    if (k->nt < 4) k->nt++;
}

void pop_cpu(Track *t, Pad *pad, WORD dt)
{
    PopCpu *k = &P->cpu;
    WORD st = 0;
    int diff, n;
    if (P->state != ST_AIM) { k->phase = 0; pad_feed(pad, 0, dt); return; }
    if (k->phase == 0) {
        k->wait = (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
        k->tk = (WORD)((P->shots * 7) % k->every); k->nt = 0; k->haveSwap = 0; k->phase = 1;
    }
    if (k->phase == 1) {
        for (n = 0; k->tk <= TICKS && xm_think && (n == 0 || xm_time_ok()); n++, k->tk = (WORD)(k->tk + k->every)) {
            keep(k, eval_shot(t, k->tk, P->cur), k->tk);
            if (k->level >= 4 && P->next != P->cur) {
                SDWORD s2 = eval_shot(t, k->tk, P->next);
                if (!k->haveSwap || s2 > k->bestSwapSc) { k->bestSwapSc = s2; k->bestSwapTk = k->tk; k->haveSwap = 1; }
            }
        }
        if (k->tk > TICKS) {
            k->phase = 2; k->planSwap = 0; k->planTk = k->ttk[0];
            if (k->haveSwap && k->bestSwapSc > k->tsc[0] + 15) { k->planTk = k->bestSwapTk; k->planSwap = 1; }
            else if (k->nt > 1 && trk_rnd(t, 100) < MISTAKE[k->level]) k->planTk = k->ttk[1 + trk_rnd(t, (WORD)(k->nt - 1))];
        }
        pad_feed(pad, 0, dt); return;
    }
    if (k->planSwap) { k->planSwap = 0; pad_feed(pad, B_C, dt); return; }
    diff = (int)k->planTk - (int)P->tick;
    if (k->wait > dt) k->wait = (WORD)(k->wait - dt); else k->wait = 0;
    if (diff) {
        st = diff < 0 ? B_LEFT : B_RIGHT;
        if (diff <= 8 && diff >= -8) st |= B_B;
        if (diff <= 2 && diff >= -2 && PAD_DOWN(pad, diff < 0 ? B_LEFT : B_RIGHT)) st = 0;
    } else if (!k->wait) st = PAD_DOWN(pad, B_A) ? 0 : B_A;
    pad_feed(pad, st, dt);
}

/* ---------------------------------------------------------------- drawing */
static void bubble(int x, int y, SBYTE k, int ymin)
{
    WORD base = k == GREY ? C_GREYBUB : C_BUB(k);
    BYTE pal = k == GREY ? PAL_GREY : KPAL[k];
    if (y >= ymin && y < SCR_H - 1) { CV_CELL16(x, y, pal, base); return; }
    if (y >= ymin) { cv_put(x, y, TW(pal, TB4(base))); cv_put(x + 1, y, TW(pal, TB4(base + 1))); }
    if (y + 1 >= ymin) { cv_put(x, y + 1, TW(pal, TB4(base + 2))); cv_put(x + 1, y + 1, TW(pal, TB4(base + 3))); }
}

void pop_draw(Track *t, int ox)
{
    int r, c, fx = ox + FX + (P->shake ? ((P->shake >> 5) & 1) : 0), y, x, i, fh = (LY + R) / 8, ly = FY + (LY - R) / 8;
    WORD bg = TW(PAL_STEEL, TB3(T_PLAIN));
    BYTE flashOn = (BYTE)((P->popT >> 6) & 1);
    for (y = 0; y < fh; y++) { cv_put(ox + FX - 1, FY + y, TW(PAL_STEEL, TB3(T_FR_L))); cv_put(ox + FX + W / 8, FY + y, TW(PAL_STEEL, TB3(T_FR_R))); }
    cv_fill(ox + FX, FY, W / 8, fh, bg);
    for (y = 0; y < P->drop * 2 && y < fh; y++) cv_fill(ox + FX, FY + y, W / 8, 1, TW(PAL_STEEL, TB3(T_CEIL)));
    /* danger line under the last row, beside the launcher */
    for (x = 0; x < W / 8; x++) if (x < 6 || x > 9) cv_put(ox + FX + x, ly, TW(PAL_RED, TB3(T_DANGER)));
    for (r = 0; r < MAXR; r++) for (c = 0; c < row_len(r); c++) {
        SBYTE k = P->grid[r][c];
        if (k < 0) continue;
        x = fx + (cell_x(r, c) - R) / 8; y = FY + (cell_y(r) - R) / 8 + P->drop * 2;
        if (y >= ly) continue;
        if (P->state == ST_POP && P->mark[r][c] && flashOn) { CV_CELL16(x, y, PAL_WHITE, C_FLASH); continue; }
        bubble(x, y, k, FY);
    }
    if (!t->dead) {
        if (P->state == ST_AIM) {
            /* the dotted aim path, traced again only when the aim or the board changes */
            if (!P->dotValid || P->dotTick != P->tick || P->dotShots != P->shots || P->dotDrop != P->drop) {
                Shot s;
                int top = top_px(t);
                int low = low_row(P->grid);
                P->dotN = 0; P->dotTick = P->tick; P->dotShots = P->shots; P->dotDrop = P->drop; P->dotValid = 1;
                new_shot(P->tick, &s);
                for (i = 0; i < 100 && P->dotN < 48; i++) {
                    if (step_shot(P->grid, top, &s, 4, low)) break;
                    if ((i & 1) != 1) continue;
                    P->dotX[P->dotN] = (BYTE)((int)(s.x >> 8) / 8); P->dotY[P->dotN] = (BYTE)((int)(s.y >> 8) / 8); P->dotN++;
                }
            }
            for (i = 0; i < P->dotN; i++) {
                int tx = ox + FX + P->dotX[i], ty = FY + P->dotY[i];
                if (ty < ly && ty >= FY && scr[ty][tx] == bg) cv_put(tx, ty, TW(PAL_WHITE, TB3(T_DOT)));
            }
            bubble(ox + FX + (W / 2 - R) / 8, ly, (SBYTE)P->cur, FY);
        }
        if (P->state == ST_FLY) {
            x = ox + FX + ((int)(P->sx >> 8) - R) / 8; y = FY + ((int)(P->sy >> 8) - R) / 8;
            bubble(x, y, (SBYTE)P->sk, FY);
        }
        bubble(ox + FX + 1, ly, (SBYTE)(P->state == ST_AIM ? P->next : P->cur), FY);
        cv_text(ox + FX, ly - 1, PAL_GREY, "NEXT");
        cv_text(ox + FX + 12, ly, PAL_GREY, "DROP");
        cv_text(ox + FX + 13, ly + 1, PAL_RED, cv_num(P->shotsLeft));
    }
    cv_pending(ox + 1, FY, fh, t, 8, GARBAGE_DELAY);
}
