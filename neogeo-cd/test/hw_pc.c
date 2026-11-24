/*
 * PC harness for the Neo Geo CD game code.
 *
 *   build-pc/xm sim [games] [levelA] [levelB] [only]
 *       CPU vs CPU on every pairing of puzzles (or only pairings with puzzle `only`, 0-9):
 *       win counts, average length, units sent per minute.  Fails on a hang.
 *   build-pc/xm script FILE OUTDIR
 *       Runs the real game (game.c) frame by frame from a script and dumps
 *       screens; test/render.py turns them into PNGs.
 *
 * Script: wait N | p1 KEY | p2 KEY | hold P KEY N | bot P LEVEL | dump NAME | end
 * KEY: U D L R A B C D START SELECT
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "xm.h"
#include "game.h"

static int nsfx;
void game_sfx(BYTE side, BYTE id) { (void)side; (void)id; nsfx++; }
void game_music(BYTE track) { (void)track; }
void game_mark(BYTE k) { (void)k; }

/* ---------------------------------------------------------------- sim */
static Track A, Bt;
static Pad pa, pb;

static void xfer(Track *t, Track *o)
{
    BYTE k;
    if (t->outUnits && !o->dead) trk_receive(o, t->outUnits);
    t->outUnits = 0;
    for (k = 0; k < t->noutW; k++) if (t->outW[k] != W_SWAP && !o->dead) trk_apply_weapon(o, t->outW[k], t);
    t->noutW = 0;
}

static int play(BYTE ka, BYTE kb, DWORD seed, BYTE la, BYTE lb, DWORD *ms, WORD *sa, WORD *sb)
{
    DWORD t = 0;
    WORD dt;
    A.opp = &Bt; Bt.opp = &A;
    trk_init(&A, ka, 0, la, seed, 1, 0);
    trk_init(&Bt, kb, 1, lb, seed * 7 + 1, 1, 0);
    memset(&pa, 0, sizeof pa); memset(&pb, 0, sizeof pb);
    while (!A.dead && !Bt.dead && t < 600000UL) {
        dt = (WORD)((t / 17) % 3 == 2 ? 16 : 17);
        xm_think = (BYTE)((t / 17) & 1);
        trk_update(&A, &pa, dt);
        xm_think = (BYTE)(((t / 17) + 1) & 1);
        trk_update(&Bt, &pb, dt);
        xfer(&A, &Bt); xfer(&Bt, &A);
        /* drawing runs too, to catch out-of-range writes */
        if (((t / 17) & 15) == 0) { trk_draw(&A, 0); trk_draw(&Bt, 20); }
        t += dt;
    }
    *ms = t; *sa = A.sent; *sb = Bt.sent;
    return A.dead && Bt.dead ? -1 : A.dead ? 1 : Bt.dead ? 0 : -2;
}

static int sim(int games, int la, int lb, int only)
{
    int a, b, g, w[2], d, bad = 0;
    for (a = 0; a < TK_COUNT; a++) for (b = 0; b < TK_COUNT; b++) {
        DWORD time = 0, ms; long sa = 0, sb = 0; WORD xa, xb;
        if (only >= 0 && a != only && b != only) continue;
        w[0] = w[1] = 0; d = 0;
        for (g = 0; g < games; g++) {
            int r = play((BYTE)a, (BYTE)b, 1000UL + g * 77UL, (BYTE)la, (BYTE)lb, &ms, &xa, &xb);
            if (r >= 0) w[r]++; else d++;
            time += ms; sa += xa; sb += xb;
        }
        printf("%-13s vs %-13s %d-%d%s  avg %3lus  sent/min %.1f vs %.1f\n", trk_name((BYTE)a), trk_name((BYTE)b), w[0], w[1],
               d ? " (draw/timeout)" : "", (unsigned long)(time / games / 1000), sa * 60000.0 / time, sb * 60000.0 / time);
        if (d == games) bad++;
        fflush(stdout);
    }
    return bad ? 1 : 0;
}

/* ---------------------------------------------------------------- script */
static WORD key_bits(const char *k)
{
    WORD b = 0;
    char buf[64], *p;
    strncpy(buf, k, 63); buf[63] = 0;
    for (p = strtok(buf, "+"); p; p = strtok(0, "+")) {
        if (!strcmp(p, "U")) b |= B_UP; else if (!strcmp(p, "D")) b |= B_DOWN;
        else if (!strcmp(p, "L")) b |= B_LEFT; else if (!strcmp(p, "R")) b |= B_RIGHT;
        else if (!strcmp(p, "A")) b |= B_A; else if (!strcmp(p, "B")) b |= B_B;
        else if (!strcmp(p, "C")) b |= B_C; else if (!strcmp(p, "BD")) b |= B_D;
        else if (!strcmp(p, "START")) b |= B_START; else if (!strcmp(p, "SELECT")) b |= B_SELECT;
    }
    return b;
}

static void dump(const char *dir, const char *name)
{
    char path[512];
    FILE *f;
    int y, x;
    sprintf(path, "%s/%s.txt", dir, name);
    f = fopen(path, "w");
    if (!f) { perror(path); exit(2); }
    for (y = 0; y < SCR_H; y++) {
        for (x = 0; x < SCR_W; x++) fprintf(f, "%04x ", scr[y][x]);
        fprintf(f, "\n");
    }
    fclose(f);
}

static WORD fdt(void) { static int n; n++; return (WORD)(n % 3 == 2 ? 16 : 17); }

static int script(const char *file, const char *dir)
{
    FILE *f = fopen(file, "r");
    char line[256], cmd[32], a1[64], a2[64];
    int n, i;
    if (!f) { perror(file); return 2; }
    game_init();
    while (fgets(line, sizeof line, f)) {
        a1[0] = a2[0] = 0; n = 0;
        if (line[0] == '#' || sscanf(line, "%31s", cmd) != 1) continue;
        if (!strcmp(cmd, "wait")) { sscanf(line, "%*s %d", &n); for (i = 0; i < n; i++) game_frame(0, 0, fdt()); }
        else if (!strcmp(cmd, "p1") || !strcmp(cmd, "p2")) {
            WORD b; sscanf(line, "%*s %63s", a1); b = key_bits(a1);
            if (cmd[1] == '1') game_frame(b, 0, fdt()); else game_frame(0, b, fdt());
            game_frame(0, 0, fdt());
        } else if (!strcmp(cmd, "hold")) {
            int p; WORD b; sscanf(line, "%*s %d %63s %d", &p, a1, &n); b = key_bits(a1);
            for (i = 0; i < n; i++) game_frame(p == 1 ? b : 0, p == 2 ? b : 0, fdt());
        } else if (!strcmp(cmd, "bot")) { int p, lv; sscanf(line, "%*s %d %d", &p, &lv); game_set_bot(p - 1, (BYTE)lv); }
        else if (!strcmp(cmd, "dump")) { sscanf(line, "%*s %63s", a1); game_frame(0, 0, fdt()); dump(dir, a1); }
        else if (!strcmp(cmd, "end")) break;
    }
    fclose(f);
    printf("script done, %d sounds\n", nsfx);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && !strcmp(argv[1], "sim"))
        return sim(argc > 2 ? atoi(argv[2]) : 3, argc > 3 ? atoi(argv[3]) : 5, argc > 4 ? atoi(argv[4]) : (argc > 3 ? atoi(argv[3]) : 5), argc > 5 ? atoi(argv[5]) : -1);
    if (argc >= 4 && !strcmp(argv[1], "script")) return script(argv[2], argv[3]);
    fprintf(stderr, "usage: xm sim [games] [levelA] [levelB] [only] | xm script FILE OUTDIR\n");
    return 2;
}
