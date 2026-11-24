/* What the hardware layer (hw.c, or test/hw_pc.c) and the game (game.c) give each other. */
#ifndef XM_GAME_H
#define XM_GAME_H
void game_init(void);
void game_frame(WORD in1, WORD in2, WORD dt);   /* pad bits (B_*), ms since the last frame */
void game_music(BYTE track);                    /* hw: CD audio track 2..6 */
BYTE game_screen(void);
struct Track *game_track(int i);
BYTE game_phase(void);
BYTE game_wins(int i);
BYTE game_kos(void);
void game_set_bot(int i, BYTE lv);
#endif
