/*
 * Crossmix Puzzle Arcade - Neo Geo CD.
 * Shared types: the track interface (mirrors js/track.js), the pad, and
 * the drawing canvas.  Everything here is plain C89 with no hardware, so
 * the PC harness (test/) runs exactly the same game code.
 */
#ifndef XM_H
#define XM_H

/* hw.c gets BYTE/WORD/DWORD from neocore.h and defines XM_HAVE_TYPES */
#ifndef XM_HAVE_TYPES
typedef unsigned char  BYTE;
typedef unsigned short WORD;
#if defined(__LP64__) || defined(_LP64)
typedef unsigned int   DWORD;           /* the PC harness: 32 bits like the 68000 */
#else
typedef unsigned long  DWORD;
#endif
#endif
typedef signed char    SBYTE;
typedef short          SWORD;
#if defined(__LP64__) || defined(_LP64)
typedef int            SDWORD;
#else
typedef long           SDWORD;
#endif

/* ---------------------------------------------------------------- pad */
#define B_UP     0x01
#define B_DOWN   0x02
#define B_LEFT   0x04
#define B_RIGHT  0x08
#define B_A      0x10
#define B_B      0x20
#define B_C      0x40
#define B_D      0x80
#define B_START  0x100
#define B_SELECT 0x200

typedef struct {
    WORD cur, prev;
    WORD held[10];          /* ms each button has been held */
    WORD lastDt;
} Pad;

void pad_feed(Pad *p, WORD bits, WORD dt);
#define PAD_DOWN(p, b)    (((p)->cur & (b)) != 0)
#define PAD_PRESSED(p, b) ((((p)->cur & ~(p)->prev) & (b)) != 0)
BYTE pad_repeat(const Pad *p, WORD b, WORD delay, WORD rate);

/* ---------------------------------------------------------------- tracks */
enum {
    TK_BRICK, TK_CALM, TK_CLIMB, TK_JEWEL, TK_SWAP, TK_POP, TK_GRAB, TK_NOM, TK_ARSENAL, TK_POWER,
    TK_COUNT
};

/* weapons (Arsenal) and powers (Power Brick) */
enum {
    W_NONE, W_WIPE, W_EMPTY, W_ADD, W_REMOVE, W_FAST, W_SLOW, W_GRAVITY, W_FLIP, W_SWAP,
    P_FOG, P_HANDS, P_RUSH, P_SHAKE, P_SHIELD,
    W_COUNT
};

/* sounds the game asks for (mapped to the driver in main.c) */
enum {
    S_MOVE, S_ROTATE, S_LOCK, S_HARD, S_HOLD, S_CLEAR, S_BIG, S_GARBAGE, S_KO, S_BAD,
    S_INCOMING, S_TICK, S_MENU, S_OK, S_BACK, S_COUNT3, S_GO, S_WIN, S_CAST
};

/* palettes (fix layer) */
#define PAL_PINK   2
#define PAL_CYAN   3
#define PAL_YELLOW 4
#define PAL_ORANGE 5
#define PAL_VIOLET 6
#define PAL_LIME   7
#define PAL_RED    8
#define PAL_GREY   9
#define PAL_WHITE  10
#define PAL_AMBER  11
#define PAL_GREEN  12
#define PAL_BEIGE  13
#define PAL_STEEL  14
#define PAL_BLUE   15

#define MAX_PENDING 8
#define MAX_SAY     3
#define MAX_FXQ     6

typedef struct { BYTE n; WORD t; WORD gap; } Batch;
typedef struct { const char *txt; BYTE pal; WORD t; } Say;

/* per-track data lives in t_*.c; the union is sized here */
#include "xm_tracks.h"

typedef struct Track {
    BYTE kind, side, cpu;           /* cpu = level 1-8, 0 = human */
    BYTE dead, vs, race, raceWon;
    DWORD rng;
    Batch pending[MAX_PENDING];
    BYTE npend;
    BYTE cancelOn;
    WORD sent;                      /* units sent (stats) */
    WORD outUnits;                  /* units to send this frame (the match collects them) */
    BYTE outW[4], noutW;            /* weapons fired at the other player this frame */
    Say say[MAX_SAY];
    BYTE fxq[MAX_FXQ], nfxq;
    SWORD flipT, fogT, rushT, handsT;
    SBYTE speedLv;
    WORD speedAcc;
    BYTE bigMark;                   /* set on a big move (stats) */
    struct Track *opp;
    union {
        BrickData b;
        CalmData c;
        JewelData j;
        SwapData s;
        PopData p;
        GrabData g;
        NomData n;
    } u;
} Track;

/* track.c: the shared parts */
void  trk_init(Track *t, BYTE kind, BYTE side, BYTE cpu, DWORD seed, BYTE vs, BYTE race);
void  trk_update(Track *t, Pad *pad, WORD dt);
void  trk_draw(Track *t, int ox);
void  trk_receive(Track *t, WORD n);
void  trk_send(Track *t, WORD n);
void  trk_say(Track *t, const char *txt, BYTE pal);
void  trk_sfx(Track *t, BYTE id);
WORD  trk_rnd(Track *t, WORD n);            /* 0..n-1 */
DWORD trk_rand(Track *t);
WORD  trk_pending_total(const Track *t);
BYTE  trk_take_ready(Track *t, WORD delay, WORD max, Batch *out, BYTE maxOut);
WORD  trk_take_all(Track *t);
void  trk_tick_pending(Track *t, WORD dt);
BYTE  trk_takes(const Track *t, BYTE w, const Track *src);
void  trk_apply_weapon(Track *t, BYTE w, const Track *src);
void  trk_hit(Track *t, BYTE w);
WORD  trk_speed_q8(const Track *t);
BYTE  trk_fx_safe(const Track *t);
const char *trk_name(BYTE kind);
BYTE  trk_cpu_weak(BYTE kind);
BYTE  trk_color(BYTE kind);
extern const char *const WEAPON_NAME[W_COUNT];

/* sound hook (main.c / the PC harness) */
void game_sfx(BYTE side, BYTE id);

/* per-track entry points */
void brick_init(Track *t);   void brick_update(Track *t, Pad *p, WORD dt);   void brick_draw(Track *t, int ox);
void calm_init(Track *t);    void calm_update(Track *t, Pad *p, WORD dt);    void calm_draw(Track *t, int ox);
void jewel_init(Track *t);   void jewel_update(Track *t, Pad *p, WORD dt);   void jewel_draw(Track *t, int ox);
void swap_init(Track *t);    void swap_update(Track *t, Pad *p, WORD dt);    void swap_draw(Track *t, int ox);
void pop_init(Track *t);     void pop_update(Track *t, Pad *p, WORD dt);     void pop_draw(Track *t, int ox);
void grab_init(Track *t);    void grab_update(Track *t, Pad *p, WORD dt);    void grab_draw(Track *t, int ox);
void nom_init(Track *t);     void nom_update(Track *t, Pad *p, WORD dt);     void nom_draw(Track *t, int ox);
void brick_cpu(Track *t, Pad *p, WORD dt);
void calm_cpu(Track *t, Pad *p, WORD dt);
void jewel_cpu(Track *t, Pad *p, WORD dt);
void swap_cpu(Track *t, Pad *p, WORD dt);
void pop_cpu(Track *t, Pad *p, WORD dt);
void grab_cpu(Track *t, Pad *p, WORD dt);
void nom_cpu(Track *t, Pad *p, WORD dt);
/* weapon effects a track may have (0 = not supported) */
BYTE brick_fx(Track *t, BYTE w);
BYTE calm_fx(Track *t, BYTE w);
BYTE jewel_fx(Track *t, BYTE w);
BYTE swap_fx(Track *t, BYTE w);
BYTE pop_fx(Track *t, BYTE w);
BYTE grab_fx(Track *t, BYTE w);
BYTE nom_fx(Track *t, BYTE w);
BYTE brick_safe(const Track *t);
BYTE calm_safe(const Track *t);
BYTE jewel_safe(const Track *t);
BYTE swap_safe(const Track *t);
BYTE pop_safe(const Track *t);
BYTE grab_safe(const Track *t);
BYTE nom_safe(const Track *t);
void brick_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void calm_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void jewel_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void swap_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void pop_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void grab_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
void nom_field(const Track *t, BYTE *x, BYTE *y, BYTE *w, BYTE *h);
/* Arsenal and Power Brick extras (t_brick.c) */
BYTE brick_inv_count(const Track *t);
BYTE power_stars(const Track *t);
void brick_cpu_take(Track *t, BYTE level);   /* Swap Fields: this board gets a CPU */

/* ---------------------------------------------------------------- canvas (draw.c) */
#define SCR_W 40
#define SCR_H 28
extern WORD scr[SCR_H][SCR_W];      /* what the screen should show this frame */
#define TB3(i) ((WORD)(0x300 + (i)))   /* tile i of bank 3 */
#define TB4(i) ((WORD)(0x400 + (i)))   /* tile i of bank 4 */
#define TW(pal, tile) ((WORD)(((WORD)(pal) << 12) | (tile)))
#define BLANK_W TW(PAL_WHITE, TB3(' '))
void cv_clear(int x, int y, int w, int h);
/* cv_put is a macro: a function call per tile was too slow on the 68000 */
#define cv_put(x, y, w) do { int cvx_ = (x), cvy_ = (y); if ((unsigned)cvx_ < SCR_W && (unsigned)cvy_ < SCR_H) scr[cvy_][cvx_] = (w); } while (0)
extern BYTE xm_think;
extern BYTE xm_flush;               /* which part of the screen changed: bit 0 left half, bit 1 right half */               /* CPU players may search this frame (the game alternates the two sides) */
void cv_fill(int x, int y, int w, int h, WORD word);
void cv_text(int x, int y, BYTE pal, const char *s);
void cv_textc(int x, int w, int y, BYTE pal, const char *s);
const char *cv_num(DWORD v);
void cv_cell16(int x, int y, BYTE pal, WORD base, BYTE lit);   /* a 2x2-tile cell; lit = cursor corners */
void cv_frame(int x, int y, int w, int h, BYTE pal);           /* border around a field (outside the box) */
void cv_pending(int x, int y, int h, const Track *t, WORD unitPx8, WORD delay);   /* incoming bar, 1 column */
void cv_field_bg(int x, int y, int w, int h);
WORD frames_now(void);

#endif
