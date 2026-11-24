/*
 * SWAP: Tetris Attack-style rising stack (js/track-swap.js).
 * A 2-wide cursor swaps two side-by-side panels.  3+ across or down clears;
 * panels that land in a new match make chains.  Hold C or D to raise faster.
 * Incoming units drop as garbage slabs (3 panels each, 6 = a full row);
 * a match next to a slab turns its bottom row back into panels.
 */
#include "xm.h"
#include "tiles.h"

#define COLS SW_COLS
#define VIS SW_VIS
#define HID SW_HID
#define ROWS SW_ROWS
#define NC 5
#define RISE 7000
#define RISE_MIN 1800
#define RISE_STEP 600
#define SPEEDUP 30000UL
#define RAISE 110
#define FALL_TICK 45
#define HANG 120
#define CLEAR_MS 820
#define STOP_COMBO 900
#define STOP_CHAIN 1500
#define PANIC 2600
#define GARBAGE_DELAY 1000
#define FORCE_DROP 3000
#define MAX_ROWS 4
#define SEND_Q8 115         /* x0.45 */
#define UNIT_PANELS 3
#define ROWPX 16

#define FX 4
#define FY 1

enum { PS_IDLE, PS_HANG, PS_FALL, PS_CLEAR };
static const BYTE KPAL[NC] = { PAL_RED, PAL_BLUE, PAL_GREEN, PAL_YELLOW, PAL_VIOLET };
static const BYTE KSYM[NC] = { 0, 1, 2, 3, 4 };

#define S (&t->u.s)

static void die(Track *t) { if (!t->dead) { t->dead = 1; trk_sfx(t, S_KO); } }

static SBYTE color_at(const Track *t, int r, int c)
{
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1;
    return S->k[r][c] >= 0 ? S->k[r][c] : -1;
}

static void put_block(Track *t, int r, int c, SBYTE k)
{
    S->k[r][c] = k; S->st[r][c] = PS_IDLE; S->tm[r][c] = 0; S->chainf[r][c] = 0; S->slabOf[r][c] = 0xff; S->grpOf[r][c] = 0xff; S->mv[r][c] = 0;
    S->dirty = 1; S->dRows |= (WORD)(1 << r); S->dCols |= (BYTE)(1 << c);
}
static void clear_cell(Track *t, int r, int c) { put_block(t, r, c, -1); }
static void move_cell(Track *t, int r1, int c1, int r2, int c2)
{
    S->k[r2][c2] = S->k[r1][c1]; S->st[r2][c2] = S->st[r1][c1]; S->tm[r2][c2] = S->tm[r1][c1];
    S->chainf[r2][c2] = S->chainf[r1][c1]; S->slabOf[r2][c2] = S->slabOf[r1][c1]; S->grpOf[r2][c2] = S->grpOf[r1][c1]; S->mv[r2][c2] = S->mv[r1][c1];
    S->dRows |= (WORD)(1 << r2); S->dCols |= (BYTE)(1 << c2);
    clear_cell(t, r1, c1);
}

static void fill_start(Track *t)
{
    int c, r, h, tries;
    SBYTE k;
    for (c = 0; c < COLS; c++) {
        h = 3 + trk_rnd(t, 4);
        for (r = ROWS - 1; r >= ROWS - h; r--) {
            tries = 0;
            do { k = (SBYTE)trk_rnd(t, NC); tries++; }
            while (tries < 20 && ((color_at(t, r, c - 1) == k && color_at(t, r, c - 2) == k) || (color_at(t, r + 1, c) == k && color_at(t, r + 2, c) == k)));
            put_block(t, r, c, k);
        }
    }
}

static void new_row(Track *t)
{
    int c, tries;
    SBYTE k;
    for (c = 0; c < COLS; c++) {
        tries = 0;
        do { k = (SBYTE)trk_rnd(t, NC); tries++; }
        while (tries < 20 && ((c >= 2 && S->preview[c - 1] == k && S->preview[c - 2] == k) || (color_at(t, ROWS - 1, c) == k && color_at(t, ROWS - 2, c) == k)));
        S->preview[c] = k;
    }
}

static WORD rise_ms(const Track *t)
{
    DWORD e = S->elapsed; WORD v = RISE;
    while (e >= SPEEDUP && v > RISE_MIN) { e -= SPEEDUP; v = (WORD)(v - RISE_STEP); }
    return v < RISE_MIN ? RISE_MIN : v;
}

static BYTE is_moving(const Track *t, int r, int c) { return (BYTE)(S->k[r][c] >= 0 && (S->st[r][c] == PS_FALL || S->st[r][c] == PS_HANG)); }

/* ---------------------------------------------------------------- input */
static BYTE can_swap_cell(const Track *t, int r, int c) { return (BYTE)(S->k[r][c] == -1 || (S->k[r][c] >= 0 && S->st[r][c] == PS_IDLE)); }

static void try_swap(Track *t)
{
    int r = S->cr, c = S->cc;
    BYTE L = (BYTE)(S->k[r][c] != -1), R = (BYTE)(S->k[r][c + 1] != -1);
    SBYTE tk; BYTE tst;
    if (!L && !R) return;
    if (!can_swap_cell(t, r, c) || !can_swap_cell(t, r, c + 1)) return;
    if ((!L && r > 0 && is_moving(t, r - 1, c)) || (!R && r > 0 && is_moving(t, r - 1, c + 1))) return;
    tk = S->k[r][c]; tst = S->st[r][c];
    S->k[r][c] = S->k[r][c + 1]; S->st[r][c] = S->st[r][c + 1];
    S->k[r][c + 1] = tk; S->st[r][c + 1] = tst;
    S->chainf[r][c] = 0; S->chainf[r][c + 1] = 0;
    S->dirty = 1; S->dRows |= (WORD)(1 << r); S->dCols |= (BYTE)(3 << c);
    trk_sfx(t, S_ROTATE);
}

static void handle(Track *t, Pad *pad)
{
    static const WORD DIRB[4] = { B_UP, B_DOWN, B_LEFT, B_RIGHT };
    static const SBYTE DR[4] = { -1, 1, 0, 0 }, DC[4] = { 0, 0, -1, 1 };
    int k, v;
    for (k = 0; k < 4; k++) {
        if (!pad_repeat(pad, DIRB[k], 180, 60)) continue;
        v = S->cr + DR[k]; if (v < HID) v = HID; if (v > ROWS - 1) v = ROWS - 1; S->cr = (BYTE)v;
        v = S->cc + DC[k]; if (v < 0) v = 0; if (v > COLS - 2) v = COLS - 2; S->cc = (BYTE)v;
        trk_sfx(t, S_MOVE);
    }
    if (PAD_PRESSED(pad, B_A) || PAD_PRESSED(pad, B_B)) try_swap(t);
    S->raising = (BYTE)(PAD_DOWN(pad, B_C) || PAD_DOWN(pad, B_D));
}

/* ---------------------------------------------------------------- falling */
static BYTE slab_can_fall(const Track *t, const Slab *s)
{
    int rb = s->r + s->h - 1, c;
    if (rb >= ROWS - 1) return 0;
    for (c = s->c; c < s->c + s->w; c++) if (S->k[rb + 1][c] != -1) return 0;
    return 1;
}

static void mark_hang(Track *t, BYTE cols)
{
    int r, c, rr;
    SWORD tt;
    for (r = ROWS - 2; r >= 0; r--) for (c = 0; c < COLS; c++) {
        if (!(cols & (1 << c))) continue;
        if (S->k[r][c] < 0 || S->st[r][c] != PS_IDLE) continue;
        if (S->k[r + 1][c] != -1 && !is_moving(t, r + 1, c)) continue;
        tt = (S->k[r + 1][c] >= 0 && S->st[r + 1][c] == PS_HANG) ? S->tm[r + 1][c] : HANG;
        for (rr = r; rr >= 0; rr--) {
            if (S->k[rr][c] < 0 || S->st[rr][c] != PS_IDLE) break;
            S->st[rr][c] = PS_HANG; S->tm[rr][c] = tt;
        }
    }
}

static void fall_step(Track *t)
{
    int r, c, rr, cc;
    BYTE tick = ++S->tick;
    if (!tick) tick = S->tick = 1;
    for (r = ROWS - 2; r >= 0; r--) for (c = 0; c < COLS; c++) {
        if (S->k[r][c] == -1 || S->mv[r][c] == tick) continue;
        if (S->k[r][c] == -2) {
            Slab *s = &S->slab[S->slabOf[r][c]];
            if (c != s->c || r != s->r + s->h - 1 || !slab_can_fall(t, s)) continue;
            for (rr = r; rr >= s->r; rr--) for (cc = s->c; cc < s->c + s->w; cc++) { move_cell(t, rr, cc, rr + 1, cc); S->mv[rr + 1][cc] = tick; }
            s->r++;
            continue;
        }
        if (S->st[r][c] != PS_FALL) continue;
        if (S->k[r + 1][c] == -1) { move_cell(t, r, c, r + 1, c); S->mv[r + 1][c] = tick; }
        else if (S->k[r + 1][c] == -2 || (S->st[r + 1][c] != PS_FALL && S->st[r + 1][c] != PS_HANG)) { S->st[r][c] = PS_IDLE; S->dirty = 1; S->dRows |= (WORD)(1 << r); S->dCols |= (BYTE)(1 << c); }
    }
    for (c = 0; c < COLS; c++) if (S->k[ROWS - 1][c] >= 0 && S->st[ROWS - 1][c] == PS_FALL) { S->st[ROWS - 1][c] = PS_IDLE; S->dirty = 1; S->dRows |= (WORD)(1 << (ROWS - 1)); S->dCols |= (BYTE)(1 << c); }
}

/* ---------------------------------------------------------------- matching */
static void attack(Track *t, WORD units)
{
    WORD out;
    if (!t->vs || !units) return;
    S->atkFrac = (WORD)(S->atkFrac + units * SEND_Q8);
    out = (WORD)(S->atkFrac >> 8); S->atkFrac &= 255;
    trk_send(t, out);
}

static SBYTE idle_k(const Track *t, int r, int c) { return (SBYTE)(S->k[r][c] >= 0 && S->st[r][c] == PS_IDLE ? S->k[r][c] : -1); }

static void check_matches(Track *t, WORD rows, BYTE cols)
{
    BYTE hit[ROWS][COLS];
    int r, c, e, q, n = 0, g;
    SBYTE k;
    BYTE isChain = 0;
    Grp *gp = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (r = 0; r < ROWS; r++) { if (!(rows & (1 << r))) continue; c = 0; while (c < COLS) { k = idle_k(t, r, c); e = c + 1; while (e < COLS && idle_k(t, r, e) == k) e++; if (k >= 0 && e - c >= 3) { for (q = c; q < e; q++) hit[r][q] = 1; n++; } c = e; } }
    for (c = 0; c < COLS; c++) { if (!(cols & (1 << c))) continue; r = 0; while (r < ROWS) { k = idle_k(t, r, c); e = r + 1; while (e < ROWS && idle_k(t, e, c) == k) e++; if (k >= 0 && e - r >= 3) { for (q = r; q < e; q++) hit[q][c] = 1; n++; } r = e; } }
    if (!n) return;
    n = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) n += hit[r][c];
    for (g = 0; g < SW_MAXGRP; g++) if (!S->grp[g].alive) { gp = &S->grp[g]; break; }
    if (!gp) { g = 0; gp = &S->grp[0]; }
    gp->alive = 1; gp->t = (SWORD)(CLEAR_MS + n * 40); gp->n = (BYTE)n; gp->slabs = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
        if (S->chainf[r][c]) isChain = 1;
        S->st[r][c] = PS_CLEAR; S->grpOf[r][c] = (BYTE)g;
#define SLABN(rr, cc) if ((rr) >= 0 && (rr) < ROWS && (cc) >= 0 && (cc) < COLS && S->k[rr][cc] == -2) gp->slabs |= (BYTE)(1 << S->slabOf[rr][cc]);
        SLABN(r + 1, c) SLABN(r - 1, c) SLABN(r, c + 1) SLABN(r, c - 1)
#undef SLABN
    }
    if (isChain) { S->chain++; trk_say(t, "CHAIN!", PAL_YELLOW); if (S->stopT < STOP_CHAIN) S->stopT = STOP_CHAIN; }
    else if (!S->chain) S->chain = 1;
    if (S->chain > S->maxChain) S->maxChain = S->chain;
    if (isChain || n >= 4) t->bigMark = 1;
    if (n >= 4) { trk_say(t, "COMBO", PAL_CYAN); if (S->stopT < STOP_COMBO + n * 100) S->stopT = (SWORD)(STOP_COMBO + n * 100); attack(t, (WORD)(n - 1)); }
    S->score += (DWORD)n * 10 * (S->chain ? S->chain : 1);
    trk_sfx(t, isChain || n >= 4 ? S_BIG : S_CLEAR);
}

static void break_slab(Track *t, int si)
{
    Slab *s = &S->slab[si];
    int rb = s->r + s->h - 1, c;
    for (c = s->c; c < s->c + s->w; c++) {
        if (rb < 0) continue;
        put_block(t, rb, c, (SBYTE)trk_rnd(t, NC));
        S->chainf[rb][c] = 1; S->st[rb][c] = PS_HANG; S->tm[rb][c] = HANG * 2;
    }
    s->h--;
    if (!s->h) s->alive = 0;
    trk_sfx(t, S_GARBAGE);
}

static void finish_group(Track *t, int g)
{
    int r, c, rr, si;
    BYTE slabs = S->grp[g].slabs;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (S->k[r][c] >= 0 && S->st[r][c] == PS_CLEAR && S->grpOf[r][c] == g) {
        clear_cell(t, r, c);
        for (rr = r - 1; rr >= 0; rr--) { if (S->k[rr][c] < 0 || S->st[rr][c] == PS_CLEAR) break; S->chainf[rr][c] = 1; }
    }
    S->grp[g].alive = 0;
    for (si = 0; si < SW_MAXSLAB; si++) if ((slabs & (1 << si)) && S->slab[si].alive) break_slab(t, si);
}

static BYTE groups_alive(const Track *t)
{
    int g;
    for (g = 0; g < SW_MAXGRP; g++) if (S->grp[g].alive) return 1;
    return 0;
}

static void end_chain_if_done(Track *t)
{
    int r, c;
    if (!S->chain || groups_alive(t)) return;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (S->k[r][c] >= 0 && S->chainf[r][c]) return;
    if (S->chain >= 2) attack(t, (WORD)((S->chain - 1) * 6));
    S->chain = 0;
}

static BYTE area_free(const Track *t, int r, int c, int w, int h)
{
    int rr, cc;
    for (rr = r; rr < r + h; rr++) for (cc = c; cc < c + w; cc++) if (S->k[rr][cc] != -1) return 0;
    return 1;
}

static void drop_garbage(Track *t)
{
    Batch bs[8];
    BYTE nb = trk_take_ready(t, GARBAGE_DELAY, 0, bs, 8), k, li, nl = 0;
    WORD n = S->carry, gap = 0, rows, rem;
    BYTE lw[2], lh[2];
    int r, c, rr, cc, si;
    if (!nb) return;
    for (k = 0; k < nb; k++) { n = (WORD)(n + bs[k].n * UNIT_PANELS); gap = bs[k].gap; }
    rows = (WORD)(n / 6); if (rows > MAX_ROWS) rows = MAX_ROWS;
    rem = (WORD)(n % 6);
    S->carry = (BYTE)(rem >= 3 ? 0 : rem);
    if (rows) { lw[nl] = 6; lh[nl] = (BYTE)rows; nl++; }
    if (rem >= 3) { lw[nl] = (BYTE)rem; lh[nl] = 1; nl++; }
    for (li = 0; li < nl; li++) {
        Slab *s = 0;
        c = lw[li] == 6 ? 0 : (int)(((DWORD)gap * (COLS - lw[li] + 1)) / 1000) % (COLS - lw[li] + 1);
        r = HID - lh[li];
        while (r >= 0 && !area_free(t, r, c, lw[li], lh[li])) r--;
        if (r < 0) { die(t); return; }
        for (si = 0; si < SW_MAXSLAB; si++) if (!S->slab[si].alive) { s = &S->slab[si]; break; }
        if (!s) return;
        s->alive = 1; s->r = (SBYTE)r; s->c = (BYTE)c; s->w = lw[li]; s->h = lh[li];
        for (rr = r; rr < r + lh[li]; rr++) for (cc = c; cc < c + lw[li]; cc++) { put_block(t, rr, cc, -2); S->slabOf[rr][cc] = (BYTE)si; }
    }
    trk_sfx(t, S_GARBAGE);
}

/* ---------------------------------------------------------------- rising */
static BYTE topped(const Track *t)
{
    int r, c;
    for (r = 0; r <= HID; r++) for (c = 0; c < COLS; c++) {
        if (S->k[r][c] == -1) continue;
        if (S->k[r][c] == -2 ? !slab_can_fall(t, &S->slab[S->slabOf[r][c]]) : (S->st[r][c] == PS_IDLE || S->st[r][c] == PS_CLEAR)) return 1;
    }
    return 0;
}

static void push_row(Track *t)
{
    int r, c, si;
    for (c = 0; c < COLS; c++) if (S->k[0][c] != -1) { die(t); return; }
    for (r = 0; r < ROWS - 1; r++) for (c = 0; c < COLS; c++) move_cell(t, r + 1, c, r, c);
    for (c = 0; c < COLS; c++) put_block(t, ROWS - 1, c, S->preview[c]);
    for (si = 0; si < SW_MAXSLAB; si++) if (S->slab[si].alive) S->slab[si].r--;
    new_row(t);
    if (S->cr > HID) S->cr--;
    S->score++;
}

static BYTE busy(const Track *t)
{
    int r, c;
    if (groups_alive(t)) return 1;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (is_moving(t, r, c)) return 1;
    return 0;
}

/* ---------------------------------------------------------------- weapons */
BYTE swap_fx(Track *t, BYTE w)
{
    BYTE q = (BYTE)(w & 0x80);
    int r, c, si, low = -1;
    w &= 0x7f;
    if (w == W_WIPE) {
        if (q) return 1;
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) clear_cell(t, r, c);
        for (si = 0; si < SW_MAXSLAB; si++) S->slab[si].alive = 0;
        for (si = 0; si < SW_MAXGRP; si++) S->grp[si].alive = 0;
        fill_start(t);
        return 1;
    }
    if (w == W_REMOVE) {
        if (q) return 1;
        for (si = 0; si < SW_MAXSLAB; si++) if (S->slab[si].alive && (low < 0 || S->slab[si].r + S->slab[si].h > S->slab[low].r + S->slab[low].h)) low = si;
        if (low < 0) {
            for (r = 0; r < ROWS; r++) {
                for (c = 0; c < COLS; c++) if (S->k[r][c] != -1) break;
                if (c < COLS) { for (c = 0; c < COLS; c++) clear_cell(t, r, c); return 1; }
            }
            return 1;
        }
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (S->k[r][c] == -2 && S->slabOf[r][c] == low) clear_cell(t, r, c);
        S->slab[low].alive = 0;
        return 1;
    }
    return 0;
}
BYTE swap_safe(const Track *t) { return (BYTE)!busy(t); }
void swap_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h) { (void)t; *x = FX; *y = FY; *w = COLS * 2; *h = VIS * 2; }

/* ---------------------------------------------------------------- init / update */
static const WORD THINK[9] = { 0, 2400, 2000, 1600, 1000, 600, 420, 280, 160 };
static const WORD STEP[9] = { 0, 320, 280, 240, 170, 110, 85, 60, 40 };
static const BYTE MISTAKE[9] = { 0, 55, 45, 35, 22, 12, 7, 4, 1 };
static const BYTE RAISE_H[9] = { 0, 6, 6, 7, 7, 8, 8, 8, 9 };

void swap_init(Track *t)
{
    int r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) clear_cell(t, r, c);
    S->cr = ROWS - 4; S->cc = 2;
    fill_start(t);
    new_row(t);
    if (t->cpu) { S->cpu.level = t->cpu; S->cpu.wait = THINK[t->cpu]; }
}

void swap_update(Track *t, Pad *pad, WORD dt)
{
    int r, c, g;
    BYTE top, was;
    if (t->dead) return;
    trk_tick_pending(t, dt);
    S->elapsed += dt;
    handle(t, pad);
    /* the board is only searched again after something moved or changed state */
    was = S->dirty; S->dirty = 0;
    {
        /* rows / columns changed since the last check, plus anything changed this frame */
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++)
        if (S->st[r][c] == PS_HANG && S->k[r][c] >= 0) { S->tm[r][c] = (SWORD)(S->tm[r][c] - dt); if (S->tm[r][c] <= 0) { S->st[r][c] = PS_FALL; S->dirty = 1; S->dRows |= (WORD)(1 << r); S->dCols |= (BYTE)(1 << c); } }
    for (g = 0; g < SW_MAXGRP; g++) if (S->grp[g].alive) { S->grp[g].t = (SWORD)(S->grp[g].t - dt); if (S->grp[g].t <= 0) finish_group(t, g); }
    if (was || S->dirty) mark_hang(t, S->dCols);
    S->gAcc = (WORD)(S->gAcc + dt);
    while (S->gAcc >= FALL_TICK) { S->gAcc = (WORD)(S->gAcc - FALL_TICK); fall_step(t); }
    if (was || S->dirty) {
        WORD rows = S->dRows; BYTE cols = S->dCols;
        S->dRows = 0; S->dCols = 0;
        check_matches(t, rows, cols);
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (S->k[r][c] >= 0 && S->chainf[r][c] && S->st[r][c] == PS_IDLE) {
            if (r == ROWS - 1 || S->k[r + 1][c] == -2 || (S->k[r + 1][c] >= 0 && (S->st[r + 1][c] == PS_IDLE || S->st[r + 1][c] == PS_CLEAR))) S->chainf[r][c] = 0;
        }
    }
    }
    end_chain_if_done(t);
    if (t->vs && t->npend && (!groups_alive(t) || t->pending[0].t >= FORCE_DROP)) drop_garbage(t);
    if (t->dead) return;
    if (S->stopT > 0) S->stopT = (SWORD)(S->stopT - dt);
    top = topped(t);
    if (top) {
        if (!groups_alive(t)) {
            SWORD before = S->panicT;
            S->panicT = (SWORD)(S->panicT + dt);
            if (S->panicT / 400 != before / 400) trk_sfx(t, S_TICK);
            if (S->panicT >= PANIC) { die(t); return; }
        }
        S->rise = 0;
    } else {
        S->panicT = (SWORD)(S->panicT - dt * 2); if (S->panicT < 0) S->panicT = 0;
        if (!groups_alive(t) && (S->stopT <= 0 || S->raising)) {
            if (S->raising) S->stopT = 0;
            S->rise = (WORD)(S->rise + (WORD)(((DWORD)dt * (ROWPX << 8)) / (S->raising ? RAISE : rise_ms(t))));
            while (S->rise >= (ROWPX << 8) && !t->dead) {
                S->rise = (WORD)(S->rise - (ROWPX << 8));
                push_row(t);
                if (topped(t)) { S->rise = 0; break; }
            }
        }
    }
}

/* ---------------------------------------------------------------- CPU */
typedef SBYTE Snap[ROWS][COLS];

static void snapshot(const Track *t, Snap m)
{
    int r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++)
        m[r][c] = S->k[r][c] == -1 ? -1 : S->k[r][c] == -2 ? -2 : S->st[r][c] == PS_IDLE ? S->k[r][c] : -3;
}
static void settle(Snap m)
{
    int c, r, w;
    for (c = 0; c < COLS; c++) {
        w = ROWS - 1;
        for (r = ROWS - 1; r >= 0; r--) {
            SBYTE v = m[r][c];
            if (v == -2 || v == -3) w = r - 1;
            else if (v >= 0) { if (w != r) { m[w][c] = v; m[r][c] = -1; } w--; }
        }
    }
}
static BYTE match_info(Snap m, BYTE *garb)
{
    BYTE hit[ROWS][COLS];
    int r, c, e, q, n = 0;
    SBYTE k;
    *garb = 0;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) hit[r][c] = 0;
    for (r = 0; r < ROWS; r++) { c = 0; while (c < COLS) { k = m[r][c]; e = c + 1; while (e < COLS && m[r][e] == k) e++; if (k >= 0 && e - c >= 3) for (q = c; q < e; q++) hit[r][q] = 1; c = e; } }
    for (c = 0; c < COLS; c++) { r = 0; while (r < ROWS) { k = m[r][c]; e = r + 1; while (e < ROWS && m[e][c] == k) e++; if (k >= 0 && e - r >= 3) for (q = r; q < e; q++) hit[q][c] = 1; r = e; } }
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (hit[r][c]) {
        n++;
        if (r + 1 < ROWS && m[r + 1][c] == -2) (*garb)++;
        if (r > 0 && m[r - 1][c] == -2) (*garb)++;
        if (c + 1 < COLS && m[r][c + 1] == -2) (*garb)++;
        if (c > 0 && m[r][c - 1] == -2) (*garb)++;
    }
    return (BYTE)n;
}

static void cpu_keep(SwapCpu *k, SWORD sc, int r, int c, int to)
{
    int i, j;
    for (i = 0; i < k->nbest; i++) if (sc > k->bsc[i]) break;
    if (i >= 4) return;
    for (j = (k->nbest < 4 ? k->nbest : 3); j > i; j--) { k->bsc[j] = k->bsc[j - 1]; k->bmv[j][0] = k->bmv[j - 1][0]; k->bmv[j][1] = k->bmv[j - 1][1]; k->bmv[j][2] = k->bmv[j - 1][2]; }
    k->bsc[i] = sc; k->bmv[i][0] = (BYTE)r; k->bmv[i][1] = (BYTE)c; k->bmv[i][2] = (BYTE)to;
    if (k->nbest < 4) k->nbest++;
}

/* one (panel, target) try per call; returns 0 when every move has been tried */
#define NOT_STARTED (-9)

static BYTE cpu_plan_unit(Track *t)
{
    SwapCpu *k = &S->cpu;
    Snap mm;
    int r = k->prow, c = k->pcol, to, i, rr;
    BYTE n, garb;
    SBYTE v;
    for (;;) {
        if (k->prow >= ROWS) return 0;
        r = k->prow; c = k->pcol;
        if (k->snap[r][c] >= 0) {
            if (k->pto == NOT_STARTED) { k->pdir = 0; k->pto = (SBYTE)(c - 1); }
            to = k->pto;
            if (to >= 0 && to < COLS && k->snap[r][to] != -2 && k->snap[r][to] != -3) break;
            if (k->pdir == 0) { k->pdir = 1; k->pto = (SBYTE)(c + 1); to = k->pto; if (to < COLS && k->snap[r][to] != -2 && k->snap[r][to] != -3) break; }
        }
        /* next panel */
        k->pto = NOT_STARTED;
        if (++k->pcol >= COLS) { k->pcol = 0; k->prow++; }
    }
    for (rr = 0; rr < ROWS; rr++) for (i = 0; i < COLS; i++) mm[rr][i] = k->snap[rr][i];
    v = mm[r][c];
    if (to > c) for (i = c; i < to; i++) mm[r][i] = mm[r][i + 1];
    else for (i = c; i > to; i--) mm[r][i] = mm[r][i - 1];
    mm[r][to] = v;
    settle(mm);
    n = match_info(mm, &garb);
    if (n) cpu_keep(k, (SWORD)(n * 10 + (n >= 4 ? 25 : 0) + garb * 12 + r - (to > c ? to - c : c - to) * 3), r, c, to);
    /* next target in this direction */
    k->pto = (SBYTE)(k->pdir ? to + 1 : to - 1);
    if (k->pdir == 0 && k->pto < 0) { k->pdir = 1; k->pto = (SBYTE)(c + 1); }
    if (k->pdir == 1 && k->pto >= COLS) { k->pto = NOT_STARTED; if (++k->pcol >= COLS) { k->pcol = 0; k->prow++; } }
    return 1;
}

static void cpu_build(Track *t, int r, int c, int to)
{
    SwapCpu *k = &S->cpu;
    int cr = S->cr, cc = S->cc, dir = to > c ? 1 : -1, pos = c, n = 0, tc;
    while (pos != to && n < 22) {
        tc = dir > 0 ? pos : pos - 1;
        while (cr < r && n < 22) { k->script[n++] = 2; cr++; }
        while (cr > r && n < 22) { k->script[n++] = 1; cr--; }
        while (cc < tc && n < 22) { k->script[n++] = 4; cc++; }
        while (cc > tc && n < 22) { k->script[n++] = 3; cc--; }
        k->script[n++] = 5;
        pos += dir;
    }
    k->n = (BYTE)n;
}

/* nothing to match: raise a low stack, or flatten the tallest column */
static void cpu_fallback(Track *t)
{
    SwapCpu *k = &S->cpu;
    Snap m;
    int hs[COLS], c, r, maxH = 0, tall = 0, d = 0;
    snapshot(t, m);
    for (c = 0; c < COLS; c++) { hs[c] = 0; for (r = 0; r < ROWS; r++) if (m[r][c] != -1) { hs[c] = ROWS - r; break; } if (hs[c] > maxH) { maxH = hs[c]; tall = c; } }
    if (maxH - HID < RAISE_H[k->level] && !busy(t)) { k->script[0] = 6; k->n = 1; return; }
    if (tall > 0 && hs[tall - 1] < hs[tall] - 1) d = -1;
    if (tall < COLS - 1 && hs[tall + 1] < hs[tall] - 1 && (!d || trk_rnd(t, 2))) d = 1;
    if (!d) return;
    r = ROWS - hs[tall];
    if (m[r][tall] < 0 || r < HID) return;
    cpu_build(t, r, tall, tall + d);
}

void swap_cpu(Track *t, Pad *pad, WORD dt)
{
    static const WORD KEYB[7] = { 0, B_UP, B_DOWN, B_LEFT, B_RIGHT, B_A, B_C };
    SwapCpu *k = &S->cpu;
    int i;
    if (k->hold) { k->hold = k->hold > dt ? (WORD)(k->hold - dt) : 0; pad_feed(pad, B_C, dt); return; }
    if (k->tap) { k->tap = 0; pad_feed(pad, 0, dt); return; }
    if (k->planning) {
        if (xm_think) while (cpu_plan_unit(t) && xm_time_ok()) ;
        if (k->prow >= ROWS) {
            k->planning = 0;
            if (k->nbest) {
                i = (k->nbest > 1 && trk_rnd(t, 100) < MISTAKE[k->level]) ? 1 + trk_rnd(t, (WORD)(k->nbest - 1)) : 0;
                cpu_build(t, k->bmv[i][0], k->bmv[i][1], k->bmv[i][2]);
            } else cpu_fallback(t);
            if (!k->n) k->wait = THINK[k->level];
        }
        pad_feed(pad, 0, dt); return;
    }
    if (k->wait > dt) { k->wait = (WORD)(k->wait - dt); pad_feed(pad, 0, dt); return; }
    k->wait = 0;
    if (!k->n) {
        if (busy(t)) { k->wait = 60; pad_feed(pad, 0, dt); return; }
        k->planning = 1; k->prow = HID; k->pcol = 0; k->pto = NOT_STARTED; k->nbest = 0; snapshot(t, k->snap);
        pad_feed(pad, 0, dt); return;
    }
    {
        BYTE b = k->script[0];
        for (i = 1; i < k->n; i++) k->script[i - 1] = k->script[i];
        k->n--;
        if (b == 6) { k->hold = RAISE; k->wait = THINK[k->level]; pad_feed(pad, B_C, dt); return; }
        pad_feed(pad, KEYB[b], dt); k->tap = 1;
        k->wait = k->n ? STEP[k->level] : (WORD)((DWORD)THINK[k->level] * (60 + trk_rnd(t, 81)) / 100);
    }
}

/* ---------------------------------------------------------------- drawing */
/* lit: bit 0 TL, 1 TR, 2 BL, 3 BR take the cursor-corner tiles */
static void cell(int x, int y, BYTE pal, WORD base, WORD litBase, BYTE lit, int ymin, int ymax)
{
    int q;
    if (!lit && y >= ymin && y + 1 <= ymax) { CV_CELL16(x, y, pal, base); return; }
    for (q = 0; q < 4; q++) {
        int yy = y + (q >> 1);
        if (yy < ymin || yy > ymax) continue;
        cv_put(x + (q & 1), yy, TW(pal, TB4((WORD)(((lit >> q) & 1) ? litBase + q : base + q))));
    }
}

void swap_draw(Track *t, int ox)
{
    int r, c, fx = ox + FX, off = (S->rise >> 8) >= 8 ? 1 : 0, y, ymin = FY, ymax = FY + VIS * 2 - 1;
    BYTE lit, flashOn = (BYTE)((frames_now() >> 2) & 1);
    for (y = 0; y < VIS * 2; y++) { cv_put(fx - 1, FY + y, TW(PAL_STEEL, TB3(T_FR_L))); cv_put(fx + COLS * 2, FY + y, TW(PAL_STEEL, TB3(T_FR_R))); }
    if (S->panicT > 0 && (frames_now() & 4)) { cv_put(fx - 1, FY, TW(PAL_RED, TB3(T_FR_L))); cv_put(fx + COLS * 2, FY, TW(PAL_RED, TB3(T_FR_R))); }
    for (r = HID; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        y = FY + (r - HID) * 2 - off;
        lit = 0;
        if (!t->dead && r == S->cr && c == S->cc) lit = 1 | 4;
        if (!t->dead && r == S->cr && c == S->cc + 1) lit = 2 | 8;
        if (S->k[r][c] == -1) { cell(fx + c * 2, y, PAL_STEEL, C_EMPTY16, C_LITEMPTY, lit, ymin, ymax); continue; }
        if (S->k[r][c] == -2) { cell(fx + c * 2, y, PAL_GREY, C_STONE, C_STONELIT, lit, ymin, ymax); continue; }
        if (S->st[r][c] == PS_CLEAR && flashOn) { cell(fx + c * 2, y, PAL_WHITE, C_FLASH, C_FLASH, 0, ymin, ymax); continue; }
        cell(fx + c * 2, y, KPAL[S->k[r][c]], C_SQ(KSYM[S->k[r][c]]), C_SQLIT(KSYM[S->k[r][c]]), lit, ymin, ymax);
    }
    /* garbage still above the top: a red marker over the column */
    for (r = 0; r < HID; r++) for (c = 0; c < COLS; c++) if (S->k[r][c] == -2) cv_put(fx + c * 2, 0, TW(PAL_RED, TB3('V')));
    /* the next row coming up, greyed, under the field */
    if (off) for (c = 0; c < COLS; c++) cell(fx + c * 2, FY + VIS * 2 - 1, PAL_GREY, C_SQ(KSYM[S->preview[c]]), 0, 0, FY + VIS * 2 - 1, FY + VIS * 2 - 1);
    cv_pending(ox + 2, FY, VIS * 2, t, 16 / 3, GARBAGE_DELAY);
    cv_text(ox + 17, FY, PAL_GREY, "SC");
    cv_text(ox + 17, FY + 1, PAL_GREEN, cv_num(S->score > 999 ? 999 : S->score));
    if (S->maxChain > 1) { cv_text(ox + 17, FY + 3, PAL_GREY, "CH"); cv_text(ox + 17, FY + 4, PAL_YELLOW, cv_num(S->maxChain)); }
    cv_text(ox + 17, FY + 21, PAL_BEIGE, "C/D");
    cv_text(ox + 17, FY + 22, PAL_BEIGE, "UP");
}
