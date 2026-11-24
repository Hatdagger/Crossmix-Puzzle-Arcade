/* The screen as a 40x28 grid of fix tiles, rebuilt every frame (main.c sends only what changed). */
#include "xm.h"
#include "tiles.h"

WORD scr[SCR_H][SCR_W];

BYTE xm_think = 1;

void cv_fill(int x, int y, int w, int h, WORD word)
{
    int i, j;
    WORD *p;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > SCR_W) w = SCR_W - x;
    if (y + h > SCR_H) h = SCR_H - y;
    for (j = 0; j < h; j++) {
        p = &scr[y + j][x];
        for (i = w; i > 0; i--) *p++ = word;
    }
}

void cv_clear(int x, int y, int w, int h) { cv_fill(x, y, w, h, BLANK_W); }

void cv_text(int x, int y, BYTE pal, const char *s)
{
    char c;
    while ((c = *s++) != 0) {
        if (c >= 'a' && c <= 'z') c = (char)(c - 32);
        if (c < 32 || c > 95) c = '?';
        cv_put(x++, y, TW(pal, TB3((WORD)c)));
    }
}

static int slen(const char *s) { int n = 0; while (s[n]) n++; return n; }

void cv_textc(int x, int w, int y, BYTE pal, const char *s)
{
    cv_text(x + (w - slen(s)) / 2, y, pal, s);
}

/* decimal, no 32-bit divide (the 68000 has none) */
static char nb[12];
static const DWORD P10[10] = { 1UL, 10UL, 100UL, 1000UL, 10000UL, 100000UL, 1000000UL, 10000000UL, 100000000UL, 1000000000UL };
const char *cv_num(DWORD v)
{
    int k, n = 0;
    char d, lead = 1;
    for (k = 9; k >= 0; k--) {
        d = '0';
        while (v >= P10[k]) { v -= P10[k]; d++; }
        if (d != '0' || k == 0) lead = 0;
        if (!lead) nb[n++] = d;
    }
    nb[n] = 0;
    return nb;
}

void cv_cell16(int x, int y, BYTE pal, WORD base, BYTE lit)
{
    WORD w = TW(pal, TB4(base)), *p;
    (void)lit;
    if (x >= 0 && y >= 0 && x < SCR_W - 1 && y < SCR_H - 1) {
        p = &scr[y][x];
        p[0] = w; p[1] = (WORD)(w + 1); p[SCR_W] = (WORD)(w + 2); p[SCR_W + 1] = (WORD)(w + 3);
        return;
    }
    cv_put(x, y, w);
    cv_put(x + 1, y, (WORD)(w + 1));
    cv_put(x, y + 1, (WORD)(w + 2));
    cv_put(x + 1, y + 1, (WORD)(w + 3));
}

void cv_frame(int x, int y, int w, int h, BYTE pal)
{
    int i;
    cv_put(x - 1, y - 1, TW(pal, TB3(T_FR_TL)));
    cv_put(x + w, y - 1, TW(pal, TB3(T_FR_TR)));
    cv_put(x - 1, y + h, TW(pal, TB3(T_FR_BL)));
    cv_put(x + w, y + h, TW(pal, TB3(T_FR_BR)));
    for (i = 0; i < w; i++) { cv_put(x + i, y - 1, TW(pal, TB3(T_FR_T))); cv_put(x + i, y + h, TW(pal, TB3(T_FR_B))); }
    for (i = 0; i < h; i++) { cv_put(x - 1, y + i, TW(pal, TB3(T_FR_L))); cv_put(x + w, y + i, TW(pal, TB3(T_FR_R))); }
}

void cv_field_bg(int x, int y, int w, int h)
{
    cv_fill(x, y, w, h, TW(PAL_STEEL, TB3(T_PLAIN)));
}

/*
 * Incoming bar, one tile wide and h tiles tall, filled from the bottom:
 * amber while waiting, flashing red/white once it can land.  unitPx = pixels per unit.
 */
void cv_pending(int x, int y, int h, const Track *t, WORD unitPx, WORD delay)
{
    WORD px[32];
    BYTE col[32];
    int i, k, total = h * 8, at = total;
    BYTE flash = (BYTE)((frames_now() >> 3) & 1);
    for (i = 0; i < h && i < 32; i++) { px[i] = 0; col[i] = PAL_STEEL; }
    for (k = 0; k < t->npend && at > 0; k++) {
        const Batch *b = &t->pending[k];
        int ph = b->n * unitPx, j;
        BYTE c = b->t >= delay ? (flash ? PAL_RED : PAL_WHITE) : PAL_AMBER;
        if (ph > at) ph = at;
        for (j = 0; j < ph; j++) {
            int p = at - 1 - j, row = p >> 3;
            if (row < 32) { px[row]++; if (col[row] == PAL_STEEL || c == PAL_RED || c == PAL_WHITE) col[row] = c; }
        }
        at -= ph;
    }
    for (i = 0; i < h && i < 32; i++) {
        WORD f = px[i] > 8 ? 8 : px[i];
        cv_put(x, y + i, TW(col[i], TB3(T_BAR + f)));
    }
}
