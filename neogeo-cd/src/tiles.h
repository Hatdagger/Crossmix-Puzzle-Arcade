/* Fix tile numbers.  tools/make_tiles.py paints the two tile banks to match. */
#ifndef XM_TILES_H
#define XM_TILES_H

/* ---- bank 3 (tiles_a.png): font, 8 px bricks, frames, bars ---- */
#define T_BRICK      1
#define T_GHOST      2
#define T_EMPTY      3      /* field background with a faint grid line */
#define T_CRYSTAL    4
#define T_SPIKES     5
#define T_CEIL       6
#define T_SOLID      7      /* solid in the palette's main colour */
#define T_LETTER     8      /* 8..16: weapon letter bricks, W_WIPE..W_SWAP */
#define T_FR_TL      17
#define T_FR_T       18
#define T_FR_TR      19
#define T_FR_L       20
#define T_FR_R       21
#define T_FR_BL      22
#define T_FR_B       23
#define T_FR_BR      24
#define T_FOG_A      25
#define T_FOG_B      26
#define T_STAR       27
#define T_DOT        28
#define T_ARROW      29
#define T_DANGER     30
#define T_BLACK      31
/* 32..95: font, tile = ASCII code */
#define T_BAR        96     /* 96..104: incoming bar filled 0..8 px from the bottom */
#define T_PLAIN      105    /* field background, no grid line */
#define T_CHAIN      106    /* Climb: chain links */
#define T_STAR_OFF   107
#define T_LINE_H     108    /* thin bar (power meter) */
#define T_HALF_L     109    /* power meter: left half lit */

/* ---- bank 4 (tiles_b.png): 16 px cells, 4 tiles each (TL TR BL BR) ---- */
#define C_SQ(s)      (4 + 4 * (s))       /* square-tile symbols 0..5 */
#define C_SQLIT(s)   (28 + 4 * (s))      /* the same with cursor corners */
#define C_STONE      52
#define C_BUB(s)     (56 + 4 * (s))      /* bubbles 0..5 */
#define C_GREYBUB    80
#define C_HEAD(k)    (84 + 4 * (k))
#define C_FOOD(k)    (100 + 4 * (k))
#define C_WRAP       116
#define C_COIN       120
#define C_LITEMPTY   124
#define C_PROF(f)    (128 + 4 * (f))     /* 0 walk A, 1 walk B, 2 climb, 3 dance, 4 dead */
#define C_GRABBER    148
#define C_LAUNCH     152
#define C_EMPTY16    156                 /* empty 16 px slot */
#define C_STONELIT   160
#define C_FLASH      164                 /* clearing flash */

#endif
