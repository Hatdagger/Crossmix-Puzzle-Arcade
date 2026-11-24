/*
 * The shared parts of every track (js/track.js): incoming units, cancelling,
 * messages, Arsenal weapons and Power Brick powers, Swap Hands, Fog, Flip.
 */
#include "xm.h"
#include "tiles.h"

const char *const WEAPON_NAME[W_COUNT] = {
    "", "CLEAR FIELD", "EMPTY INVENTORY", "ADD LINE", "REMOVE LINE", "SPEED UP", "SLOW DOWN",
    "GRAVITY", "FLIP FIELD", "SWAP FIELDS", "FOG", "SWAP HANDS", "RUSH", "SHAKE", "SHIELD"
};

static const char *const NAMES[TK_COUNT] = {
    "BRICK", "CALM", "CLIMB", "JEWEL", "SWAP", "POP", "GRAB", "NOM NOM! PETS", "ARSENAL", "POWER BRICK"
};
static const BYTE COLORS[TK_COUNT] = {
    PAL_PINK, PAL_CYAN, PAL_LIME, PAL_YELLOW, PAL_CYAN, PAL_BLUE, PAL_GREEN, PAL_PINK, PAL_AMBER, PAL_PINK
};
const char *trk_name(BYTE kind) { return NAMES[kind]; }
BYTE trk_color(BYTE kind) { return COLORS[kind]; }
BYTE trk_cpu_weak(BYTE kind) { return (BYTE)(kind == TK_CLIMB); }

static BYTE is_brick(BYTE k) { return (BYTE)(k == TK_BRICK || k == TK_CLIMB || k == TK_ARSENAL || k == TK_POWER); }

/* ---------------------------------------------------------------- random */
DWORD trk_rand(Track *t)
{
    DWORD x = t->rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    t->rng = x;
    return x;
}
/* 0..n-1 without a 32-bit divide */
WORD trk_rnd(Track *t, WORD n)
{
    DWORD r = trk_rand(t) >> 16;
    return (WORD)((r * n) >> 16);
}

/* ---------------------------------------------------------------- pad */
void pad_feed(Pad *p, WORD bits, WORD dt)
{
    int k;
    p->lastDt = dt;
    p->prev = p->cur;
    p->cur = bits;
    for (k = 0; k < 10; k++) {
        if (bits & (1 << k)) { if (p->held[k] < 60000U) p->held[k] = (WORD)(p->held[k] + dt); }
        else p->held[k] = 0;
    }
}
static int bit_index(WORD b) { int k = 0; while (k < 10 && !(b & (1 << k))) k++; return k; }
BYTE pad_repeat(const Pad *p, WORD b, WORD delay, WORD rate)
{
    WORD h, ph;
    if (PAD_PRESSED(p, b)) return 1;
    if (!(p->cur & b)) return 0;
    h = p->held[bit_index(b)];
    if (h < delay) return 0;
    ph = h > p->lastDt ? (WORD)(h - p->lastDt) : 0;
    ph = ph > delay ? (WORD)(ph - delay) : 0;
    return (BYTE)(((WORD)(h - delay) / rate) != (ph / rate));
}

/* ---------------------------------------------------------------- base */
WORD xm_units;

void trk_sfx(Track *t, BYTE id) { game_sfx(t->side, id); }

void trk_say(Track *t, const char *txt, BYTE pal)
{
    int k;
    for (k = MAX_SAY - 1; k > 0; k--) t->say[k] = t->say[k - 1];
    t->say[0].txt = txt; t->say[0].pal = pal; t->say[0].t = 1200;
}

void trk_receive(Track *t, WORD n)
{
    Batch *b;
    if (!n || t->dead) return;
    if (t->kind == TK_POWER && t->u.b.shield) {
        t->u.b.shield = 0;
        trk_say(t, "SHIELD!", PAL_CYAN);
        trk_sfx(t, S_BIG);
        return;
    }
    if (t->npend >= MAX_PENDING) { t->pending[MAX_PENDING - 1].n = (BYTE)(t->pending[MAX_PENDING - 1].n + n); return; }
    b = &t->pending[t->npend++];
    b->n = (BYTE)(n > 250 ? 250 : n); b->t = 0; b->gap = trk_rnd(t, 1000);
    trk_sfx(t, S_INCOMING);
}

WORD trk_pending_total(const Track *t)
{
    WORD s = 0; int k;
    for (k = 0; k < t->npend; k++) s = (WORD)(s + t->pending[k].n);
    return s;
}

void trk_tick_pending(Track *t, WORD dt)
{
    int k;
    for (k = 0; k < t->npend; k++) if (t->pending[k].t < 60000U) t->pending[k].t = (WORD)(t->pending[k].t + dt);
}

static void drop_first(Track *t)
{
    int k;
    for (k = 1; k < t->npend; k++) t->pending[k - 1] = t->pending[k];
    t->npend--;
}

/* batches that have waited at least delay ms, up to max units in all */
BYTE trk_take_ready(Track *t, WORD delay, WORD max, Batch *out, BYTE maxOut)
{
    BYTE n = 0;
    WORD budget = max ? max : 60000U, k;
    while (t->npend && t->pending[0].t >= delay && budget > 0 && n < maxOut) {
        Batch *b = &t->pending[0];
        k = b->n < budget ? b->n : budget;
        out[n].n = (BYTE)k; out[n].gap = b->gap; out[n].t = b->t; n++;
        b->n = (BYTE)(b->n - k); budget = (WORD)(budget - k);
        if (!b->n) drop_first(t);
    }
    return n;
}

WORD trk_take_all(Track *t)
{
    WORD s = trk_pending_total(t);
    t->npend = 0;
    return s;
}

void trk_send(Track *t, WORD n)
{
    if (!n) return;
    if (t->cancelOn) {
        while (n && t->npend) {
            Batch *b = &t->pending[0];
            WORD k = b->n < n ? b->n : n;
            b->n = (BYTE)(b->n - k); n = (WORD)(n - k);
            if (!b->n) drop_first(t);
        }
    }
    if (!n) { trk_say(t, "BLOCK", PAL_CYAN); return; }
    t->sent = (WORD)(t->sent + n);
    t->outUnits = (WORD)(t->outUnits + n);
}

void trk_hit(Track *t, BYTE w)
{
    if (t->noutW < 4) t->outW[t->noutW++] = w;
}

/* ---------------------------------------------------------------- weapons */
static BYTE kind_fx(Track *t, BYTE w)
{
    switch (t->kind) {
    case TK_CALM:  return calm_fx(t, w);
    case TK_JEWEL: return jewel_fx(t, w);
    case TK_SWAP:  return swap_fx(t, w);
    case TK_POP:   return pop_fx(t, w);
    case TK_GRAB:  return grab_fx(t, w);
    case TK_NOM:   return nom_fx(t, w);
    default:       return brick_fx(t, w);
    }
}

BYTE trk_fx_safe(const Track *t)
{
    switch (t->kind) {
    case TK_CALM:  return calm_safe(t);
    case TK_JEWEL: return jewel_safe(t);
    case TK_SWAP:  return swap_safe(t);
    case TK_POP:   return pop_safe(t);
    case TK_GRAB:  return grab_safe(t);
    case TK_NOM:   return nom_safe(t);
    default:       return brick_safe(t);
    }
}

BYTE trk_takes(const Track *t, BYTE w, const Track *src)
{
    (void)src;
    switch (w) {
    case W_ADD: case W_FAST: case W_SLOW: case W_FLIP: case W_REMOVE:
    case P_FOG: case P_HANDS: case P_RUSH: case W_SWAP:
        return 1;
    case W_WIPE: case W_GRAVITY: case W_EMPTY:
        return kind_fx((Track *)t, (BYTE)(w | 0x80));
    }
    return 0;
}

void trk_apply_weapon(Track *t, BYTE w, const Track *src)
{
    if (t->dead) return;
    if (!trk_takes(t, w, src)) { trk_say(t, "IMMUNE", PAL_GREY); return; }
    if (w == W_SWAP) return;            /* the match swaps the two games */
    if (t->nfxq < MAX_FXQ) t->fxq[t->nfxq++] = w;
}

static void run_fx(Track *t)
{
    BYTE w, bad, k;
    while (t->nfxq && !t->dead && trk_fx_safe(t)) {
        w = t->fxq[0];
        for (k = 1; k < t->nfxq; k++) t->fxq[k - 1] = t->fxq[k];
        t->nfxq--;
        bad = (BYTE)(w == W_FAST || w == W_ADD || w == W_FLIP || w == P_FOG || w == P_HANDS || w == P_RUSH);
        trk_say(t, WEAPON_NAME[w], bad ? PAL_RED : PAL_CYAN);
        trk_sfx(t, w == W_ADD ? S_GARBAGE : S_BIG);
        switch (w) {
        case W_ADD:    trk_receive(t, 1); break;
        case W_FLIP:   t->flipT = 8000; break;
        case P_FOG:    t->fogT = 5000; break;
        case P_HANDS:  t->handsT = 5000; break;
        case P_RUSH:   t->rushT = 6000; break;
        case W_FAST:   if (t->speedLv < 5) t->speedLv++; break;
        case W_SLOW:   if (t->speedLv > -3) t->speedLv--; break;
        case W_REMOVE:
            if (t->npend) { Batch *b = &t->pending[t->npend - 1]; if (!--b->n) t->npend--; }
            else kind_fx(t, W_REMOVE);
            break;
        default: kind_fx(t, w); break;
        }
    }
}

/* speed multiplier, Q8: x1.25 per level from x0.5 to x3, doubled by Rush */
static const WORD SPEED_Q8[9] = { 131, 164, 205, 256, 320, 400, 500, 625, 768 };
WORD trk_speed_q8(const Track *t)
{
    WORD m = SPEED_Q8[t->speedLv + 3];
    if (t->rushT > 0) m = (WORD)(m * 2);
    return m;
}

/* ---------------------------------------------------------------- init / update */
void trk_init(Track *t, BYTE kind, BYTE side, BYTE cpu, DWORD seed, BYTE vs, BYTE race)
{
    BYTE *p = (BYTE *)t;
    WORD k;
    Track *opp = t->opp;
    for (k = 0; k < sizeof(Track); k++) p[k] = 0;
    t->opp = opp;
    t->kind = kind; t->side = side; t->cpu = cpu; t->vs = vs; t->race = race;
    t->rng = seed ? seed : 0x2545F491UL;
    t->cancelOn = 1;
    switch (kind) {
    case TK_CALM:  calm_init(t); break;
    case TK_JEWEL: jewel_init(t); break;
    case TK_SWAP:  swap_init(t); break;
    case TK_POP:   pop_init(t); break;
    case TK_GRAB:  grab_init(t); break;
    case TK_NOM:   nom_init(t); break;
    default:       brick_init(t); break;
    }
}

static void swap_lr(Pad *v)
{
    WORD l = (WORD)(v->cur & B_LEFT), r = (WORD)(v->cur & B_RIGHT), pl = (WORD)(v->prev & B_LEFT), pr = (WORD)(v->prev & B_RIGHT), h;
    v->cur = (WORD)((v->cur & ~(B_LEFT | B_RIGHT)) | (l ? B_RIGHT : 0) | (r ? B_LEFT : 0));
    v->prev = (WORD)((v->prev & ~(B_LEFT | B_RIGHT)) | (pl ? B_RIGHT : 0) | (pr ? B_LEFT : 0));
    h = v->held[2]; v->held[2] = v->held[3]; v->held[3] = h;
}

static void dec(SWORD *v, WORD dt) { if (*v > 0) { *v = (SWORD)(*v - (SWORD)dt); if (*v < 0) *v = 0; } }

void trk_update(Track *t, Pad *pad, WORD dt)
{
    Pad view;
    WORD d2 = dt;
    int k;
    for (k = 0; k < MAX_SAY; k++) if (t->say[k].t) t->say[k].t = t->say[k].t > dt ? (WORD)(t->say[k].t - dt) : 0;
    if (!t->dead) {
        dec(&t->flipT, dt); dec(&t->fogT, dt); dec(&t->rushT, dt); dec(&t->handsT, dt);
        run_fx(t);
    }
    /* non-brick tracks run their whole clock faster or slower; brick tracks only their drop speed */
    if (!is_brick(t->kind)) {
        DWORD x = (DWORD)dt * trk_speed_q8(t) + t->speedAcc;
        d2 = (WORD)(x >> 8); t->speedAcc = (WORD)(x & 255);
    }
    if (t->cpu && !t->dead) {
        xm_units = 0;
        switch (t->kind) {
        case TK_CALM:  calm_cpu(t, pad, d2); break;
        case TK_JEWEL: jewel_cpu(t, pad, d2); break;
        case TK_SWAP:  swap_cpu(t, pad, d2); break;
        case TK_POP:   pop_cpu(t, pad, d2); break;
        case TK_GRAB:  grab_cpu(t, pad, d2); break;
        case TK_NOM:   nom_cpu(t, pad, d2); break;
        default:       brick_cpu(t, pad, d2); break;
        }
    }
    view = *pad;
    if (t->handsT > 0) swap_lr(&view);
    switch (t->kind) {
    case TK_CALM:  calm_update(t, &view, d2); break;
    case TK_JEWEL: jewel_update(t, &view, d2); break;
    case TK_SWAP:  swap_update(t, &view, d2); break;
    case TK_POP:   pop_update(t, &view, d2); break;
    case TK_GRAB:  grab_update(t, &view, d2); break;
    case TK_NOM:   nom_update(t, &view, d2); break;
    default:       brick_update(t, &view, d2); break;
    }
}

/* ---------------------------------------------------------------- drawing */
static void field_rect(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h)
{
    switch (t->kind) {
    case TK_CALM:  calm_field(t, x, y, w, h); break;
    case TK_JEWEL: jewel_field(t, x, y, w, h); break;
    case TK_SWAP:  swap_field(t, x, y, w, h); break;
    case TK_POP:   pop_field(t, x, y, w, h); break;
    case TK_GRAB:  grab_field(t, x, y, w, h); break;
    case TK_NOM:   nom_field(t, x, y, w, h); break;
    default:       brick_field(t, x, y, w, h); break;
    }
}

void trk_draw(Track *t, int ox)
{
    BYTE fx, fy, fw, fh;
    int x, y, k, row;
    WORD tmp;
    switch (t->kind) {
    case TK_CALM:  calm_draw(t, ox); break;
    case TK_JEWEL: jewel_draw(t, ox); break;
    case TK_SWAP:  swap_draw(t, ox); break;
    case TK_POP:   pop_draw(t, ox); break;
    case TK_GRAB:  grab_draw(t, ox); break;
    case TK_NOM:   nom_draw(t, ox); break;
    default:       brick_draw(t, ox); break;
    }
    field_rect(t, &fx, &fy, &fw, &fh);
    /* Flip Field: the play field's tile rows turn upside down */
    if (t->flipT > 0 && !t->dead) {
        for (y = 0; y < fh / 2; y++) for (x = 0; x < fw; x++) {
            tmp = scr[fy + y][ox + fx + x];
            scr[fy + y][ox + fx + x] = scr[fy + fh - 1 - y][ox + fx + x];
            scr[fy + fh - 1 - y][ox + fx + x] = tmp;
        }
    }
    /* Fog: a drifting cloud over the top half (the bottom half when flipped) */
    if (t->fogT > 0 && !t->dead) {
        int y0 = t->flipT > 0 ? fy + fh - fh / 2 : fy, ph = (frames_now() >> 3) & 1;
        for (y = 0; y < fh / 2; y++) for (x = 0; x < fw; x++)
            cv_put(ox + fx + x, y0 + y, TW(PAL_GREY, TB3(((x + y + ph) & 1) ? T_FOG_A : T_FOG_B)));
        cv_textc(ox + fx, fw, y0 + fh / 4, PAL_STEEL, "FOG");
    }
    /* a lost board turns grey */
    if (t->dead) {
        for (y = fy; y < fy + fh; y++) for (x = ox + fx; x < ox + fx + fw; x++) {
            WORD w = scr[y][x];
            if ((w & 0x0fff) != TB3(' ')) scr[y][x] = (WORD)((w & 0x0fff) | (PAL_GREY << 12));
        }
    }
    /* messages: the two newest, under the field */
    for (k = 0, row = 25; k < 2; k++, row++) {
        cv_fill(ox, row, 20, 1, BLANK_W);
        if (t->say[k].t) cv_textc(ox, 20, row, ((t->say[k].t >> 7) & 1) || t->say[k].t > 600 ? t->say[k].pal : PAL_WHITE, t->say[k].txt);
    }
    /* status line: speed, rush, hands */
    cv_fill(ox, 27, 20, 1, BLANK_W);
    if (!t->dead) {
        if (t->handsT > 0) cv_textc(ox, 20, 27, PAL_PINK, "HANDS SWAPPED");
        else if (t->rushT > 0) cv_textc(ox, 20, 27, PAL_RED, "RUSH!");
        else if (t->speedLv > 0) { cv_text(ox + 6, 27, PAL_RED, "SPEED +"); cv_text(ox + 13, 27, PAL_RED, cv_num((DWORD)t->speedLv)); }
        else if (t->speedLv < 0) { cv_text(ox + 6, 27, PAL_CYAN, "SPEED -"); cv_text(ox + 13, 27, PAL_CYAN, cv_num((DWORD)-t->speedLv)); }
    }
}
