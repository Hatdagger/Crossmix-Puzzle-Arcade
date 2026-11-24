/*
 * Crossmix Puzzle Arcade - title, puzzle select, matches and menus (js/main.js).
 * No hardware here: hw.c (Neo Geo) or test/hw_pc.c (PC harness) call game_init()
 * and game_frame() and send the screen (scr[][]) out.
 */
#include "xm.h"
#include "tiles.h"
#include "game.h"

enum { SC_TITLE, SC_SELECT, SC_MATCH };
enum { M_CPU, M_VS, M_SURV, M_SIDE };
enum { PH_COUNT, PH_PLAY, PH_ROUNDEND, PH_OVER, PH_SWAP };
enum { MN_NONE, MN_PAUSE, MN_OVER };
#define RANDOM_PICK TK_COUNT
#define NLIST (TK_COUNT + 1)

static BYTE screen, mode, titleSel, cpuLevel = 3;
static BYTE pick[2] = { RANDOM_PICK, RANDOM_PICK }, selCur[2], ready[2], joined[2], selFor;
static Track trk[2];
static Pad hp[2], cpad[2];
static BYTE human[2], level[2], kind[2], active[2], wins[2], round_, kos;
static BYTE phase, menu, menuSel, menuBy, swapPending, roundWinner, lastCount;
static SWORD phaseT;
static BYTE swapped;
static WORD fcount;
static DWORD seedMix = 0x1234567UL;
static BYTE bot[2];               /* a CPU plays a human's board (attract mode, PC harness) */
static BYTE demo;                 /* attract mode: CPU vs CPU until a button is pressed */
static DWORD idleMs;
static WORD drawKey = 0xffff;      /* title / select: redraw only when this changes */
static BYTE demoNo;
static DWORD demoMs;

WORD frames_now(void) { return fcount; }

/* for the MAME test: what's on screen (screen << 12 | puzzle 1 << 4 | puzzle 0) */
WORD xm_status;

/* ---------------------------------------------------------------- helpers */
static DWORD fresh_seed(void)
{
    seedMix = seedMix * 1103515245UL + 12345UL + fcount;
    return seedMix ^ (seedMix >> 15);
}
static BYTE rnd_n(BYTE n) { return (BYTE)(((fresh_seed() >> 8) & 0xffff) * n >> 16); }

static void sfx0(BYTE id) { game_sfx(2, id); }

static const char *const MODE_NAME[4] = { "VERSUS CPU", "VERSUS 2P", "SURVIVAL", "SIDE BY SIDE" };
static const char *const MODE_DESC[4] = {
    "BEST OF 3 AGAINST THE COMPUTER", "BEST OF 3, PLAYER AGAINST PLAYER",
    "BEAT CPU AFTER CPU. SCORE = KOS", "NO ATTACKS. EITHER PLAYER CAN PAUSE"
};
static const char *const HELP[TK_COUNT][3] = {
    { "MODERN BLOCKS", "A/B TURN  C HOLD", "UP OR D: DROP" },
    { "SLIDE A LINE", "A GRAB, MOVE, A", "MOVES ARE LIFE" },
    { "GET THE PROF DOWN", "A/B TURN", "MIND THE SPIKES" },
    { "3 IN A ROW ANY WAY", "A/B CYCLE JEWELS", "UP OR D: DROP" },
    { "A/B SWAP PANELS", "HOLD C/D: RAISE", "CHAINS ATTACK" },
    { "L/R AIM  A FIRE", "B FINE  C SWAP", "DROPS ATTACK" },
    { "A GRAB  B THROW", "3 UP IN A COLUMN", "CHAINS + COMBOS" },
    { "HEADS EAT FOOD", "A/B TURN  D DROP", "COINS CLEAR A KIND" },
    { "CLEAR THE LETTERS", "C/D FIRE: 1P/2P", "SELECT: THROW" },
    { "CRYSTALS = STARS", "C CASTS A POWER", "SAVE UP = STRONGER" }
};

static BYTE resolve_pick(BYTE p, BYTE forCpu)
{
    BYTE k;
    if (p != RANDOM_PICK) return p;
    do { k = rnd_n(TK_COUNT); } while (forCpu && trk_cpu_weak(k));
    return k;
}

static void music_for_mode(void)
{
    game_music(mode == M_SURV ? 6 : mode == M_SIDE ? 3 : 5);
}

/* ---------------------------------------------------------------- matches */
static BYTE is_race(void) { return (BYTE)((mode == M_CPU || mode == M_VS) && kind[0] == TK_CLIMB && kind[1] == TK_CLIMB); }
static BYTE send_on(void) { return (BYTE)(mode != M_SIDE && !is_race()); }

static void make_track(int i, DWORD seed)
{
    trk[i].opp = &trk[i ^ 1];
    trk_init(&trk[i], kind[i], (BYTE)i, human[i] ? bot[i] : level[i], seed ? seed : fresh_seed(), send_on(), is_race());
    pad_feed(&cpad[i], 0, 16);
}

static void start_round(void)
{
    DWORD seed = fresh_seed();
    int i;
    for (i = 0; i < 2; i++) if (active[i]) make_track(i, is_race() ? seed : 0); else trk[i].dead = 1;
    phase = PH_COUNT; phaseT = 2000; lastCount = 0xff;
}

static void start_match(void)
{
    int i;
    for (i = 0; i < 2; i++) { wins[i] = 0; active[i] = 1; }
    human[0] = 1; level[0] = 0;
    if (mode == M_VS || mode == M_SIDE) { human[1] = 1; level[1] = 0; }
    else { human[1] = 0; level[1] = mode == M_SURV ? 1 : cpuLevel; }
    kind[0] = resolve_pick(pick[0], 0);
    kind[1] = resolve_pick(mode == M_SURV ? RANDOM_PICK : pick[1], (BYTE)!human[1]);
    if (mode == M_SIDE && !joined[1]) active[1] = 0;
    kos = 0; round_ = 1; menu = MN_NONE; swapPending = 0;
    screen = SC_MATCH;
    music_for_mode();
    start_round();
}

static void next_survivor(void)
{
    kind[1] = resolve_pick(RANDOM_PICK, 1);
    level[1] = (BYTE)(kos + 1 > 8 ? 8 : kos + 1);
    make_track(1, 0);
}

static void trk_take_cpu(Track *t, BYTE lv)
{
    BYTE *p = 0; WORD n = 0, k;
    t->cpu = lv;
    switch (t->kind) {
    case TK_CALM:  p = (BYTE *)&t->u.c.cpu; n = sizeof(t->u.c.cpu); break;
    case TK_JEWEL: p = (BYTE *)&t->u.j.cpu; n = sizeof(t->u.j.cpu); break;
    case TK_SWAP:  p = (BYTE *)&t->u.s.cpu; n = sizeof(t->u.s.cpu); break;
    case TK_POP:   p = (BYTE *)&t->u.p.cpu; n = sizeof(t->u.p.cpu); break;
    case TK_GRAB:  p = (BYTE *)&t->u.g.cpu; n = sizeof(t->u.g.cpu); break;
    case TK_NOM:   p = (BYTE *)&t->u.n.cpu; n = sizeof(t->u.n.cpu); break;
    default: if (lv) brick_cpu_take(t, lv); return;
    }
    for (k = 0; k < n; k++) p[k] = 0;
    if (!lv) return;
    switch (t->kind) {
    case TK_CALM:  t->u.c.cpu.level = lv; break;
    case TK_JEWEL: t->u.j.cpu.level = lv; break;
    case TK_SWAP:  t->u.s.cpu.level = lv; break;
    case TK_POP:   t->u.p.cpu.level = lv; break;
    case TK_GRAB:  t->u.g.cpu.level = lv; break;
    case TK_NOM:   t->u.n.cpu.level = lv; t->u.n.cpu.cand = 0xff; break;
    }
}

/* Swap Fields: each player takes over the other's game, board and all */
static void swap_games(void)
{
    Track tmp;
    BYTE k;
    if (trk[0].dead || trk[1].dead) return;
    tmp = trk[0]; trk[0] = trk[1]; trk[1] = tmp;
    trk[0].side = 0; trk[1].side = 1;
    trk[0].opp = &trk[1]; trk[1].opp = &trk[0];
    trk_take_cpu(&trk[0], human[0] ? bot[0] : level[0]);
    trk_take_cpu(&trk[1], human[1] ? bot[1] : level[1]);
    k = kind[0]; kind[0] = kind[1]; kind[1] = k;
    pad_feed(&cpad[0], 0, 16); pad_feed(&cpad[1], 0, 16);
    trk_say(&trk[0], "SWAPPED!", PAL_YELLOW); trk_say(&trk[1], "SWAPPED!", PAL_YELLOW);
    sfx0(S_BIG);
}

/* units and weapons fired this frame go to the other board */
static void link(void)
{
    int i;
    for (i = 0; i < 2; i++) {
        Track *t = &trk[i], *o = &trk[i ^ 1];
        BYTE k;
        if (t->outUnits && send_on() && phase == PH_PLAY && active[i ^ 1] && !o->dead) trk_receive(o, t->outUnits);
        t->outUnits = 0;
        for (k = 0; k < t->noutW; k++) {
            if (!send_on() || phase != PH_PLAY || !active[i ^ 1] || o->dead) continue;
            if (t->outW[k] == W_SWAP) swapPending = 1; else trk_apply_weapon(o, t->outW[k], t);
        }
        t->noutW = 0;
    }
}

static void open_menu(BYTE m, BYTE by) { menu = m; menuSel = 0; menuBy = by; sfx0(S_OK); }

static Pad *pad_of(int i) { return human[i] && !bot[i] ? &hp[i] : &cpad[i]; }

/* ---------------------------------------------------------------- screens */
static void go_title(void)
{
    if (demo) { demo = 0; bot[0] = 0; }
    screen = SC_TITLE; menu = MN_NONE; idleMs = 0; drawKey = 0xffff; game_music(2);
}

/* attract mode: after a while on the title, two CPUs play a round */
static void start_demo(void)
{
    BYTE keepPick0 = pick[0], keepPick1 = pick[1];
    demo = 1; mode = M_CPU; demoMs = 0;
    bot[0] = (BYTE)(3 + rnd_n(4));
    /* every puzzle gets its turn: pairs 0-1, 2-3, ... then shifted */
    pick[0] = (BYTE)((demoNo * 2 + demoNo / 5) % TK_COUNT);
    pick[1] = (BYTE)((demoNo * 2 + 1 + demoNo / 5) % TK_COUNT);
    demoNo++;
    start_match();
    pick[0] = keepPick0; pick[1] = keepPick1;
    level[1] = (BYTE)(3 + rnd_n(4));
    make_track(1, 0);
}

static void go_select(void)
{
    int i, k;
    screen = SC_SELECT; menu = MN_NONE; drawKey = 0xffff;
    for (i = 0; i < 2; i++) {
        for (k = 0; k < NLIST; k++) if ((k == TK_COUNT ? RANDOM_PICK : k) == pick[i]) selCur[i] = (BYTE)k;
        ready[i] = 0;
    }
    joined[0] = 1; joined[1] = (BYTE)(mode != M_SIDE);
    selFor = 0;
}

static BYTE any_pressed(WORD b) { return (BYTE)(PAD_PRESSED(&hp[0], b) || PAD_PRESSED(&hp[1], b)); }
static BYTE any_repeat(WORD b) { return (BYTE)(pad_repeat(&hp[0], b, 250, 120) || pad_repeat(&hp[1], b, 250, 120)); }

static void title_frame(WORD dt)
{
    int i;
    if (hp[0].cur | hp[1].cur) idleMs = 0;
    else if ((idleMs += dt) > 20000UL) { start_demo(); return; }
    if (any_repeat(B_UP)) { titleSel = (BYTE)((titleSel + 3) & 3); sfx0(S_MENU); }
    if (any_repeat(B_DOWN)) { titleSel = (BYTE)((titleSel + 1) & 3); sfx0(S_MENU); }
    if (titleSel == M_CPU) {
        if (any_repeat(B_RIGHT) && cpuLevel < 8) { cpuLevel++; sfx0(S_MENU); }
        if (any_repeat(B_LEFT) && cpuLevel > 1) { cpuLevel--; sfx0(S_MENU); }
    }
    if (any_pressed(B_A) || any_pressed(B_START)) { mode = titleSel; sfx0(S_OK); go_select(); return; }
    {
        WORD key = (WORD)(0x1000 | titleSel | (cpuLevel << 4));
        if (key == drawKey) return;
        drawKey = key;
    }
    xm_flush = 3;
    cv_clear(0, 0, SCR_W, SCR_H);
    cv_textc(0, 40, 4, PAL_PINK, "C R O S S M I X");
    cv_textc(0, 40, 6, PAL_CYAN, "PUZZLE ARCADE");
    cv_textc(0, 40, 7, PAL_STEEL, "TEN PUZZLES. ONE FIGHT.");
    for (i = 0; i < 4; i++) {
        BYTE on = (BYTE)(i == titleSel);
        if (on) cv_put(12, 11 + i * 2, TW(PAL_YELLOW, TB3(T_ARROW)));
        cv_text(14, 11 + i * 2, on ? PAL_YELLOW : PAL_WHITE, MODE_NAME[i]);
    }
    cv_text(14, 19, PAL_GREY, "CPU LEVEL");
    cv_put(24, 19, TW(PAL_STEEL, TB3('<')));
    cv_text(26, 19, PAL_AMBER, cv_num(cpuLevel));
    cv_put(28, 19, TW(PAL_STEEL, TB3('>')));
    cv_textc(0, 40, 22, PAL_BEIGE, MODE_DESC[titleSel]);
    cv_textc(0, 40, 25, PAL_STEEL, "A OR START: OK   LEFT/RIGHT: CPU LEVEL");
    cv_textc(0, 40, 27, PAL_GREY, "NEO GEO CD V0.9");
}

static void draw_select_side(int i, int ox)
{
    int k;
    BYTE p = selCur[i];
    BYTE kk;
    const char *who;
    if (!joined[i]) {
        cv_textc(ox, 20, 10, PAL_GREY, "PRESS A TO JOIN");
        return;
    }
    who = (mode == M_CPU && i == 1) ? "CPU" : i ? "2P" : "1P";
    cv_textc(ox, 20, 1, i ? PAL_CYAN : PAL_PINK, who);
    if ((mode == M_CPU && selFor == 1 && i == 0) || (mode == M_SURV && i == 1)) return;
    for (k = 0; k < NLIST; k++) {
        BYTE on = (BYTE)(k == p);
        const char *nm = k == TK_COUNT ? "RANDOM" : trk_name((BYTE)k);
        BYTE col = k == TK_COUNT ? PAL_WHITE : trk_color((BYTE)k);
        if (on) cv_put(ox + 1, 3 + k, TW(ready[i] ? PAL_GREEN : PAL_YELLOW, TB3(T_ARROW)));
        cv_text(ox + 3, 3 + k, on ? col : PAL_STEEL, nm);
    }
    kk = p;
    if (kk < TK_COUNT) for (k = 0; k < 3; k++) cv_textc(ox, 20, 16 + k * 2, PAL_BEIGE, HELP[kk][k]);
    else cv_textc(ox, 20, 18, PAL_BEIGE, "A NEW ONE EVERY ROUND");
    if (ready[i]) cv_textc(ox, 20, 23, PAL_GREEN, "READY!");
}

static void select_frame(void)
{
    int i, d;
    BYTE single = (BYTE)(mode == M_CPU || mode == M_SURV);
    if (single) {
        Pad *pp = &hp[0];
        BYTE *cur = &selCur[selFor];
        d = (pad_repeat(pp, B_DOWN, 250, 110) ? 1 : 0) - (pad_repeat(pp, B_UP, 250, 110) ? 1 : 0);
        if (d) { *cur = (BYTE)((*cur + NLIST + d) % NLIST); sfx0(S_MENU); }
        if (PAD_PRESSED(pp, B_A) || PAD_PRESSED(pp, B_START)) {
            pick[selFor] = *cur == TK_COUNT ? RANDOM_PICK : *cur;
            sfx0(S_OK);
            if (mode == M_CPU && selFor == 0) { selFor = 1; }
            else { start_match(); return; }
        }
        if (PAD_PRESSED(pp, B_B) || PAD_PRESSED(pp, B_SELECT)) {
            sfx0(S_BACK);
            if (selFor) selFor = 0; else { go_title(); return; }
        }
    } else {
        for (i = 0; i < 2; i++) {
            Pad *pp = &hp[i];
            if (!joined[i]) { if (PAD_PRESSED(pp, B_A) || PAD_PRESSED(pp, B_START)) { joined[i] = 1; sfx0(S_OK); } continue; }
            if (!ready[i]) {
                d = (pad_repeat(pp, B_DOWN, 250, 110) ? 1 : 0) - (pad_repeat(pp, B_UP, 250, 110) ? 1 : 0);
                if (d) { selCur[i] = (BYTE)((selCur[i] + NLIST + d) % NLIST); sfx0(S_MENU); }
                if (PAD_PRESSED(pp, B_A) || PAD_PRESSED(pp, B_START)) { ready[i] = 1; pick[i] = selCur[i] == TK_COUNT ? RANDOM_PICK : selCur[i]; sfx0(S_OK); }
                if (PAD_PRESSED(pp, B_B) || PAD_PRESSED(pp, B_SELECT)) { sfx0(S_BACK); go_title(); return; }
            } else if (PAD_PRESSED(pp, B_B)) { ready[i] = 0; sfx0(S_BACK); }
        }
        if (ready[0] && (ready[1] || (mode == M_SIDE && !joined[1]))) { start_match(); return; }
        if (mode == M_SIDE && ready[0] && !joined[1] && PAD_PRESSED(&hp[0], B_START)) { start_match(); return; }
    }
    {
        WORD key = (WORD)(0x2000 | selCur[0] | (selCur[1] << 4) | (ready[0] << 8) | (ready[1] << 9) | (joined[1] << 10) | (selFor << 11));
        if (key == drawKey) return;
        drawKey = key;
    }
    xm_flush = 3;
    cv_clear(0, 0, SCR_W, SCR_H);
    cv_textc(0, 40, 0, PAL_WHITE, "PICK YOUR PUZZLE");
    draw_select_side(0, 0);
    if (mode == M_CPU && selFor == 1) {
        int k;
        cv_textc(20, 20, 1, PAL_CYAN, "CPU");
        for (k = 0; k < NLIST; k++) {
            BYTE on = (BYTE)(k == selCur[1]);
            if (on) cv_put(21, 3 + k, TW(PAL_YELLOW, TB3(T_ARROW)));
            cv_text(23, 3 + k, on ? (k == TK_COUNT ? PAL_WHITE : trk_color((BYTE)k)) : PAL_STEEL, k == TK_COUNT ? "RANDOM" : trk_name((BYTE)k));
        }
        if (selCur[1] < TK_COUNT) for (k = 0; k < 3; k++) cv_textc(20, 20, 16 + k * 2, PAL_BEIGE, HELP[selCur[1]][k]);
        cv_textc(0, 20, 10, PAL_PINK, pick[0] == RANDOM_PICK ? "RANDOM" : trk_name(pick[0]));
        cv_textc(0, 20, 12, PAL_GREY, "PICK THE CPU'S");
    } else if (mode == M_SURV) {
        cv_textc(20, 20, 8, PAL_CYAN, "CPU AFTER CPU");
        cv_textc(20, 20, 10, PAL_GREY, "EACH ON A RANDOM");
        cv_textc(20, 20, 11, PAL_GREY, "PUZZLE, ONE LEVEL");
        cv_textc(20, 20, 12, PAL_GREY, "TOUGHER");
    } else if (mode == M_CPU) {
        cv_textc(20, 20, 10, PAL_GREY, "CPU LEVEL");
        cv_textc(20, 20, 11, PAL_AMBER, cv_num(cpuLevel));
    } else draw_select_side(1, 20);
    cv_textc(0, 40, 27, PAL_STEEL, "A: PICK   B: BACK");
}

/* ---------------------------------------------------------------- match */
static const char *const MENU_PAUSE[4] = { "RESUME", "RETRY", "PUZZLE SELECT", "QUIT" };

static void menu_choose(BYTE item)
{
    sfx0(S_OK);
    if (item == 0) { menu = MN_NONE; return; }
    if (item == 1) { start_match(); return; }
    if (item == 2) { go_select(); return; }
    go_title();
}

static void update_menu(void)
{
    BYTE n = menu == MN_PAUSE ? 4 : 3, first = menu == MN_PAUSE ? 0 : 1;
    if (any_repeat(B_UP)) { menuSel = (BYTE)((menuSel + n - 1) % n); sfx0(S_MENU); }
    if (any_repeat(B_DOWN)) { menuSel = (BYTE)((menuSel + 1) % n); sfx0(S_MENU); }
    if (any_pressed(B_A) || (menu == MN_OVER && any_pressed(B_START))) { menu_choose((BYTE)(menuSel + first)); return; }
    if (menu == MN_PAUSE && (any_pressed(B_START) || any_pressed(B_B))) { menu = MN_NONE; sfx0(S_BACK); }
}

static void match_update(WORD dt)
{
    int i;
    Track *a = &trk[0], *b = &trk[1];
    if (menu) { update_menu(); return; }
    for (i = 0; i < 2; i++) {
        if (human[i] && PAD_PRESSED(&hp[i], B_START) && phase != PH_OVER) {
            if (mode == M_SIDE && !active[i]) {
                active[i] = 1; kind[i] = resolve_pick(RANDOM_PICK, 0); make_track(i, 0); sfx0(S_OK);
                return;
            }
            if (active[i]) { open_menu(MN_PAUSE, (BYTE)i); return; }
        }
    }
    if (phase == PH_COUNT) {
        BYTE n;
        phaseT = (SWORD)(phaseT - dt);
        n = (BYTE)(phaseT > 0 ? (phaseT + 599) / 600 : 0);
        if (n != lastCount) { lastCount = n; sfx0(n > 0 && n <= 3 ? S_COUNT3 : S_GO); }
        if (phaseT <= 0) phase = PH_PLAY;
        return;
    }
    if (phase == PH_ROUNDEND) {
        phaseT = (SWORD)(phaseT - dt);
        if (phaseT <= 0) {
            if (roundWinner < 2 && wins[roundWinner] >= 2) { phase = PH_OVER; open_menu(MN_OVER, 0); sfx0(S_WIN); }
            else { round_++; start_round(); }
        }
        return;
    }
    if (phase == PH_OVER) return;
    if (phase == PH_SWAP) {
        xm_think = 1;
        trk_update(a, pad_of(0), dt);
        link();
        if (a->dead) { phase = PH_OVER; open_menu(MN_OVER, 0); return; }
        phaseT = (SWORD)(phaseT - dt);
        if (!swapped && phaseT <= 1500) { swapped = 1; kos++; next_survivor(); sfx0(S_OK); }
        if (phaseT <= 0) phase = PH_PLAY;
        return;
    }
    /* play */
    for (i = 0; i < 2; i++) { if (active[i]) { xm_think = (BYTE)(((fcount + i) & 1) || !active[i ^ 1]); trk_update(&trk[i], pad_of(i), dt); } game_mark((BYTE)i); }
    xm_think = 1;
    link();
    if (swapPending) { swapPending = 0; swap_games(); }
    if (mode == M_SIDE) {
        for (i = 0; i < 2; i++) if (active[i] && trk[i].dead && human[i] && PAD_PRESSED(&hp[i], B_A)) { make_track(i, 0); sfx0(S_OK); }
        return;
    }
    if (mode == M_SURV) {
        if (a->dead) { phase = PH_OVER; open_menu(MN_OVER, 0); return; }
        if (b->dead) { phase = PH_SWAP; phaseT = 2800; swapped = 0; sfx0(S_WIN); }
        return;
    }
    if (a->raceWon || b->raceWon) {
        roundWinner = (BYTE)(a->raceWon && b->raceWon ? 2 : a->raceWon ? 0 : 1);
        if (roundWinner < 2) wins[roundWinner]++;
        phase = PH_ROUNDEND; phaseT = 2800;
        return;
    }
    if (a->dead || b->dead) {
        roundWinner = (BYTE)(a->dead && b->dead ? 2 : a->dead ? 1 : 0);
        if (roundWinner < 2) wins[roundWinner]++;
        phase = PH_ROUNDEND; phaseT = 2200;
    }
}

static void draw_header(void)
{
    int i, k;
    cv_clear(0, 0, SCR_W, 1);
    for (i = 0; i < 2; i++) {
        int ox = i * 20;
        if (!active[i]) continue;
        cv_text(ox + 1, 0, trk_color(kind[i]), trk_name(kind[i]));
        if (mode == M_CPU || mode == M_VS) for (k = 0; k < 2; k++) cv_put(ox + 18 + k, 0, TW(k < wins[i] ? PAL_YELLOW : PAL_STEEL, TB3(k < wins[i] ? T_STAR : T_STAR_OFF)));
        if (!human[i] || bot[i]) { cv_text(ox + 15, 0, PAL_GREY, "LV"); cv_text(ox + 17, 0, PAL_GREY, cv_num(human[i] ? bot[i] : level[i])); }
    }
    if (mode == M_SURV) { cv_text(17, 0, PAL_AMBER, "KO"); cv_text(19, 0, PAL_AMBER, cv_num(kos)); }
    if (demo) cv_clear(13, 0, 14, 1);
    if (demo) cv_textc(14, 12, 0, (fcount >> 5) & 1 ? PAL_WHITE : PAL_YELLOW, (fcount >> 5) & 1 ? "PRESS START" : "DEMO PLAY");
}

static void box(int x, int y, int w, int h)
{
    cv_fill(x, y, w, h, TW(PAL_STEEL, TB3(T_BLACK)));
    cv_frame(x, y, w, h, PAL_STEEL);
}

static void draw_overlays(void)
{
    int i;
    if (phase == PH_COUNT) {
        BYTE n = (BYTE)(phaseT > 0 ? (phaseT + 599) / 600 : 0);
        const char *s = n >= 3 ? "3" : n == 2 ? "2" : n == 1 ? "1" : "GO!";
        for (i = 0; i < 2; i++) if (active[i]) { box(i * 20 + 7, 11, 6, 3); cv_textc(i * 20 + 7, 6, 12, n ? PAL_WHITE : PAL_GREEN, s); }
        if (round_ > 1 || mode == M_CPU || mode == M_VS) { box(15, 6, 10, 1); cv_textc(15, 10, 6, PAL_AMBER, round_ == 3 ? "FINAL" : round_ == 2 ? "ROUND 2" : "ROUND 1"); }
    }
    if (phase == PH_ROUNDEND || phase == PH_OVER) {
        for (i = 0; i < 2; i++) {
            const char *s = roundWinner == 2 ? "DRAW" : roundWinner == i ? "WIN!" : "LOSE";
            if (mode == M_SURV) s = i == 0 ? "K.O." : "";
            if (!*s) continue;
            box(i * 20 + 6, 11, 8, 1);
            cv_textc(i * 20 + 6, 8, 11, roundWinner == i ? PAL_YELLOW : PAL_GREY, s);
        }
    }
    if (phase == PH_SWAP) {
        box(13, 11, 14, 2);
        cv_textc(13, 14, 11, PAL_YELLOW, swapped ? "NEXT CHALLENGER" : "K.O.!");
        if (swapped) cv_textc(13, 14, 12, PAL_WHITE, phaseT > 1000 ? "3" : phaseT > 500 ? "2" : "1");
    }
    if (menu) {
        BYTE n = menu == MN_PAUSE ? 4 : 3, first = menu == MN_PAUSE ? 0 : 1, k;
        const char *title = "PAUSED";
        if (menu == MN_OVER) {
            if (mode == M_SURV) title = "GAME OVER";
            else if (mode == M_CPU) title = wins[0] >= 2 ? "YOU WIN!" : "CPU WINS";
            else title = wins[0] >= 2 ? "1P WINS!" : "2P WINS!";
        }
        box(12, 9, 16, 9);
        cv_textc(12, 16, 9, PAL_YELLOW, title);
        if (menu == MN_OVER && mode == M_SURV) { cv_text(15, 10, PAL_GREY, "KOS"); cv_text(19, 10, PAL_AMBER, cv_num(kos)); }
        for (k = 0; k < n; k++) {
            BYTE on = (BYTE)(k == menuSel);
            if (on) cv_put(13, 12 + k * 2, TW(PAL_YELLOW, TB3(T_ARROW)));
            cv_text(15, 12 + k * 2, on ? PAL_YELLOW : PAL_WHITE, MENU_PAUSE[k + first]);
        }
    }
}

static void match_draw(void)
{
    int i = fcount & 1;
    /* each half is redrawn every other frame (30 Hz), the 68000 has two boards to run */
    cv_clear(i * 20, 1, 20, SCR_H - 1);
    /* overlays reach into both halves: then both are sent */
    xm_flush = (BYTE)((menu || phase != PH_PLAY) ? 3 : 1 << i);
    if (active[i]) trk_draw(&trk[i], i * 20);
    else if (mode == M_SIDE) { cv_textc(i * 20, 20, 12, PAL_GREY, "PRESS START"); cv_textc(i * 20, 20, 13, PAL_GREY, "TO JOIN"); }
    if (mode == M_SIDE && active[i] && trk[i].dead && human[i]) cv_textc(i * 20, 20, 12, PAL_WHITE, "A: AGAIN");
    draw_header();
    draw_overlays();
}

/* ---------------------------------------------------------------- entry points */
void game_init(void)
{
    cv_clear(0, 0, SCR_W, SCR_H);
    trk[0].opp = &trk[1]; trk[1].opp = &trk[0];
    go_title();
}

void game_frame(WORD in1, WORD in2, WORD dt)
{
    fcount++;
    seedMix += in1 + ((DWORD)in2 << 10);
    pad_feed(&hp[0], in1, dt);
    pad_feed(&hp[1], in2, dt);
    xm_status = (WORD)((screen << 12) | (kind[1] << 4) | kind[0]);
    switch (screen) {
    case SC_TITLE:  title_frame(dt); break;
    case SC_SELECT: select_frame(); break;
    default:
        if (demo) {
            /* any button ends the demo; so does the end of its round */
            demoMs += dt;
            if (((hp[0].cur & ~hp[0].prev) | (hp[1].cur & ~hp[1].prev)) || phase == PH_ROUNDEND || phase == PH_OVER || demoMs > 30000UL) { go_title(); break; }
            menu = MN_NONE;
        }
        match_update(dt);
        if (screen == SC_MATCH) { match_draw(); game_mark(2); }
        break;
    }
}

/* for the PC harness */
void game_set_bot(int i, BYTE lv) { bot[i] = lv; }
BYTE game_screen(void) { return screen; }
Track *game_track(int i) { return &trk[i]; }
BYTE game_phase(void) { return phase; }
BYTE game_wins(int i) { return wins[i]; }
BYTE game_kos(void) { return kos; }
