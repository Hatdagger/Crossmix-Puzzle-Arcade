/*
 * Crossmix Puzzle Arcade - Neo Geo CD hardware layer.
 * Boots the fix palettes and backdrop, reads the pads, runs game_frame() once
 * per frame with the real time that passed, and sends the screen (scr[][]) to
 * the fix layer, only the tiles that changed.
 *
 * Strict C89 for GCC 2.95: no // comments, declarations at the top of blocks.
 */
#include <neocore.h>
#include <DATlib.h>
#include <input.h>
#include "externs.h"
#define XM_HAVE_TYPES
#include "xm.h"
#include "game.h"
#include "art.h"
#include "sound.h"

#define SPR_PAL_BG 16
#define SPR_BG     1

static picture bg;
static WORD sent[SCR_H][SCR_W];
static WORD fixpal[16 * 16];
static BYTE palWarn;

/* ---------------------------------------------------------------- colours */
static WORD ng5(WORD r, WORD g, WORD b)
{
    return (WORD)(((r & 1) << 14) | ((g & 1) << 13) | ((b & 1) << 12) | ((r >> 1) << 8) | ((g >> 1) << 4) | (b >> 1));
}
static WORD ng8(const unsigned char *c) { return ng5((WORD)(c[0] >> 3), (WORD)(c[1] >> 3), (WORD)(c[2] >> 3)); }
static WORD ch_r(WORD w) { return (WORD)(((w >> 7) & 0x1e) | ((w >> 14) & 1)); }
static WORD ch_g(WORD w) { return (WORD)(((w >> 3) & 0x1e) | ((w >> 13) & 1)); }
static WORD ch_b(WORD w) { return (WORD)(((w << 1) & 0x1e) | ((w >> 12) & 1)); }
static int adiff(int a, int b) { return a > b ? a - b : b - a; }

/* which role did the converter put in each palette slot? */
static void role_map(const paletteInfo *pi, BYTE *role)
{
    int k, r, best, d, bd;
    WORD w;
    role[0] = 0;
    for (k = 1; k < 16; k++) {
        w = pi->data[k];
        best = 1; bd = 999;
        for (r = 1; r < 16; r++) {
            d = adiff(ch_r(w), ROLE_REF[r][0] >> 3) + adiff(ch_g(w), ROLE_REF[r][1] >> 3) + adiff(ch_b(w), ROLE_REF[r][2] >> 3);
            if (d < bd) { bd = d; best = r; }
        }
        role[k] = (BYTE)best;
    }
}

static void load_fix_palettes(void)
{
    BYTE ra[16], rb[16];
    int p, k;
    role_map(&tt_fixa_Palettes, ra);
    role_map(&tt_fixb_Palettes, rb);
    for (k = 1; k < 16; k++) if (ra[k] != rb[k]) palWarn = 1;
    for (p = 2; p < 16; p++) {
        fixpal[p * 16] = 0;
        for (k = 1; k < 16; k++) fixpal[p * 16 + k] = ng8(FIX_PAL_RGB[p][ra[k]]);
    }
    palJobPut(2, 14, &fixpal[32]);
}

/* ---------------------------------------------------------------- sound */
static const BYTE SFX_MAP[] = {
    SND_MOVE, SND_ROTATE, SND_LOCK, SND_HARD, SND_HOLD, SND_CLEAR1, SND_CLEAR4, SND_GARBAGE, SND_TOPOUT, SND_DENY,
    SND_MARK, SND_BEEP, SND_MENU, SND_GO, SND_MENU, SND_BEEP, SND_GO, SND_JACKPOT, SND_CAST
};

void game_sfx(BYTE side, BYTE id)
{
    if (id >= sizeof(SFX_MAP)) return;
    snd_play(SFX_MAP[id], side == 0 ? SND_LEFT : side == 1 ? SND_RIGHT : SND_CENTRE);
}

static BYTE musicNow;
void game_music(BYTE track)
{
    if (track == musicNow) return;
    musicNow = track;
    music_play(track);
}

/* ---------------------------------------------------------------- fix layer */
static void flush(void)
{
    int x, y;
    WORD w;
    for (x = 0; x < SCR_W; x++) for (y = 0; y < SCR_H; y++) {
        w = scr[y][x];
        if (w != sent[y][x]) {
            sent[y][x] = w;
            SC234Put(0x7000 + (x << 5) + y + 2, w);
        }
    }
}

/* ---------------------------------------------------------------- main */
int main(void)
{
    WORD in1, in2, ms;
    BYTE c1, c2, ps;
    DWORD now, last;
    WORD rem = 0, n;
    int x, y;

    initGfx();
    clearFixLayer();
    LSPCmode = 0x1c00;
    backgroundColor(ng8(BACKDROP_RGB));
    load_fix_palettes();
    palJobPut(SPR_PAL_BG, tt_bg_Palettes.count, tt_bg_Palettes.data);
    pictureInit(&bg, &tt_bg, SPR_BG, SPR_PAL_BG, 0, 0, FLIP_NONE);
    snd_init();
    for (y = 0; y < SCR_H; y++) for (x = 0; x < SCR_W; x++) sent[y][x] = 0xffff;
    game_init();
    last = DAT_frameCounter + DAT_droppedFrames;

    for (;;) {
        SCClose();
        waitVBlank();
        now = DAT_frameCounter + DAT_droppedFrames;
        n = (WORD)(now - last); last = now;
        if (n < 1) n = 1;
        if (n > 4) n = 4;
        /* 60 frames = 1000 ms: 50/3 ms per frame, the remainder carried over */
        ms = (WORD)(n * 50 + rem); rem = (WORD)(ms % 3); ms = (WORD)(ms / 3);
        snd_tick();
        if ((DAT_frameCounter & 31) == 0) {
            palJobPut(2, 14, &fixpal[32]);
            palJobPut(SPR_PAL_BG, tt_bg_Palettes.count, tt_bg_Palettes.data);
        }
        c1 = volMEMBYTE(P1_CURRENT);
        c2 = volMEMBYTE(P2_CURRENT);
        ps = volMEMBYTE(PS_CURRENT);
        in1 = (WORD)(c1 | ((ps & P1_START) ? B_START : 0) | ((ps & P1_SELECT) ? B_SELECT : 0));
        in2 = (WORD)(c2 | ((ps & P2_START) ? B_START : 0) | ((ps & P2_SELECT) ? B_SELECT : 0));
        game_frame(in1, in2, ms);
        if (palWarn) scr[27][39] = TW(PAL_RED, TB3('!'));
        flush();
    }
    return 0;
}
