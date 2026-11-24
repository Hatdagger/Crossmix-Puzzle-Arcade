/*
 * CALM: Calm Combo's slide-a-line match-3 (js/track-calm.js).
 * Grab a tile, slide its whole row or column; a move counts if it makes a match.
 * Moves are your life: chains and big matches earn moves, you lose when they run out.
 */
#include "xm.h"
#include "tiles.h"

#define COLS CA_COLS
#define ROWS CA_ROWS
#define NC 6
#define STONE 6
#define START_MOVES 15
#define MAX_STONES 20
#define MOVE_TIMER 12000
#define MIN_TIMER 6000
#define STONE_DELAY 3000
#define SEND_Q8 51          /* x0.2 */

#define FX 3                /* field column (16 tiles wide) */
#define FY 4

enum { ST_IDLE, ST_WAIT, ST_CLEAR, ST_FALL, ST_OVER };

static const BYTE KPAL[7] = { PAL_RED, PAL_BLUE, PAL_GREEN, PAL_YELLOW, PAL_VIOLET, PAL_ORANGE, PAL_GREY };

#define C (&t->u.c)

static BYTE rnd_col(Track *t) { return (BYTE)trk_rnd(t, NC); }

/* ---------------------------------------------------------------- matching */
typedef BYTE Grid[ROWS][COLS];

/* full scan: hit map, number of tiles hit, group sizes (4+ and 5+ counted) */
static BYTE find_matches(Grid m, BYTE hit[ROWS][COLS], BYTE *n4, BYTE *n5, BYTE *groups)
{
    int r, c, e, q, k, count = 0;
    *n4 = 0; *n5 = 0; *groups = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (r = 0; r < ROWS; r++) {
        c = 0;
        while (c < COLS) {
            k = m[r][c]; e = c + 1;
            while (e < COLS && m[r][e] == k) e++;
            if (k < NC && e - c >= 3) { (*groups)++; if (e - c == 4) (*n4)++; if (e - c >= 5) (*n5)++; for (q = c; q < e; q++) hit[r][q] = 1; }
            c = e;
        }
    }
    for (c = 0; c < COLS; c++) {
        r = 0;
        while (r < ROWS) {
            k = m[r][c]; e = r + 1;
            while (e < ROWS && m[e][c] == k) e++;
            if (k < NC && e - r >= 3) { (*groups)++; if (e - r == 4) (*n4)++; if (e - r >= 5) (*n5)++; for (q = r; q < e; q++) hit[q][c] = 1; }
            r = e;
        }
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) count += hit[r][c];
    return (BYTE)count;
}

static void apply_move(Grid src, Grid dst, int r, int c, BYTE axis, int tg)
{
    int i, j;
    BYTE v;
    for (i = 0; i < ROWS; i++) for (j = 0; j < COLS; j++) dst[i][j] = src[i][j];
    if (axis == 1) {
        v = dst[r][c];
        if (tg > c) for (j = c; j < tg; j++) dst[r][j] = dst[r][j + 1];
        else for (j = c; j > tg; j--) dst[r][j] = dst[r][j - 1];
        dst[r][tg] = v;
    } else {
        v = dst[r][c];
        if (tg > r) for (i = r; i < tg; i++) dst[i][c] = dst[i + 1][c];
        else for (i = r; i > tg; i--) dst[i][c] = dst[i - 1][c];
        dst[tg][c] = v;
    }
}

/* is there a run of 3+ through (r, c) across or down? */
static BYTE run_at(Grid m, int r, int c)
{
    BYTE k = m[r][c];
    int a, b;
    if (k >= NC) return 0;
    a = c; while (a > 0 && m[r][a - 1] == k) a--;
    b = c; while (b < COLS - 1 && m[r][b + 1] == k) b++;
    if (b - a >= 2) return 1;
    a = r; while (a > 0 && m[a - 1][c] == k) a--;
    b = r; while (b < ROWS - 1 && m[b + 1][c] == k) b++;
    return (BYTE)(b - a >= 2);
}

/* does this move make a match?  Only the moved line can have one. */
static BYTE move_matches(Grid m, int r, int c, BYTE axis, int tg)
{
    Grid n;
    int i;
    apply_move(m, n, r, c, axis, tg);
    if (axis == 1) { for (i = 0; i < COLS; i++) if (run_at(n, r, i)) return 1; }
    else { for (i = 0; i < ROWS; i++) if (run_at(n, i, c)) return 1; }
    return 0;
}

static BYTE has_valid_move(Grid m)
{
    int r, c, tg;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        for (tg = 0; tg < COLS; tg++) if (tg != c && move_matches(m, r, c, 1, tg)) return 1;
        for (tg = 0; tg < ROWS; tg++) if (tg != r && move_matches(m, r, c, 2, tg)) return 1;
    }
    return 0;
}

static BYTE any_match(Grid m)
{
    int r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (run_at(m, r, c)) return 1;
    return 0;
}

/* ---------------------------------------------------------------- board */
static void fill(Track *t)
{
    int r, c, tries = 0;
    BYTE k;
    do {
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
            do { k = rnd_col(t); }
            while ((c >= 2 && C->grid[r][c - 1] == k && C->grid[r][c - 2] == k) || (r >= 2 && C->grid[r - 1][c] == k && C->grid[r - 2][c] == k));
            C->grid[r][c] = k; C->dying[r][c] = 0; C->pop[r][c] = 0;
        }
    } while (!has_valid_move(C->grid) && ++tries < 50);
}

static void shuffle(Track *t)
{
    BYTE cols[ROWS * COLS], tmp;
    int n = 0, r, c, i, a, j;
    for (i = 0; i < 60; i++) {
        n = 0;
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->grid[r][c] != STONE) cols[n++] = C->grid[r][c];
        for (a = n - 1; a > 0; a--) { j = trk_rnd(t, (WORD)(a + 1)); tmp = cols[a]; cols[a] = cols[j]; cols[j] = tmp; }
        n = 0;
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->grid[r][c] != STONE) C->grid[r][c] = cols[n++];
        if (!any_match(C->grid) && has_valid_move(C->grid)) return;
    }
    fill(t);
}

static void die(Track *t)
{
    if (!t->dead) { t->dead = 1; C->state = ST_OVER; trk_sfx(t, S_KO); }
}

static WORD move_cost(const Track *t)
{
    DWORD e = C->elapsed; WORD k = 1;
    if (!t->vs) return 1;
    while (e >= 120000UL) { e -= 120000UL; k++; }
    return k;
}
static WORD timer_ms(const Track *t)
{
    DWORD e = C->elapsed; WORD tm = MOVE_TIMER;
    while (e >= 60000UL && tm > MIN_TIMER) { e -= 60000UL; tm = (WORD)(tm - 500); }
    return tm < MIN_TIMER ? MIN_TIMER : tm;
}

static void land_stones(Track *t)
{
    WORD n = trk_take_all(t), have = 0, room, over, k;
    BYTE top[ROWS * COLS][2], rest[ROWS * COLS][2], nt = 0, nr = 0, tmp0, tmp1;
    int r, c, i, j;
    if (!n) return;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->grid[r][c] == STONE) have++;
    room = have >= MAX_STONES ? 0 : (WORD)(MAX_STONES - have);
    if (n > room) {
        over = (WORD)(n - room);
        C->moves = (SWORD)(C->moves - over);
        trk_say(t, "OVERFLOW", PAL_RED);
        if (C->moves <= 0) { die(t); }
        n = room;
    }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->grid[r][c] != STONE) {
        if (r < 3) { top[nt][0] = (BYTE)r; top[nt][1] = (BYTE)c; nt++; } else { rest[nr][0] = (BYTE)r; rest[nr][1] = (BYTE)c; nr++; }
    }
    for (i = nt - 1; i > 0; i--) { j = trk_rnd(t, (WORD)(i + 1)); tmp0 = top[i][0]; tmp1 = top[i][1]; top[i][0] = top[j][0]; top[i][1] = top[j][1]; top[j][0] = tmp0; top[j][1] = tmp1; }
    for (i = nr - 1; i > 0; i--) { j = trk_rnd(t, (WORD)(i + 1)); tmp0 = rest[i][0]; tmp1 = rest[i][1]; rest[i][0] = rest[j][0]; rest[i][1] = rest[j][1]; rest[j][0] = tmp0; rest[j][1] = tmp1; }
    for (k = 0; k < n; k++) {
        if (k < nt) { C->grid[top[k][0]][top[k][1]] = STONE; C->pop[top[k][0]][top[k][1]] = 18; }
        else if (k - nt < nr) { C->grid[rest[k - nt][0]][rest[k - nt][1]] = STONE; C->pop[rest[k - nt][0]][rest[k - nt][1]] = 18; }
    }
    C->dragOn = 0;
    trk_sfx(t, S_GARBAGE);
}

static void gravity(Track *t)
{
    int c, r, w;
    for (c = 0; c < COLS; c++) {
        w = ROWS - 1;
        for (r = ROWS - 1; r >= 0; r--) if (!C->dying[r][c]) { C->grid[w][c] = C->grid[r][c]; C->pop[w][c] = C->pop[r][c]; C->dying[w][c] = 0; w--; }
        for (; w >= 0; w--) { C->grid[w][c] = rnd_col(t); C->dying[w][c] = 0; C->pop[w][c] = 10; }
    }
}

static void finish_resolve(Track *t)
{
    if (C->gain) { C->moves = (SWORD)(C->moves + C->gain); trk_say(t, C->gain > 1 ? "+MOVES" : "+1 MOVE", PAL_GREEN); }
    if (t->vs && C->attack) {
        WORD out;
        C->atkFrac = (WORD)(C->atkFrac + C->attack * SEND_Q8);
        out = (WORD)(C->atkFrac >> 8); C->atkFrac &= 255;
        trk_send(t, out);
    }
    land_stones(t);
    if (t->dead) return;
    if (C->moves <= 0) { die(t); return; }
    if (!has_valid_move(C->grid)) { trk_say(t, "SHUFFLE!", PAL_WHITE); shuffle(t); }
    C->state = ST_IDLE;
}

static void step_resolve(Track *t)
{
    BYTE hit[ROWS][COLS], n4, n5, groups, count;
    int r, c;
    if (C->state == ST_WAIT) {
        count = find_matches(C->grid, hit, &n4, &n5, &groups);
        if (!count) { finish_resolve(t); return; }
        C->chain++;
        C->gain = (BYTE)(C->gain + n4 + n5 * 2);
        C->attack = (BYTE)(C->attack + n4 + n5 * 2);
        C->score += (DWORD)count * 10 * C->chain;
        if (C->chain >= 2) { C->gain++; C->attack++; }
        if (C->chain == 1 && C->lever) { C->attack++; C->score += 50; trk_say(t, "LEVER!", PAL_PINK); }
        if (C->chain > 1 || n5) t->bigMark = 1;
        if (C->chain > 1) trk_say(t, "CHAIN!", PAL_YELLOW);
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
            C->dying[r][c] = 1;
            if (r > 0 && C->grid[r - 1][c] == STONE) C->dying[r - 1][c] = 1;
            if (r < ROWS - 1 && C->grid[r + 1][c] == STONE) C->dying[r + 1][c] = 1;
            if (c > 0 && C->grid[r][c - 1] == STONE) C->dying[r][c - 1] = 1;
            if (c < COLS - 1 && C->grid[r][c + 1] == STONE) C->dying[r][c + 1] = 1;
        }
        trk_sfx(t, C->chain > 1 ? S_BIG : S_CLEAR);
        C->state = ST_CLEAR; C->phaseT = 260;
    } else if (C->state == ST_CLEAR) {
        gravity(t); C->state = ST_FALL; C->phaseT = 300;
    } else if (C->state == ST_FALL) {
        C->state = ST_WAIT; C->phaseT = 60;
    }
}

/* ---------------------------------------------------------------- input */
static void set_target(Track *t, BYTE axis, BYTE tg)
{
    BYTE n4, n5, g;
    Grid n;
    C->daxis = axis; C->dt_ = tg; C->pvCount = 0;
    if (axis && tg != (axis == 1 ? C->dc : C->dr)) {
        apply_move(C->grid, n, C->dr, C->dc, axis, tg);
        C->pvCount = find_matches(n, C->pvHit, &n4, &n5, &g);
    }
}

static void commit(Track *t)
{
    Grid n;
    int i, j;
    BYTE fr = C->daxis == 1 ? C->dr : C->dt_, fc = C->daxis == 1 ? C->dt_ : C->dc;
    apply_move(C->grid, n, C->dr, C->dc, C->daxis, C->dt_);
    for (i = 0; i < ROWS; i++) for (j = 0; j < COLS; j++) C->grid[i][j] = n[i][j];
    C->lever = (BYTE)!C->pvHit[fr][fc];
    C->cr = fr; C->cc = fc;
    C->dragOn = 0;
    C->moves = (SWORD)(C->moves - move_cost(t));
    C->idleT = 0;
    C->chain = 0; C->gain = 0; C->attack = 0;
    C->state = ST_WAIT; C->phaseT = 110;
}

static void handle(Track *t, Pad *pad)
{
    static const WORD DIRB[4] = { B_UP, B_DOWN, B_LEFT, B_RIGHT };
    static const SBYTE DR[4] = { -1, 1, 0, 0 }, DC[4] = { 0, 0, -1, 1 };
    int k, nr, nc;
    for (k = 0; k < 4; k++) {
        if (!pad_repeat(pad, DIRB[k], 220, 90)) continue;
        if (!C->dragOn) {
            nr = C->cr + DR[k]; nc = C->cc + DC[k];
            if (nr >= 0 && nr < ROWS) C->cr = (BYTE)nr;
            if (nc >= 0 && nc < COLS) C->cc = (BYTE)nc;
            continue;
        }
        {
            BYTE axis = DC[k] ? 1 : 2;
            int step = DC[k] ? DC[k] : DR[k], o = axis == 1 ? C->dc : C->dr, mx = axis == 1 ? COLS - 1 : ROWS - 1, tg;
            if (!C->daxis) {
                tg = o + step; if (tg < 0) tg = 0; if (tg > mx) tg = mx;
                if (tg != o) set_target(t, axis, (BYTE)tg);
            } else if (C->daxis == axis) {
                tg = C->dt_ + step; if (tg < 0) tg = 0; if (tg > mx) tg = mx;
                if (tg == o) set_target(t, 0, 0); else set_target(t, axis, (BYTE)tg);
            }
        }
    }
    if (PAD_PRESSED(pad, B_A)) {
        if (!C->dragOn) { C->dragOn = 1; C->dr = C->cr; C->dc = C->cc; C->daxis = 0; C->pvCount = 0; trk_sfx(t, S_ROTATE); }
        else if (C->pvCount) commit(t);
        else { if (C->daxis) { C->bad = 350; trk_sfx(t, S_BAD); } C->dragOn = 0; }
    }
    if (PAD_PRESSED(pad, B_B)) C->dragOn = 0;
}

/* ---------------------------------------------------------------- weapons */
static void unstone(Track *t, int max)
{
    int r, c, n = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->grid[r][c] == STONE && n < max) { C->grid[r][c] = rnd_col(t); C->pop[r][c] = 18; n++; }
    if (any_match(C->grid) || !has_valid_move(C->grid)) shuffle(t);
    C->dragOn = 0;
}
BYTE calm_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    w &= 0x7f;
    if (w == W_WIPE) { if (!q) { fill(t); C->dragOn = 0; } return 1; }
    if (w == W_REMOVE) { if (!q) unstone(t, 3); return 1; }
    return 0;
}
BYTE calm_safe(const Track *t) { return (BYTE)(C->state == ST_IDLE); }
void calm_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = COLS * 2; *h = ROWS * 2; }

/* ---------------------------------------------------------------- init / update */
static const WORD THINK[9] = { 0, 1800, 1500, 1200, 1000, 800, 650, 500, 350 };
static const WORD STEP[9] = { 0, 260, 220, 180, 150, 120, 100, 80, 60 };
static const BYTE MISTAKE[9] = { 0, 45, 35, 25, 18, 12, 8, 5, 2 };

void calm_init(Track *t)
{
    C->moves = START_MOVES;
    C->cr = 3; C->cc = 3;
    C->state = ST_IDLE;
    fill(t);
    if (t->cpu) { C->cpu.level = t->cpu; C->cpu.wait = THINK[t->cpu]; }
}

void calm_update(Track *t, Pad *pad, WORD dt)
{
    int r, c;
    if (C->bad) C->bad = C->bad > dt ? (WORD)(C->bad - dt) : 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (C->pop[r][c]) C->pop[r][c]--;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    C->elapsed += dt;
    if (C->state == ST_IDLE) {
        handle(t, pad);
        if (t->vs && C->state == ST_IDLE) {
            DWORD before = C->idleT;
            WORD tm = timer_ms(t);
            C->idleT += dt;
            if (C->idleT + 2500 > tm && (C->idleT / 500) != (before / 500)) trk_sfx(t, S_TICK);
            if (C->idleT >= tm) {
                C->idleT = 0; C->moves--;
                trk_say(t, "-1 MOVE", PAL_RED); trk_sfx(t, S_BAD);
                if (C->moves <= 0) { die(t); return; }
            }
            if (t->npend && t->pending[0].t >= STONE_DELAY) {
                land_stones(t);
                if (t->dead) return;
                if (!has_valid_move(C->grid)) shuffle(t);
            }
        }
    } else if (C->state != ST_OVER) {
        C->phaseT = (SWORD)(C->phaseT - dt);
        if (C->phaseT <= 0) step_resolve(t);
    }
}

/* ---------------------------------------------------------------- CPU */
static void cpu_add(Track *t, BYTE r, BYTE c, BYTE a, BYTE tg)
{
    CalmCpu *k = &C->cpu;
    Grid n;
    BYTE hit[ROWS][COLS], n4, n5, g, cnt, fr, fc;
    SWORD sc;
    apply_move(C->grid, n, r, c, a, tg);
    cnt = find_matches(n, hit, &n4, &n5, &g);
    if (!cnt) return;
    fr = a == 1 ? r : tg; fc = a == 1 ? tg : c;
    sc = (SWORD)(cnt * 10 + n5 * 40 + n4 * 20 + (hit[fr][fc] ? 0 : 15));
    k->count++;
    if (!k->count || sc > k->bestSc || k->count == 1) { k->bestSc = sc; k->best[0] = r; k->best[1] = c; k->best[2] = a; k->best[3] = tg; }
    if (trk_rnd(t, k->count) == 0) { k->rnd[0] = r; k->rnd[1] = c; k->rnd[2] = a; k->rnd[3] = tg; }
}

static void cpu_build(Track *t, const BYTE *mv)
{
    CalmCpu *k = &C->cpu;
    int cr = C->cr, cc = C->cc, n = 0, o, d, i;
    BYTE key;
    while (cr < mv[0]) { k->script[n++] = 2; cr++; }
    while (cr > mv[0]) { k->script[n++] = 1; cr--; }
    while (cc < mv[1]) { k->script[n++] = 4; cc++; }
    while (cc > mv[1]) { k->script[n++] = 3; cc--; }
    k->script[n++] = 5;
    o = mv[2] == 1 ? mv[1] : mv[0]; d = mv[3] - o;
    key = (BYTE)(mv[2] == 1 ? (d > 0 ? 4 : 3) : (d > 0 ? 2 : 1));
    for (i = 0; i < (d < 0 ? -d : d) && n < 23; i++) k->script[n++] = key;
    k->script[n++] = 5;
    k->n = (BYTE)n;
}

void calm_cpu(Track *t, Pad *pad, WORD dt)
{
    static const WORD KEYB[6] = { 0, B_UP, B_DOWN, B_LEFT, B_RIGHT, B_A };
    CalmCpu *k = &C->cpu;
    int i, tg, r, c;
    if (k->tap) { k->tap = 0; pad_feed(pad, 0, dt); return; }
    if (C->state != ST_IDLE) {
        k->n = 0; k->planning = 0;
        k->wait = (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
        pad_feed(pad, 0, dt); return;
    }
    /* plan a few source cells per frame while thinking */
    if (!k->n && !k->planning) { k->planning = 1; k->pcell = 0; k->count = 0; k->bestSc = -1; }
    if (k->planning && xm_think) {
        for (i = 0; i < 2 && k->pcell < ROWS * COLS; i++, k->pcell++) {
            r = k->pcell / COLS; c = k->pcell % COLS;
            for (tg = 0; tg < COLS; tg++) if (tg != c && move_matches(C->grid, r, c, 1, tg)) cpu_add(t, (BYTE)r, (BYTE)c, 1, (BYTE)tg);
            for (tg = 0; tg < ROWS; tg++) if (tg != r && move_matches(C->grid, r, c, 2, tg)) cpu_add(t, (BYTE)r, (BYTE)c, 2, (BYTE)tg);
        }
    }
    if (k->wait > dt) { k->wait = (WORD)(k->wait - dt); pad_feed(pad, 0, dt); return; }
    k->wait = 0;
    if (k->planning) {
        if (k->pcell < ROWS * COLS) { pad_feed(pad, 0, dt); return; }
        k->planning = 0;
        if (!k->count) { k->wait = THINK[k->level]; pad_feed(pad, 0, dt); return; }
        C->dragOn = 0;
        cpu_build(t, trk_rnd(t, 100) < MISTAKE[k->level] ? k->rnd : k->best);
    }
    if (k->n) {
        BYTE b = k->script[0];
        for (i = 1; i < k->n; i++) k->script[i - 1] = k->script[i];
        k->n--;
        pad_feed(pad, KEYB[b], dt); k->tap = 1;
        k->wait = STEP[k->level];
        return;
    }
    pad_feed(pad, 0, dt);
}

/* ---------------------------------------------------------------- drawing */
static void slot_of(const Track *t, int r, int c, int *sx, int *sy)
{
    int o, tg, j;
    *sx = c; *sy = r;
    if (!C->dragOn) return;
    if (r == C->dr && c == C->dc) {
        if (!C->daxis) return;
        if (C->daxis == 1) *sx = C->dt_; else *sy = C->dt_;
        return;
    }
    if (!C->daxis) return;
    o = C->daxis == 1 ? C->dc : C->dr; tg = C->dt_;
    if (C->daxis == 1 && r == C->dr) { j = c; if (tg > o && j > o && j <= tg) j--; else if (tg < o && j >= tg && j < o) j++; *sx = j; }
    if (C->daxis == 2 && c == C->dc) { j = r; if (tg > o && j > o && j <= tg) j--; else if (tg < o && j >= tg && j < o) j++; *sy = j; }
}

void calm_draw(Track *t, int ox)
{
    int r, c, sx, sy, fx = ox + FX + ((C->bad >> 5) & 1);
    BYTE k, lit, pal;
    cv_frame(ox + FX, FY, COLS * 2, ROWS * 2, PAL_STEEL);
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        k = C->grid[r][c];
        slot_of(t, r, c, &sx, &sy);
        lit = 0;
        if (C->dragOn && r == C->dr && c == C->dc) lit = 1;
        else if (!C->dragOn && !t->dead && C->state == ST_IDLE && r == C->cr && c == C->cc) lit = 1;
        if (C->dragOn && C->pvCount && C->pvHit[sy][sx]) lit = 1;
        pal = KPAL[k];
        if (C->dying[r][c] && C->state == ST_CLEAR) { cv_cell16(fx + sx * 2, FY + sy * 2, PAL_WHITE, C_FLASH, 0); continue; }
        if (C->pop[r][c] & 4) pal = PAL_WHITE;
        if (k == STONE) cv_cell16(fx + sx * 2, FY + sy * 2, PAL_GREY, lit ? C_STONELIT : C_STONE, 0);
        else cv_cell16(fx + sx * 2, FY + sy * 2, pal, lit ? C_SQLIT(k) : C_SQ(k), 0);
    }
    cv_pending(ox + 1, FY, ROWS * 2, t, (ROWS * 16) / MAX_STONES, STONE_DELAY);
    /* moves, score, timer */
    cv_text(ox + 3, FY + 16, PAL_GREY, "MOVES");
    cv_text(ox + 3, FY + 17, C->moves <= 3 ? PAL_RED : PAL_AMBER, cv_num(C->moves > 0 ? (DWORD)C->moves : 0));
    cv_text(ox + 11, FY + 16, PAL_GREY, "SCORE");
    cv_text(ox + 11, FY + 17, PAL_GREEN, cv_num(C->score));
    if (t->vs && C->state == ST_IDLE && !t->dead) {
        WORD tm = timer_ms(t), left = C->idleT >= tm ? 0 : (WORD)(tm - C->idleT);
        int n = (int)(((DWORD)left * 16) / tm), i;
        for (i = 0; i < 16; i++) cv_put(ox + FX + i, FY + 19, TW(i < n ? (left < 2500 ? PAL_RED : PAL_GREEN) : PAL_STEEL, TB3(T_LINE_H)));
    }
    if (C->dragOn && !t->dead) cv_textc(ox, 20, FY + 20, PAL_BEIGE, C->pvCount ? "A: SLIDE  B: DROP" : "SLIDE THE LINE");
}
