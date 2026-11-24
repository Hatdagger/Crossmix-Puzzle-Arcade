/* Per-track state (one union member each).  Included by xm.h. */
#ifndef XM_TRACKS_H
#define XM_TRACKS_H

/* ---------------------------------------------------------------- brick family */
#define BR_COLS 10
#define BR_ROWS 22
#define BR_HIDDEN 2
/* grid cells: 0 empty, 1..7 I J L O S T Z, 8 garbage,
   0x10|w Arsenal weapon letter, 0x20|type Power Brick crystal */
#define BC_GARB 8
#define BC_LETTER 0x10
#define BC_CRYSTAL 0x20

typedef struct {
    BYTE hold, preview, ghost, hardDrop, dDrop, fastSoft, srs, bag;
    BYTE lockResets, tspin, b2b, combo, allClear, cancel, garbageDelay;
    WORD softMs;
} BrickSet;

typedef struct {
    BYTE x, y, dir, state, frame;   /* state: 0 walk 1 climb 2 fall 3 win 4 dead */
    WORD t, anim;
} Prof;

typedef struct { BYTE type, rot; SBYTE x, y; } PieceSpot;

typedef struct {
    /* CPU (shared by the brick-family tracks) */
    BYTE level, think, tap, fails, rotNow, haveBest, plan;
    SBYTE xNow;
    SBYTE bestX; BYTE bestRot;
    SBYTE best2X; BYTE best2Rot;
    SDWORD bestSc, best2Sc;
    WORD seen, wait, since, step, mistake;
} BrickCpu;

typedef struct {
    const BrickSet *s;
    BYTE grid[BR_ROWS][BR_COLS];
    BYTE queue[8], qn, bag[7], bagn;
    BYTE holdType, holdUsed;
    WORD lines;
    SBYTE combo;
    BYTE b2bOn;
    DWORD elapsed;
    SDWORD gravT;
    WORD lockT;
    BYTE resets;
    SBYTE dasDir;
    WORD dasT, arrT;
    BYTE lastRot, lastKick, wasSoft;
    WORD clearT;
    DWORD clearRows;                /* bit per row that just cleared (for the flash) */
    WORD pieceId;
    BYTE hasPiece;
    BYTE ptype, prot;
    SBYTE px, py, lowest;
    SBYTE crystal;                  /* Power Brick: which brick of the piece carries a crystal (-1 none) */
    /* Arsenal */
    BYTE inv[8], invn, noUnits;
    WORD cpuT, holdT;
    /* Power Brick */
    BYTE points, shield;
    /* Climb */
    BYTE ceil, stage, placedSince;
    Prof prof;
    BYTE solType[16], soln, solHead;
    PieceSpot solPlan[16];
    SBYTE solIdx;
    WORD crunchT;
    BrickCpu cpu;
} BrickData;

/* ---------------------------------------------------------------- calm */
#define CA_COLS 8
#define CA_ROWS 7
typedef struct {
    BYTE level, tap, n, planning, pcell, ptg;
    WORD wait, count;
    SWORD bestSc;
    BYTE best[4], rnd[4];          /* r, c, axis, target */
    BYTE script[24];
} CalmCpu;
typedef struct {
    BYTE grid[CA_ROWS][CA_COLS];        /* 0..5 colours, 6 stone */
    BYTE dying[CA_ROWS][CA_COLS];
    BYTE pop[CA_ROWS][CA_COLS];         /* frames left of the "new" flash */
    SWORD moves;
    DWORD score, elapsed;
    BYTE cr, cc;                         /* cursor */
    BYTE dragOn, dr, dc, daxis, dt_;     /* daxis 0 none, 1 h, 2 v; dt_ = target */
    BYTE pvCount, pvHit[CA_ROWS][CA_COLS];
    BYTE state;                          /* 0 idle 1 wait 2 clear 3 fall 4 over */
    SWORD phaseT;
    DWORD idleT;
    WORD atkFrac, bad;
    BYTE chain, gain, attack, lever;
    CalmCpu cpu;
} CalmData;

/* ---------------------------------------------------------------- jewel */
#define JW_COLS 6
#define JW_ROWS 12
typedef struct {
    BYTE level, tap, rot, c, have, pass, cand;
    SDWORD bestSc; BYTE bestC, bestRot;
    SDWORD sc[18];
    WORD wait, seen;
} JewelCpu;
typedef struct {
    SBYTE grid[JW_ROWS][JW_COLS];        /* -1 empty, 0..5 jewels, 9 rock */
    BYTE hits[JW_ROWS][JW_COLS];
    BYTE hasPiece, pc, gems[3], next[3];
    SBYTE pr;
    BYTE state;                          /* 0 fall 1 flash 2 settle 3 over */
    SWORD phaseT;
    WORD fallT, lockT, dasT;
    SBYTE dasDir;
    DWORD score, elapsed;
    WORD jewels;
    BYTE chain, attack, overflow;
    WORD atkFrac, pieceNo;
    JewelCpu cpu;
} JewelData;

/* ---------------------------------------------------------------- swap */
#define SW_COLS 6
#define SW_VIS 12
#define SW_HID 4
#define SW_ROWS 16
#define SW_MAXSLAB 8
#define SW_MAXGRP 8
typedef struct { SBYTE r; BYTE c, w, h, alive; } Slab;
typedef struct { SWORD t; BYTE alive, n; BYTE slabs; } Grp;   /* slabs: bit per slab */
typedef struct {
    BYTE level, tap, n, planning, prow, pcol, nbest, pdir;
    SBYTE pto;
    WORD wait, hold;
    SBYTE snap[SW_ROWS][SW_COLS];
    SWORD bsc[4];
    BYTE bmv[4][3];                /* r, c, to */
    BYTE script[24];
} SwapCpu;
typedef struct {
    SBYTE k[SW_ROWS][SW_COLS];           /* -1 empty, 0..4 panel, -2 slab */
    BYTE st[SW_ROWS][SW_COLS];           /* 0 idle 1 hang 2 fall 3 clear */
    SWORD tm[SW_ROWS][SW_COLS];
    BYTE chainf[SW_ROWS][SW_COLS];
    BYTE slabOf[SW_ROWS][SW_COLS];
    BYTE grpOf[SW_ROWS][SW_COLS];
    BYTE mv[SW_ROWS][SW_COLS];
    Slab slab[SW_MAXSLAB];
    Grp grp[SW_MAXGRP];
    BYTE cr, cc;
    WORD rise;                           /* Q8 pixels (one row = 16 px) */
    SWORD stopT, panicT;
    BYTE chain, maxChain, raising, carry, tick, dirty;
    DWORD score, elapsed;
    WORD atkFrac, gAcc;
    SBYTE preview[SW_COLS];
    SwapCpu cpu;
} SwapData;

/* ---------------------------------------------------------------- pop */
#define PO_COLS 8
#define PO_MAXR 16
#define PO_DEAD 11
typedef struct {
    BYTE level, every, phase, nt, haveSwap, planSwap;
    WORD tk, planTk, bestSwapTk;
    SDWORD bestSwapSc;
    SDWORD tsc[4];
    WORD ttk[4];
    WORD wait;
} PopCpu;
typedef struct {
    SBYTE grid[PO_MAXR][PO_COLS];        /* -1 empty, 0..5 colours, 9 grey */
    BYTE mark[PO_MAXR][PO_COLS];         /* 1 popped, 2 grey broken */
    BYTE drop, shotsLeft, unitsTaken, cur, next, state;   /* state 0 aim 1 fly 2 pop 3 over */
    WORD shots, tick, aimT, popT, shake;
    SBYTE aimDir;
    DWORD idle, elapsed, score;
    WORD dropped, clears, atkFrac;
    SDWORD sx, sy, svx, svy;             /* shot, Q8 pixels */
    BYTE sk;
    WORD dist;                           /* Q8 */
    BYTE npop, ngrey;
    BYTE dotN, dotX[48], dotY[48];
    WORD dotTick, dotShots;
    BYTE dotDrop, dotValid;
    PopCpu cpu;
} PopData;

/* ---------------------------------------------------------------- grab */
#define GR_COLS 7
#define GR_ROWS 11
typedef struct {
    BYTE level, tap, have, n, two;
    BYTE c1, c2, c3;
    SDWORD bestSc;
    BYTE best[3], bestN;
    BYTE plan[3], planN, planT;          /* planT bit i = throw */
    BYTE bestT;
    WORD wait;
} GrabCpu;
typedef struct {
    SBYTE grid[GR_ROWS][GR_COLS];
    BYTE hits[GR_ROWS][GR_COLS], rose[GR_ROWS][GR_COLS];
    BYTE pos, hk, hn, state;             /* 0 play 1 flash 2 settle 3 over */
    SWORD phaseT;
    DWORD pushT, elapsed, lastClear, score;
    BYTE combo, chain, clearedNow;
    WORD attackQ8, rowFrac, atkFrac;
    SBYTE dasDir;
    WORD dasT, beam, balls;
    BYTE beamCol;
    GrabCpu cpu;
} GrabData;

/* ---------------------------------------------------------------- nom nom! pets */
#define NM_COLS 6
#define NM_ROWS 12
#define NM_EMPTY 255
#define NM_COIN 99
typedef struct {
    BYTE level, tap, have, c, rot, turns, cand;
    SDWORD bestSc; BYTE bestC, bestRot;
    WORD wait, seen;
} NomCpu;
typedef struct {
    BYTE grid[NM_ROWS][NM_COLS];
    BYTE hits[NM_ROWS][NM_COLS];
    BYTE hasPiece, pc, prot, b[2], next[2];
    SBYTE pr;
    BYTE state;                          /* 0 fall 1 flash 2 settle 3 over */
    SWORD phaseT;
    WORD fallT, lockT, dasT;
    SBYTE dasDir;
    DWORD score, elapsed;
    WORD eaten, attackQ8, atkFrac;
    BYTE chain, eatNow, coinNow, overflow;
    WORD pieceNo;
    NomCpu cpu;
} NomData;

#endif
